const express = require('express');
const multer = require('multer');
const archiver = require('archiver');
const { WebSocketServer } = require('ws');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 8090;

// Load config
const CONFIG_PATH = path.join(__dirname, 'config.json');
let config = {};
try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch(e) {}
const FILE_ROOT = path.resolve(__dirname, config.fileRoot || '.');
const UPLOAD_TMP_DIR = path.join(FILE_ROOT, '.uploads-tmp');
const LEGACY_SENTINEL = path.join(UPLOAD_TMP_DIR, '.legacy-cleaned');

function makeTmpName() {
  return crypto.randomBytes(8).toString('hex') + '.part';
}

function safePath(rel) {
  var abs = path.resolve(FILE_ROOT, path.normalize(rel || '.'));
  return abs === FILE_ROOT || abs.startsWith(FILE_ROOT + path.sep) ? abs : null;
}

// Load toolchain config
const TOOLCHAINS_PATH = path.join(__dirname, 'toolchains.json');
let toolchains = {};
try {
  toolchains = JSON.parse(fs.readFileSync(TOOLCHAINS_PATH, 'utf8'));
} catch (e) {
  console.warn('Could not load toolchains.json:', e.message);
}

// Multer: upload ELF to system temp dir, 100MB limit
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

app.use((req, res, next) => {
  // Skip body parsing for multipart so multer can handle it
  if (req.headers['content-type']?.startsWith('multipart/')) return next();
  express.text({ type: '*/*' })(req, res, next);
});

// Serve the project root as static assets (HTML/CSS/JS). Safe because the API
// and WS routes are registered below; path-based routing gives /api/* and /ws
// priority over static files.
app.use(express.static(path.join(__dirname, '..')));

// --- Backtrace Parser ---

// Regex patterns covering GDB, ESP-IDF, ARM HardFault, generic 0x addresses
const ADDRESS_PATTERNS = [
  // GDB: #0  0x08001234 in ...
  /^#\d+\s+(0x[0-9a-fA-F]+)/,
  // ESP-IDF: 0x400d1234:0x3ffb5e10 (first address is PC)
  /^(0x[0-9a-fA-F]+):0x[0-9a-fA-F]+/,
  // ARM HardFault register: PC: 0x... or LR: 0x...
  /\b(?:PC|LR|SP)\s*[:=]\s*(0x[0-9a-fA-F]+)/i,
  // Generic: any 0x hex address on its own
  /(0x[0-9a-fA-F]{4,})/,
];

function parseBacktrace(log) {
  const lines = log.split('\n');
  const results = []; // { address, line }
  const seen = new Set();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    for (const pattern of ADDRESS_PATTERNS) {
      const m = trimmed.match(pattern);
      if (m) {
        const addr = m[1].toLowerCase();
        if (!seen.has(addr)) {
          seen.add(addr);
          results.push({ address: addr, line: trimmed });
        }
        break;
      }
    }
  }

  return results;
}

// --- addr2line output parser ---
// addr2line -f -C -p output: "functionName at file.c:42"
function parseAddr2lineOutput(stdout, addresses) {
  const lines = stdout.trim().split('\n');
  return addresses.map((entry, i) => {
    const raw = lines[i] || '?? at ??:0';
    // Format: "func at file:line" or "?? at ??:0"
    const match = raw.match(/^(.+?)\s+at\s+(.+):(\d+)/);
    if (match) {
      return {
        address: entry.address,
        originalLine: entry.line,
        function: match[1].trim(),
        file: match[2].trim(),
        line: parseInt(match[3], 10),
        resolved: match[1].trim() !== '??',
      };
    }
    return {
      address: entry.address,
      originalLine: entry.line,
      function: '??',
      file: '??',
      line: 0,
      resolved: false,
    };
  });
}

// --- Exception Info Parser ---

const EXCEPTION_INFO_START = /^=+\s*Exception Info\s*=+$/;
const EXCEPTION_INFO_END = /^=+\s*Exception Info Done\s*=+$/;

