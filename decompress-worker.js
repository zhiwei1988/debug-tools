/* Web Worker: streaming tar / tar.gz decompression and tar FSM parsing */

importScripts('https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js');
importScripts('https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js');

var CHUNK_SIZE = 10 * 1024 * 1024; // 10MB read chunks

// Tar FSM states (module-level, for the outer streaming tar)
var STATE_HEADER = 0;
var STATE_DATA = 1;
var STATE_PADDING = 2;

var state = STATE_HEADER;
var headerBuf = new Uint8Array(512);
var headerOffset = 0;
var curName = '';
var curSize = 0;
var curCat = null;
var curIsRegular = false;
var dataRemaining = 0;
var paddingRemaining = 0;
var curChunks = [];

// Stats
var totalFiles = 0;
var markerFilesCount = 0;
var totalUncompressed = 0;

var decoder = new TextDecoder('utf-8', { fatal: false });

function getFileCategory(name) {
  var lower = name.toLowerCase();
  if (lower.substr(lower.length - 4) === '.tgz') return 'tgz';
  if (lower.substr(lower.length - 3) === '.gz') return 'gz';
  if (lower.substr(lower.length - 4) === '.zip') return 'zip';
  if (lower.substr(lower.length - 4) === '.log' || lower.substr(lower.length - 4) === '.bin') return 'log';
  var markerExts = ['.txt', '.csv', '.json', '.xml', '.cfg', '.ini', '.yml', '.yaml', '.md', '.conf', '.properties'];
  for (var i = 0; i < markerExts.length; i++) {
    var ext = markerExts[i];
    if (lower.length > ext.length && lower.substr(lower.length - ext.length) === ext) return 'marker';
  }
  return null;
}

function parseOctal(buf, offset, len) {
  var str = '';
  for (var i = offset; i < offset + len; i++) {
    var c = buf[i];
    if (c === 0 || c === 32) break;
    str += String.fromCharCode(c);
  }
  return str.length > 0 ? parseInt(str, 8) : 0;
}

function parseFileName(buf) {
  var prefix = '';
  var hasUstar = (buf[257] === 0x75 && buf[258] === 0x73 && buf[259] === 0x74 &&
                  buf[260] === 0x61 && buf[261] === 0x72);
  if (hasUstar) {
    for (var i = 345; i < 500; i++) {
      if (buf[i] === 0) break;
      prefix += String.fromCharCode(buf[i]);
    }
  }
  var name = '';
  for (var i = 0; i < 100; i++) {
    if (buf[i] === 0) break;
    name += String.fromCharCode(buf[i]);
  }
  if (prefix) name = prefix + '/' + name;
  return name;
}

function isZeroBlock(buf) {
  for (var i = 0; i < 512; i++) {
    if (buf[i] !== 0) return false;
  }
  return true;
}

function combineChunks(chunks) {
  var totalLen = 0;
  for (var i = 0; i < chunks.length; i++) totalLen += chunks[i].length;
  var combined = new Uint8Array(totalLen);
  var offset = 0;
  for (var i = 0; i < chunks.length; i++) {
    combined.set(chunks[i], offset);
    offset += chunks[i].length;
  }
  return combined;
}

function isLikelyText(data) {
  var sampleLen = data.length < 8192 ? data.length : 8192;
  if (sampleLen === 0) return false;
  var printable = 0;
  for (var i = 0; i < sampleLen; i++) {
    var b = data[i];
    if (b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b <= 0x7e)) printable++;
  }
  return (printable / sampleLen) >= 0.95;
}

