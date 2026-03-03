## Why

Embedded device crash debugging requires manual addr2line calls on a Linux server with the cross-compilation toolchain. This is tedious and error-prone. A web-based tool integrated into the existing web-decompress project will streamline the workflow: upload backtrace log + ELF binary, get resolved stack traces with source file names and line numbers.

## What Changes

- Add a new page/tab to the existing web-decompress project for stack trace analysis
- New web form: paste/upload backtrace log, select toolchain name, upload ELF binary with debug symbols
- New Node.js (Express) backend API on the Linux server to:
  - Receive uploaded ELF binary and backtrace log
  - Parse backtrace log to extract memory addresses
  - Invoke the specified toolchain's `addr2line` with the ELF binary to resolve addresses
  - Return resolved stack frames (function name, source file, line number)
- Display resolved stack trace in a readable format on the client

## Capabilities

### New Capabilities
- `stack-trace-client`: Web UI for inputting backtrace log, selecting toolchain, uploading ELF binary, and displaying resolved results
- `stack-trace-server`: Express API for receiving uploads, parsing backtrace, invoking addr2line, and returning resolved stack frames
- `backtrace-parser`: Logic to parse various backtrace log formats and extract addresses for addr2line

### Modified Capabilities
(none)

## Impact

- **Frontend**: New HTML page or tab added to existing index.html (or new stack-analyzer.html)
- **Backend**: New Express server project (requires Node.js on the Linux server)
- **Dependencies**: Node.js, Express, multer (file upload), child_process (addr2line invocation)
- **Deployment**: Backend must run on the same Linux server where cross-compilation toolchains are installed
- **Security**: File upload size limits, sanitize toolchain name input to prevent command injection