function parseExceptionInfo(log) {
  const lines = log.split('\n');

  let startIdx = -1, endIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (startIdx < 0 && EXCEPTION_INFO_START.test(trimmed)) {
      startIdx = i;
    } else if (startIdx >= 0 && EXCEPTION_INFO_END.test(trimmed)) {
      endIdx = i;
      break;
    }
  }

  if (startIdx < 0 || endIdx < 0) return null;

  const block = lines.slice(startIdx + 1, endIdx);

  let signal = 0;
  const signalMatch = block.join('\n').match(/Receive signal:\s*(\d+)/);
  if (signalMatch) signal = parseInt(signalMatch[1], 10);

  // Split into sections by dashed headers like "----Regs----"
  const sections = {};
  let currentSection = '_header';
  sections[currentSection] = [];

  for (const line of block) {
    const headerMatch = line.trim().match(/^-{3,}\s*(.+?)\s*-{3,}$/);
    if (headerMatch) {
      currentSection = headerMatch[1].toLowerCase();
      sections[currentSection] = [];
    } else {
      if (!sections[currentSection]) sections[currentSection] = [];
      sections[currentSection].push(line);
    }
  }

  // Parse registers from Regs section
  const regs = {};
  const regsLines = sections['regs'] || [];
  const regPattern = /(\w+)\s*:\s*([0-9a-fA-F]{8,16})(?=\s|$)/g;
  for (const line of regsLines) {
    let m;
    while ((m = regPattern.exec(line)) !== null) {
      regs[m[1].toLowerCase()] = m[2].toLowerCase();
    }
    regPattern.lastIndex = 0;
  }

  // Parse memory maps
  const maps = [];
  const mapsLines = sections['maps'] || [];
  const mapPattern = /^([0-9a-f]+)-([0-9a-f]+)\s+(\S+)\s+([0-9a-f]+)\s+\S+\s+\d+\s*(.*)/;
  for (const line of mapsLines) {
    const m = line.trim().match(mapPattern);
    if (m) {
      maps.push({
        start: BigInt('0x' + m[1]),
        end: BigInt('0x' + m[2]),
        perms: m[3],
        offset: BigInt('0x' + m[4]),
        path: m[5].trim(),
      });
    }
  }

  // Parse SP stack dump values (right side of "->")
  const stackValues = [];
  const stackLines = sections['arm sp stack info'] || [];
  const stackLinePattern = /^0x[0-9a-fA-F]+\s*->\s*(.+)/;
  for (const line of stackLines) {
    const m = line.trim().match(stackLinePattern);
    if (m) {
      for (const val of m[1].trim().split(/\s+/)) {
        if (/^[0-9a-fA-F]{8,16}$/.test(val)) {
          stackValues.push(val.toLowerCase());
        }
      }
    }
  }

  return { signal, regs, maps, stackValues };
}

function manualUnwind(exInfo, elfFiles) {
  const execMaps = exInfo.maps.filter(m => m.perms.includes('x'));

  // Match each uploaded ELF to its executable Maps entries by basename
  const elfGroups = [];
  for (const ef of elfFiles) {
    const elfBase = path.basename(ef.originalname || '');
    const matched = execMaps.filter(m => m.path && path.basename(m.path) === elfBase);
    if (matched.length > 0) {
      elfGroups.push({ elfFile: ef, maps: matched });
    }
  }

  const entriesByElf = new Map();
  const unresolvedFrames = [];
  const seen = new Set();
  let order = 0;

  // Candidates ordered: arm_pc first, arm_lr second, then stack dump values
  const candidates = [];
  if (exInfo.regs.arm_pc) candidates.push({ hex: exInfo.regs.arm_pc, source: 'arm_pc' });
  if (exInfo.regs.arm_lr) candidates.push({ hex: exInfo.regs.arm_lr, source: 'arm_lr' });
  for (const val of exInfo.stackValues) {
    candidates.push({ hex: val, source: 'stack' });
  }

  for (const cand of candidates) {
    const addr = BigInt('0x' + cand.hex);
    if (addr === 0n) continue;

    const mapEntry = execMaps.find(m => addr >= m.start && addr < m.end);
    if (!mapEntry) continue;

    if (seen.has(cand.hex)) continue;
    seen.add(cand.hex);

    const runtimeAddr = '0x' + cand.hex;

    // Find which uploaded ELF this address belongs to
    let matchedElf = null;
    let matchedMap = null;
    for (const group of elfGroups) {
      const m = group.maps.find(m => addr >= m.start && addr < m.end);
      if (m) {
        matchedElf = group.elfFile;
        matchedMap = m;
        break;
      }
    }

    if (matchedElf) {
      const offset = addr - matchedMap.start + matchedMap.offset;
      if (!entriesByElf.has(matchedElf)) entriesByElf.set(matchedElf, []);
      entriesByElf.get(matchedElf).push({
        address: '0x' + offset.toString(16),
        line: `[${cand.source}] runtime ${runtimeAddr} in ${matchedMap.path}`,
        _order: order++,
      });
    } else {
      unresolvedFrames.push({
        address: runtimeAddr,
        originalLine: `[${cand.source}] runtime ${runtimeAddr} in ${mapEntry.path}`,
        function: '??',
        file: mapEntry.path,
        line: 0,
        resolved: false,
        _order: order++,
      });
    }
  }

  return { entriesByElf, unresolvedFrames };
}