function handleFileEntry(name, data, depth) {
  var cat = getFileCategory(name);
  if (cat === 'log') {
    totalFiles++;
    var content = decoder.decode(data);
    self.postMessage({ type: 'log-file', name: name, content: content, size: data.length });
  } else if (cat === 'gz') {
    try {
      var inflated = pako.inflate(data);
      var innerName = name.substr(0, name.length - 3);
      var innerCat = getFileCategory(innerName);
      if (innerCat === 'tgz') {
        if (depth < 2) processTarBuffer(inflated, depth + 1);
      } else if (innerCat === 'zip') {
        if (depth < 2) processZipBuffer(inflated, depth + 1);
      } else {
        totalFiles++;
        var content = decoder.decode(inflated);
        if (innerCat === 'marker') {
          markerFilesCount++;
          self.postMessage({ type: 'marker-file', name: innerName, content: content, size: inflated.length });
        } else {
          self.postMessage({ type: 'log-file', name: innerName, content: content, size: inflated.length });
        }
      }
    } catch (e) {
      // silently skip corrupt gz files
    }
  } else if (cat === 'tgz') {
    if (depth < 2) {
      try {
        var inflated = pako.inflate(data);
        processTarBuffer(inflated, depth + 1);
      } catch (e) {
        // silently skip corrupt tgz files
      }
    }
  } else if (cat === 'zip') {
    if (depth < 2) {
      try {
        processZipBuffer(data, depth + 1);
      } catch (e) {
        // silently skip corrupt zip files
      }
    }
  } else if (cat === 'marker') {
    totalFiles++;
    var content = decoder.decode(data);
    markerFilesCount++;
    self.postMessage({ type: 'marker-file', name: name, content: content, size: data.length });
  } else if (cat === null) {
    if (isLikelyText(data)) {
      totalFiles++;
      var content = decoder.decode(data);
      self.postMessage({ type: 'log-file', name: name, content: content, size: data.length });
    }
  }
}

function processZipBuffer(data, depth) {
  var files = fflate.unzipSync(data);
  for (var fname in files) {
    if (!files.hasOwnProperty(fname)) continue;
    if (fname.charAt(fname.length - 1) === '/') continue;
    handleFileEntry(fname, files[fname], depth);
  }
}

// Synchronous tar parser for buffered (already-in-memory) tar data
function processTarBuffer(data, depth) {
  var pos = 0;
  var len = data.length;
  // local FSM state
  var lState = STATE_HEADER;
  var lHeaderBuf = new Uint8Array(512);
  var lHeaderOffset = 0;
  var lName = '';
  var lSize = 0;
  var lCat = null;
  var lIsRegular = false;
  var lDataRemaining = 0;
  var lPaddingRemaining = 0;
  var lChunks = [];

  while (pos < len) {
    if (lState === STATE_HEADER) {
      var need = 512 - lHeaderOffset;
      var avail = len - pos;
      var take = avail < need ? avail : need;
      lHeaderBuf.set(data.subarray(pos, pos + take), lHeaderOffset);
      lHeaderOffset += take;
      pos += take;

      if (lHeaderOffset === 512) {
        lHeaderOffset = 0;
        if (isZeroBlock(lHeaderBuf)) continue;

        lName = parseFileName(lHeaderBuf);
        lSize = parseOctal(lHeaderBuf, 124, 12);
        var typeFlag = lHeaderBuf[156];
        lIsRegular = (typeFlag === 48 || typeFlag === 0);
        lCat = lIsRegular ? getFileCategory(lName) : null;

        lDataRemaining = lSize;
        var blocks = Math.ceil(lSize / 512);
        lPaddingRemaining = blocks * 512 - lSize;

        if (lDataRemaining > 0) {
          lChunks = [];
          lState = STATE_DATA;
        } else {
          if (lIsRegular) {
            handleFileEntry(lName, new Uint8Array(0), depth);
          }
          lState = lPaddingRemaining > 0 ? STATE_PADDING : STATE_HEADER;
        }
      }
    } else if (lState === STATE_DATA) {
      var avail = len - pos;
      var take = avail < lDataRemaining ? avail : lDataRemaining;

      if (lIsRegular) {
        lChunks.push(data.slice(pos, pos + take));
      }

      lDataRemaining -= take;
      pos += take;

      if (lDataRemaining === 0) {
        if (lIsRegular) {
          var combined = combineChunks(lChunks);
          handleFileEntry(lName, combined, depth);
          lChunks = [];
        }
        lState = lPaddingRemaining > 0 ? STATE_PADDING : STATE_HEADER;
      }
    } else if (lState === STATE_PADDING) {
      var avail = len - pos;
      var take = avail < lPaddingRemaining ? avail : lPaddingRemaining;
      lPaddingRemaining -= take;
      pos += take;
      if (lPaddingRemaining === 0) lState = STATE_HEADER;
    }
  }
}

