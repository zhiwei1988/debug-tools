const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

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

app.use(cors());
app.use((req, res, next) => {
  // Skip body parsing for multipart so multer can handle it
  if (req.headers['content-type']?.startsWith('multipart/')) return next();
  express.text({ type: '*/*' })(req, res, next);
});

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

function manualUnwind(exInfo, elfFilename) {
  const elfBase = path.basename(elfFilename);
  const execMaps = exInfo.maps.filter(m => m.perms.includes('x'));
  const elfMaps = execMaps.filter(m => m.path && path.basename(m.path) === elfBase);

  const entries = [];
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

    const isOurBinary = elfMaps.some(m => addr >= m.start && addr < m.end);
    const runtimeAddr = '0x' + cand.hex;

    if (isOurBinary) {
      const offset = addr - mapEntry.start + mapEntry.offset;
      entries.push({
        address: '0x' + offset.toString(16),
        line: `[${cand.source}] runtime ${runtimeAddr} in ${mapEntry.path}`,
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

  return { entries, unresolvedFrames };
}

// Strip Exception Info block so parseBacktrace won't pick up noise addresses from it
function stripExceptionInfoBlock(log) {
  return log.replace(/=+\s*Exception Info\s*=+[\s\S]*?=+\s*Exception Info Done\s*=+/g, '');
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

app.post('/api/analyze', upload.single('elf'), async (req, res) => {
  const elfFile = req.file;
  let cleaned = false;

  const cleanup = () => {
    if (!cleaned && elfFile) {
      cleaned = true;
      fs.unlink(elfFile.path, () => {});
    }
  };

  try {
    const { toolchain, backtrace } = req.body;

    if (!toolchain) return res.status(400).json({ error: 'Missing field: toolchain' });
    if (!backtrace) return res.status(400).json({ error: 'Missing field: backtrace' });
    if (!elfFile) return res.status(400).json({ error: 'Missing field: elf' });

    // Whitelist validation
    if (!Object.prototype.hasOwnProperty.call(toolchains, toolchain)) {
      return res.status(400).json({ error: 'Unknown toolchain' });
    }

    const addr2linePath = toolchains[toolchain];

    // Parse backtrace: try structured formats first, strip Exception Info block
    // to avoid picking up noise addresses from the stack dump section
    const hasExInfo = /=+\s*Exception Info\s*=+/.test(backtrace);
    let entries = parseBacktrace(hasExInfo ? stripExceptionInfoBlock(backtrace) : backtrace);
    let unresolvedFrames = [];

    // Fallback: Exception Info format with manual stack unwinding
    if (entries.length === 0 && hasExInfo) {
      const exInfo = parseExceptionInfo(backtrace);
      if (exInfo) {
        const result = manualUnwind(exInfo, elfFile.originalname || '');
        entries = result.entries;
        unresolvedFrames = result.unresolvedFrames;
      }
    }

    if (entries.length === 0 && unresolvedFrames.length === 0) {
      return res.json({ frames: [] });
    }

    let resolvedFrames = [];
    if (entries.length > 0) {
      const addresses = entries.map(e => e.address);

      // Invoke addr2line via execFile (no shell)
      const output = await new Promise((resolve, reject) => {
        const args = ['-e', elfFile.path, '-f', '-C', '-p', ...addresses];
        execFile(addr2linePath, args, { timeout: 30000 }, (err, stdout, stderr) => {
          if (err && err.killed) return reject(new Error('addr2line timed out'));
          if (err) return reject(new Error(stderr || err.message));
          resolve(stdout);
        });
      });

      resolvedFrames = parseAddr2lineOutput(output, entries);
      for (let i = 0; i < resolvedFrames.length; i++) {
        if (entries[i]._order !== undefined) resolvedFrames[i]._order = entries[i]._order;
      }
    }

    // Merge resolved and unresolved frames, preserving manual-unwind order
    const allFrames = [...unresolvedFrames, ...resolvedFrames];
    if (unresolvedFrames.length > 0) {
      allFrames.sort((a, b) => (a._order ?? 0) - (b._order ?? 0));
    }
    const frames = allFrames.map(({ _order, ...rest }) => rest);
    res.json({ frames });

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

app.listen(PORT, () => {
  console.log(`Stack analyzer server listening on port ${PORT}`);
});
