## Context

The web-decompress project is a single-page static web app (index.html) for parsing tar.gz files in the browser. We are adding a new page for embedded stack trace analysis. Unlike the existing pure-client functionality, this feature requires a backend service running on a Linux server where cross-compilation toolchains are installed.

Architecture: Browser (Windows) → HTTP API → Express server (Linux) → addr2line (toolchain)

## Goals / Non-Goals

**Goals:**
- Web UI to submit backtrace log + toolchain name + ELF binary, get resolved stack trace
- Backend API that safely invokes addr2line from specified toolchains
- Support multiple toolchain paths via server-side configuration
- Clear, readable output showing function names, source files, and line numbers

**Non-Goals:**
- Real-time/streaming analysis (batch request-response is sufficient)
- Toolchain installation or management via the web UI
- Source code display or inline annotation
- User authentication (assumes internal/trusted network)

## Decisions

### 1. Separate HTML page vs tab in existing index.html
**Decision**: New standalone `stack-analyzer.html` page with link from index.html.
**Rationale**: The existing page is focused on file decompression. Stack analysis is a distinct workflow. Separate page keeps both simple. Cross-link via nav.

### 2. Toolchain discovery
**Decision**: Server-side config file (`toolchains.json`) mapping toolchain names to their `addr2line` binary paths. API endpoint `/api/toolchains` returns available names.
**Rationale**: Toolchains are installed at fixed paths on the server. Config file is simple to maintain. Client fetches the list dynamically — no hardcoding.

Example `toolchains.json`:
```json
{
  "arm-none-eabi": "/opt/gcc-arm/bin/arm-none-eabi-addr2line",
  "xtensa-esp32-elf": "/opt/esp-idf/tools/xtensa-esp32-elf-addr2line"
}
```

### 3. File upload strategy
**Decision**: Multipart form upload via `multer`. ELF binary uploaded as temp file, deleted after analysis completes.
**Rationale**: ELF files can be large (tens of MB). Temp file approach avoids memory pressure. Cleanup on completion prevents disk bloat.

### 4. Backtrace parsing approach
**Decision**: Server-side regex parsing to extract hex addresses from common backtrace formats (GDB, ESP-IDF panic handler, ARM HardFault, generic `0x` addresses).
**Rationale**: Backtrace formats vary by platform but addresses always appear as hex. A set of regex patterns covers the common cases. Unrecognized lines are passed through as-is.

### 5. addr2line invocation
**Decision**: Batch mode — pass all addresses in a single `addr2line -e <elf> -f -C -p <addr1> <addr2> ...` call.
**Rationale**: Single process invocation is faster than per-address calls. The `-f` flag includes function names, `-C` demangles C++ symbols, `-p` gives pretty output.

### 6. Security: command injection prevention
**Decision**: Validate toolchain name against config keys (whitelist). Validate addresses as hex strings. Use `execFile` (not `exec`) to avoid shell interpretation. Limit upload size.
**Rationale**: Toolchain name and addresses are user input that end up in a command. Whitelist + execFile eliminates injection vectors.

## Risks / Trade-offs

- **Large ELF files** → Set upload limit (e.g., 100MB), return clear error if exceeded
- **addr2line timeout** → Set child_process timeout (30s), kill on timeout, return error
- **Unsupported backtrace format** → Gracefully degrade: show raw addresses that couldn't be parsed, resolved ones where possible
- **Toolchain not found on disk** → Validate path existence at server startup and on request, return descriptive error
- **Concurrent uploads** → Each request uses its own temp file with unique name; no shared state issues