// Strip Exception Info block so parseBacktrace won't pick up noise addresses from it
function stripExceptionInfoBlock(log) {
  return log.replace(/=+\s*Exception Info\s*=+[\s\S]*?=+\s*Exception Info Done\s*=+/g, '');
}

function runAddr2line(addr2linePath, elfPath, addresses) {
  return new Promise((resolve, reject) => {
    const args = ['-e', elfPath, '-f', '-C', '-p', ...addresses];
    execFile(addr2linePath, args, { timeout: 30000 }, (err, stdout, stderr) => {
      if (err && err.killed) return reject(new Error('addr2line timed out'));
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout);
    });
  });
}

// --- Routes ---

app.get('/api/toolchains', (req, res) => {
  res.json({ toolchains: Object.keys(toolchains) });
});

app.post('/api/toolchains/detect', (req, res) => {
  // Collect candidate bin directories from PATH + common prefixes
  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const prefixDirs = ['/opt', '/usr/local', '/usr'];
  const extraDirs = [];
  for (const prefix of prefixDirs) {
    try {
      for (const entry of fs.readdirSync(prefix, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const binDir = path.join(prefix, entry.name, 'bin');
          try { fs.accessSync(binDir, fs.constants.R_OK); extraDirs.push(binDir); } catch {}
        }
      }
    } catch {}
  }
  const candidates = [...new Set([...pathDirs, ...extraDirs])];

  const found = [];
  for (const dir of candidates) {
    let entries;
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      if (!name.endsWith('-addr2line')) continue;
      const fullPath = path.join(dir, name);
      try { fs.accessSync(fullPath, fs.constants.X_OK); } catch { continue; }
      const tcName = name.slice(0, -'-addr2line'.length);
      if (!Object.prototype.hasOwnProperty.call(toolchains, tcName)) {
        toolchains[tcName] = fullPath;
        found.push(tcName);
      }
    }
  }

  if (found.length > 0) {
    fs.writeFileSync(TOOLCHAINS_PATH, JSON.stringify(toolchains, null, 2), 'utf8');
  }

  res.json({ found, total: Object.keys(toolchains) });
});