// Streaming FSM for the outer tar (called chunk by chunk)
function processTarStream(data) {
  totalUncompressed += data.length;
  var pos = 0;
  var len = data.length;

  while (pos < len) {
    if (state === STATE_HEADER) {
      var need = 512 - headerOffset;
      var avail = len - pos;
      var take = avail < need ? avail : need;
      headerBuf.set(data.subarray(pos, pos + take), headerOffset);
      headerOffset += take;
      pos += take;

      if (headerOffset === 512) {
        headerOffset = 0;
        if (isZeroBlock(headerBuf)) continue;

        curName = parseFileName(headerBuf);
        curSize = parseOctal(headerBuf, 124, 12);
        var typeFlag = headerBuf[156];
        curIsRegular = (typeFlag === 48 || typeFlag === 0);
        curCat = curIsRegular ? getFileCategory(curName) : null;

        dataRemaining = curSize;
        var blocks = Math.ceil(curSize / 512);
        paddingRemaining = blocks * 512 - curSize;

        if (dataRemaining > 0) {
          curChunks = [];
          state = STATE_DATA;
        } else {
          if (curIsRegular) {
            handleFileEntry(curName, new Uint8Array(0), 0);
          }
          state = paddingRemaining > 0 ? STATE_PADDING : STATE_HEADER;
        }
      }
    } else if (state === STATE_DATA) {
      var avail = len - pos;
      var take = avail < dataRemaining ? avail : dataRemaining;

      if (curIsRegular) {
        curChunks.push(data.slice(pos, pos + take));
      }

      dataRemaining -= take;
      pos += take;

      if (dataRemaining === 0) {
        if (curIsRegular) {
          var combined = combineChunks(curChunks);
          handleFileEntry(curName, combined, 0);
          curChunks = [];
        }
        state = paddingRemaining > 0 ? STATE_PADDING : STATE_HEADER;
      }
    } else if (state === STATE_PADDING) {
      var avail = len - pos;
      var take = avail < paddingRemaining ? avail : paddingRemaining;
      paddingRemaining -= take;
      pos += take;
      if (paddingRemaining === 0) state = STATE_HEADER;
    }
  }
}

self.onmessage = function(e) {
  var msg = e.data;
  if (msg.type === 'start') {
    processFile(msg.file);
  }
};

function processFile(file) {
  var totalSize = file.size;
  var offset = 0;
  var isGzip = false;
  var isZip = false;
  var inflator = null;
  var zipChunks = [];

  function readNextChunk() {
    if (offset >= totalSize) {
      if (isZip) {
        try {
          var fullData = combineChunks(zipChunks);
          totalUncompressed += fullData.length;
          processZipBuffer(fullData, 0);
        } catch (e) {
          self.postMessage({ type: 'error', message: 'Zip decompression failed: ' + e.message });
        }
        zipChunks = [];
      }
      self.postMessage({
        type: 'done',
        totalSize: totalSize,
        totalFiles: totalFiles,
        markerFiles: markerFilesCount,
        totalUncompressed: totalUncompressed
      });
      return;
    }

    var end = offset + CHUNK_SIZE;
    if (end > totalSize) end = totalSize;
    var blob = file.slice(offset, end);

    var reader = new FileReaderSync();
    var arrayBuf = reader.readAsArrayBuffer(blob);
    var chunk = new Uint8Array(arrayBuf);

    // Detect format on first chunk
    if (offset === 0) {
      isGzip = (chunk.length >= 2 && chunk[0] === 0x1f && chunk[1] === 0x8b);
      isZip = (!isGzip && chunk.length >= 4 &&
               chunk[0] === 0x50 && chunk[1] === 0x4b && chunk[2] === 0x03 && chunk[3] === 0x04);
      if (isGzip) {
        inflator = new pako.Inflate();
        inflator.onData = function(decompressed) {
          processTarStream(decompressed);
        };
        inflator.onEnd = function(status) {
          if (status !== 0) {
            self.postMessage({ type: 'error', message: 'Decompression failed: ' + inflator.msg });
          }
        };
      }
    }

    offset = end;

    if (isZip) {
      zipChunks.push(chunk);
    } else if (isGzip) {
      var isLast = (offset >= totalSize);
      inflator.push(chunk, isLast);
    } else {
      processTarStream(chunk);
    }

    self.postMessage({
      type: 'progress',
      bytesRead: offset,
      totalSize: totalSize,
      percent: (offset / totalSize) * 100,
      filesFound: totalFiles
    });

    readNextChunk();
  }

  readNextChunk();
}
