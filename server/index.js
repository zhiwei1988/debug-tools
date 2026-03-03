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

    // Parse backtrace
    const entries = parseBacktrace(backtrace);
    if (entries.length === 0) {
      return res.json({ frames: [] });
    }

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

    const frames = parseAddr2lineOutput(output, entries);
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