app.post('/api/analyze', upload.array('elf'), async (req, res) => {
  const elfFiles = req.files || [];
  let cleaned = false;

  const cleanup = () => {
    if (!cleaned) {
      cleaned = true;
      for (const f of elfFiles) fs.unlink(f.path, () => {});
    }
  };

  try {
    const { toolchain, backtrace } = req.body;

    if (!toolchain) return res.status(400).json({ error: 'Missing field: toolchain' });
    if (!backtrace) return res.status(400).json({ error: 'Missing field: backtrace' });
    if (elfFiles.length === 0) return res.status(400).json({ error: 'Missing field: elf' });

    // Whitelist validation
    if (!Object.prototype.hasOwnProperty.call(toolchains, toolchain)) {
      return res.status(400).json({ error: 'Unknown toolchain' });
    }

    const addr2linePath = toolchains[toolchain];

    // Parse backtrace: try structured formats first, strip Exception Info block
    // to avoid picking up noise addresses from the stack dump section
    const hasExInfo = /=+\s*Exception Info\s*=+/.test(backtrace);
    const entries = parseBacktrace(hasExInfo ? stripExceptionInfoBlock(backtrace) : backtrace);

    if (entries.length > 0) {
      // Structured backtrace: try each ELF, pick best resolved result per address
      const addresses = entries.map(e => e.address);
      const bestFrames = entries.map(entry => ({
        address: entry.address,
        originalLine: entry.line,
        function: '??',
        file: '??',
        line: 0,
        resolved: false,
      }));

      for (const elfFile of elfFiles) {
        const output = await runAddr2line(addr2linePath, elfFile.path, addresses);
        const resolved = parseAddr2lineOutput(output, entries);
        for (let i = 0; i < resolved.length; i++) {
          if (resolved[i].resolved && !bestFrames[i].resolved) {
            bestFrames[i] = resolved[i];
          }
        }
      }

      return res.json({ frames: bestFrames });
    }

    // Fallback: Exception Info format with manual stack unwinding
    if (hasExInfo) {
      const exInfo = parseExceptionInfo(backtrace);
      if (exInfo) {
        const { entriesByElf, unresolvedFrames } = manualUnwind(exInfo, elfFiles);

        const allResolvedFrames = [];
        for (const [elfFile, elfEntries] of entriesByElf) {
          const addresses = elfEntries.map(e => e.address);
          const output = await runAddr2line(addr2linePath, elfFile.path, addresses);
          const resolved = parseAddr2lineOutput(output, elfEntries);
          resolved.forEach((f, i) => { f._order = elfEntries[i]._order; });
          allResolvedFrames.push(...resolved);
        }

        const allFrames = [...unresolvedFrames, ...allResolvedFrames];
        allFrames.sort((a, b) => (a._order ?? 0) - (b._order ?? 0));
        const frames = allFrames.map(({ _order, ...rest }) => rest);
        return res.json({ frames });
      }
    }

    res.json({ frames: [] });

  } catch (err) {
    if (err.message === 'addr2line timed out') {
      res.status(504).json({ error: 'addr2line timed out after 30s' });
    } else {
      res.status(500).json({ error: err.message });
    }
  } finally {
    cleanup();
  }
});

// --- File Browser API ---

app.get('/api/files/root', (req, res) => {
  res.json({ root: FILE_ROOT });
});

