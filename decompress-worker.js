/* Web Worker: streaming tar.gz decompression and tar FSM parsing */

importScripts('https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js');

var CHUNK_SIZE = 10 * 1024 * 1024; // 10MB read chunks

var MARKER_EXTENSIONS = [
  '.txt', '.json', '.xml', '.cfg', '.ini', '.yml', '.yaml',
  '.md', '.log', '.csv', '.conf', '.properties'
];

// Tar FSM states
var STATE_HEADER = 0;
var STATE_DATA = 1;
var STATE_PADDING = 2;

var state = STATE_HEADER;
var headerBuf = new Uint8Array(512);
var headerOffset = 0;

// Current file being parsed
var currentFileName = '';
var currentFileSize = 0;
var currentIsMarker = false;
var dataRemaining = 0;
var paddingRemaining = 0;
var markerChunks = [];

// Stats
var totalFiles = 0;
var markerFilesCount = 0;
var totalUncompressed = 0;

var decoder = new TextDecoder('utf-8');

function isMarkerFile(name) {
  var lower = name.toLowerCase();
  for (var i = 0; i < MARKER_EXTENSIONS.length; i++) {
    if (lower.length > MARKER_EXTENSIONS[i].length &&
        lower.substr(lower.length - MARKER_EXTENSIONS[i].length) === MARKER_EXTENSIONS[i]) {
      return true;
    }
  }
  return false;
}

function parseOctal(buf, offset, len) {
  var str = '';
  for (var i = offset; i < offset + len; i++) {
    var c = buf[i];
    if (c === 0 || c === 32) break; // null or space
    str += String.fromCharCode(c);
  }
  return str.length > 0 ? parseInt(str, 8) : 0;
}

function parseFileName(buf) {
  // Check for UStar prefix at bytes 345-500
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

function processTarData(data) {
  var pos = 0;
  var len = data.length;
  totalUncompressed += len;

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
        if (isZeroBlock(headerBuf)) continue; // end-of-archive marker

        currentFileName = parseFileName(headerBuf);
        currentFileSize = parseOctal(headerBuf, 124, 12);
        var typeFlag = headerBuf[156];

        // Only process regular files (type '0' or '\0')
        var isRegularFile = (typeFlag === 48 || typeFlag === 0); // '0' or null
        currentIsMarker = isRegularFile && isMarkerFile(currentFileName);

        if (isRegularFile) totalFiles++;

        dataRemaining = currentFileSize;
        // Padding to align to 512-byte boundary
        var blocks = Math.ceil(currentFileSize / 512);
        paddingRemaining = blocks * 512 - currentFileSize;

        if (dataRemaining > 0) {
          markerChunks = [];
          state = STATE_DATA;
        } else {
          // Zero-size file
          if (currentIsMarker) {
            markerFilesCount++;
            self.postMessage({ type: 'marker-file', name: currentFileName, content: '', size: 0 });
          }
          state = paddingRemaining > 0 ? STATE_PADDING : STATE_HEADER;
        }
      }
    } else if (state === STATE_DATA) {
      var avail = len - pos;
      var take = avail < dataRemaining ? avail : dataRemaining;

      if (currentIsMarker) {
        markerChunks.push(data.slice(pos, pos + take));
      }
      // For non-marker files: do nothing with data (discard)

      dataRemaining -= take;
      pos += take;

      if (dataRemaining === 0) {
        if (currentIsMarker) {
          // Combine chunks and decode
          var totalLen = 0;
          for (var i = 0; i < markerChunks.length; i++) totalLen += markerChunks[i].length;
          var combined = new Uint8Array(totalLen);
          var offset = 0;
          for (var i = 0; i < markerChunks.length; i++) {
            combined.set(markerChunks[i], offset);
            offset += markerChunks[i].length;
          }
          var content = decoder.decode(combined);
          markerFilesCount++;
          self.postMessage({
            type: 'marker-file',
            name: currentFileName,
            content: content,
            size: currentFileSize
          });
          markerChunks = [];
        }
        state = paddingRemaining > 0 ? STATE_PADDING : STATE_HEADER;
      }
    } else if (state === STATE_PADDING) {
      var avail = len - pos;
      var take = avail < paddingRemaining ? avail : paddingRemaining;
      paddingRemaining -= take;
      pos += take;

      if (paddingRemaining === 0) {
        state = STATE_HEADER;
      }
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
  var bytesRead = 0;
  var offset = 0;

  var inflator = new pako.Inflate();
  inflator.onData = function(chunk) {
    processTarData(chunk);
  };
  inflator.onEnd = function(status) {
    if (status !== 0) {
      self.postMessage({ type: 'error', message: 'Decompression failed: ' + inflator.msg });
    }
  };

  function readNextChunk() {
    if (offset >= totalSize) {
      // All chunks read, finalize
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

    var isLast = (end >= totalSize);
    inflator.push(chunk, isLast);

    offset = end;
    bytesRead = end;

    self.postMessage({
      type: 'progress',
      bytesRead: bytesRead,
      totalSize: totalSize,
      percent: (bytesRead / totalSize) * 100,
      filesFound: totalFiles
    });

    if (!isLast) {
      readNextChunk();
    } else {
      // Finalize after last push
      self.postMessage({
        type: 'done',
        totalSize: totalSize,
        totalFiles: totalFiles,
        markerFiles: markerFilesCount,
        totalUncompressed: totalUncompressed
      });
    }
  }

  readNextChunk();
}