app.get('/api/files/list', (req, res) => {
  const abs = safePath(req.query.path);
  if (!abs) return res.status(403).json({ error: 'Access denied' });

  try {
    const stat = fs.statSync(abs);
    if (!stat.isDirectory()) return res.status(400).json({ error: 'Not a directory' });

    const entries = fs.readdirSync(abs).map(name => {
      try {
        const s = fs.statSync(path.join(abs, name));
        return { name, type: s.isDirectory() ? 'dir' : 'file', size: s.size, mtime: s.mtime.toISOString() };
      } catch { return { name, type: 'unknown', size: 0, mtime: '' }; }
    });

    entries.sort((a, b) => {
      if (a.type === 'dir' && b.type !== 'dir') return -1;
      if (a.type !== 'dir' && b.type === 'dir') return 1;
      return a.name.localeCompare(b.name);
    });

    res.json({ path: req.query.path || '.', entries });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/files/download', (req, res) => {
  const abs = safePath(req.query.path);
  if (!abs) return res.status(403).json({ error: 'Access denied' });

  try {
    const stat = fs.statSync(abs);
    if (!stat.isFile()) return res.status(400).json({ error: 'Not a file' });
    res.download(abs);
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.get('/api/files/download-folder', (req, res) => {
  const abs = safePath(req.query.path);
  if (!abs) return res.status(403).json({ error: 'Access denied' });
  if (abs === FILE_ROOT) return res.status(400).json({ error: 'Cannot download root' });

  let stat;
  try {
    stat = fs.statSync(abs);
  } catch (e) {
    return res.status(404).json({ error: e.message });
  }
  if (!stat.isDirectory()) return res.status(400).json({ error: 'Not a directory' });

  const dirName = path.basename(abs);
  const zipName = dirName + '.zip';
  // RFC 5987: ASCII fallback + UTF-8 encoded form, handles non-ASCII / spaces
  const asciiFallback = zipName.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  const encoded = encodeURIComponent(zipName);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition',
    `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`);

  const archive = archiver('zip', { store: true });

  archive.on('warning', (err) => {
    // Non-fatal (e.g. ENOENT on a file that disappeared mid-scan) — skip it
    if (err.code !== 'ENOENT') res.destroy(err);
  });
  archive.on('error', (err) => { res.destroy(err); });
  // Client aborted / socket closed while streaming — stop reading fds
  res.on('close', () => { if (!res.writableEnded) archive.abort(); });

  archive.pipe(res);
  archive.directory(abs, dirName);
  archive.finalize();
});

app.post('/api/files/mkdir', express.json(), (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const abs = safePath(body.path);
  if (!abs) return res.status(403).json({ error: 'Access denied' });

  try {
    fs.mkdirSync(abs, { recursive: true });
    res.json({ created: body.path });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/files/delete', express.json(), (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const abs = safePath(body.path);
  if (!abs) return res.status(403).json({ error: 'Access denied' });
  if (abs === FILE_ROOT) return res.status(403).json({ error: 'Cannot delete root' });

  try {
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      fs.rmSync(abs, { recursive: true });
    } else {
      fs.unlinkSync(abs);
    }
    res.json({ deleted: body.path });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- WebSocket Upload (/ws) ---

const LEGACY_TMP_SUFFIX_RE = /\.uploading\.[a-f0-9]+$/;
const IDLE_TIMEOUT_MS = 30 * 1000;
const ACK_BYTES = 1024 * 1024;
const ACK_INTERVAL_MS = 200;
const BACKPRESSURE_BYTES = 8 * 1024 * 1024;

// Sweep stranded tmp files left by prior runs (server crash / WS drop mid-transfer).
// Only scans UPLOAD_TMP_DIR — keeping this O(pending tmp count) instead of
// O(FILE_ROOT tree size) is what makes startup fast on large roots.
function cleanupOrphans() {
  let names;
  try { names = fs.readdirSync(UPLOAD_TMP_DIR); } catch { return; }
  // Snapshot before any unlink so uploads started mid-cleanup survive.
  const snapshot = names.filter((n) => n.endsWith('.part'));
  for (const name of snapshot) {
    try { fs.unlinkSync(path.join(UPLOAD_TMP_DIR, name)); } catch {}
  }
}

// One-time recursive sweep of FILE_ROOT to remove legacy `*.uploading.*` files
// from the pre-collection-directory layout. Guarded by a sentinel so it only
// pays the full-tree cost once per deployment.
function runLegacySweepOnce() {
  try { fs.accessSync(LEGACY_SENTINEL); return; } catch {}

  const walk = (dir) => {
    let items;
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      const full = path.join(dir, it.name);
      if (it.isDirectory()) {
        if (full === UPLOAD_TMP_DIR) continue;
        walk(full);
      } else if (LEGACY_TMP_SUFFIX_RE.test(it.name)) {
        try { fs.unlinkSync(full); } catch {}
      }
    }
  };

  walk(FILE_ROOT);
  try { fs.writeFileSync(LEGACY_SENTINEL, ''); } catch {}
}

function attachUploadWS(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws) => {
    let sess = null;

    const sendJson = (obj) => {
      if (ws.readyState === ws.OPEN) {
        try { ws.send(JSON.stringify(obj)); } catch {}
      }
    };
    const sendError = (msg) => sendJson({ type: 'error', msg });

    const clearTimers = (s) => {
      if (!s) return;
      clearTimeout(s.idleTimer); s.idleTimer = null;
      clearTimeout(s.ackTimer);  s.ackTimer = null;
    };

    const closeTmp = (s) => {
      if (!s) return;
      if (s.stream) { try { s.stream.destroy(); } catch {} }
      if (s.tmp) fs.unlink(s.tmp, () => {});
    };

    const cleanupSession = () => {
      if (!sess) return;
      clearTimers(sess);
      closeTmp(sess);
      sess = null;
    };

    const sendAck = () => {
      if (!sess) return;
      sendJson({ type: 'ack', received: sess.received });
      sess.ackBytes = 0;
      sess.lastAck = Date.now();
      clearTimeout(sess.ackTimer);
      sess.ackTimer = null;
    };

    const scheduleAck = () => {
      if (!sess) return;
      if (sess.ackBytes >= ACK_BYTES) {
        sendAck();
      } else if (!sess.ackTimer) {
        sess.ackTimer = setTimeout(sendAck, ACK_INTERVAL_MS);
      }
    };

    const armIdle = () => {
      if (!sess) return;
      clearTimeout(sess.idleTimer);
      sess.idleTimer = setTimeout(() => {
        sendError('timeout');
        cleanupSession();
        try { ws.close(); } catch {}
      }, IDLE_TIMEOUT_MS);
    };

    const handleInit = (msg) => {
      if (sess) {
        sendError('protocol error: concurrent init');
        cleanupSession();
        return;
      }
      const size = Number(msg.size);
      if (!Number.isFinite(size) || size < 0) { sendError('missing or invalid size'); return; }
      const relPath = typeof msg.relPath === 'string' && msg.relPath ? msg.relPath : null;
      if (!relPath) { sendError('missing relPath'); return; }
      const joined = path.join(msg.path || '.', relPath);
      const abs = safePath(joined);
      if (!abs) { sendError('access denied'); return; }
      try { fs.mkdirSync(path.dirname(abs), { recursive: true }); }
      catch (e) { sendError('mkdir failed: ' + e.message); return; }
      // Tmp files live in a single collection directory so orphan cleanup
      // doesn't have to walk the full FILE_ROOT tree at startup.
      try { fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true }); }
      catch (e) { sendError('mkdir failed: ' + e.message); return; }
      const tmp = path.join(UPLOAD_TMP_DIR, makeTmpName());
      let stream;
      try { stream = fs.createWriteStream(tmp); }
      catch (e) { sendError('open tmp failed: ' + e.message); return; }
      sess = {
        target: abs,
        targetRel: joined,
        tmp,
        size,
        received: 0,
        stream,
        ackBytes: 0,
        lastAck: Date.now(),
        ackTimer: null,
        idleTimer: null,
      };
      stream.on('error', (e) => { sendError('write error: ' + e.message); cleanupSession(); });
      sendJson({ type: 'ready' });
      armIdle();
    };

    const handleFinish = () => {
      if (!sess) { sendError('no active upload'); return; }
      const s = sess;
      sess = null;                // block further binary/init from landing on s
      clearTimers(s);
      s.stream.end(() => {
        if (s.received !== s.size) {
          sendError('size mismatch');
          fs.unlink(s.tmp, () => {});
          return;
        }
        try { fs.renameSync(s.tmp, s.target); }
        catch (e) { sendError('rename failed: ' + e.message); fs.unlink(s.tmp, () => {}); return; }
        sendJson({ type: 'ack', received: s.received });
        sendJson({ type: 'done', path: path.relative(FILE_ROOT, s.target).split(path.sep).join('/') });
      });
    };

    const handleBinary = (data) => {
      if (!sess || !sess.stream) { sendError('unexpected binary frame'); return; }
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (sess.received + buf.length > sess.size) {
        sendError('oversize');
        cleanupSession();
        return;
      }
      ws.pause();
      sess.received += buf.length;
      sess.ackBytes += buf.length;
      sess.stream.write(buf, () => { ws.resume(); });
      armIdle();
      scheduleAck();
    };

    ws.on('message', (data, isBinary) => {
      if (isBinary) return handleBinary(data);
      let msg;
      try { msg = JSON.parse(data.toString('utf8')); }
      catch { sendError('invalid json'); return; }
      if (msg.type === 'init')        handleInit(msg);
      else if (msg.type === 'finish') handleFinish();
      else if (msg.type === 'abort')  cleanupSession();
      else                            sendError('unknown message type: ' + msg.type);
    });

    ws.on('close', cleanupSession);
    ws.on('error', cleanupSession);
  });
}

// Create the collection directory eagerly so the sentinel write in the
// legacy sweep can't race a concurrent first upload.
try { fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true }); } catch {}

const httpServer = app.listen(PORT, () => {
  console.log(`Stack analyzer server listening on port ${PORT}`);
});
attachUploadWS(httpServer);

// Orphan and legacy cleanup run after listen so the HTTP port is reachable
// immediately, independent of FILE_ROOT size.
setImmediate(() => {
  cleanupOrphans();
  runLegacySweepOnce();
});
