## 1. Server Setup

- [x] 1.1 Initialize Express project with package.json in `server/` directory
- [x] 1.2 Create `toolchains.json` config file with example toolchain entries
- [x] 1.3 Configure multer for file upload with 100MB size limit and temp directory

## 2. Backtrace Parser

- [x] 2.1 Implement backtrace parser module with regex patterns for GDB, ESP-IDF, ARM HardFault, and generic hex formats
- [x] 2.2 Implement address deduplication and original-line context association

## 3. Server API

- [x] 3.1 Implement `GET /api/toolchains` endpoint reading from config file
- [x] 3.2 Implement `POST /api/analyze` endpoint with field validation
- [x] 3.3 Implement toolchain name whitelist validation against config keys
- [x] 3.4 Implement addr2line invocation via `execFile` with batch mode (`-e -f -C -p`) and 30s timeout
- [x] 3.5 Parse addr2line output into structured JSON frames
- [x] 3.6 Implement temp file cleanup in finally block (success and failure paths)
- [x] 3.7 Add CORS headers for cross-origin client access

## 4. Client Page

- [x] 4.1 Create `stack-analyzer.html` with page structure: toolchain dropdown, backtrace textarea, file upload, analyze button, result area
- [x] 4.2 Implement toolchain list fetch on page load and dropdown population
- [x] 4.3 Implement form validation (all fields required) with visual feedback
- [x] 4.4 Implement multipart form submission to `POST /api/analyze`
- [x] 4.5 Implement loading state (spinner + disabled button) during analysis
- [x] 4.6 Implement result display: formatted stack frames with function, file, line; visual indicator for unresolved addresses
- [x] 4.7 Implement error display for server errors and network failures

## 5. Integration

- [x] 5.1 Add navigation link from `index.html` to `stack-analyzer.html` and vice versa
- [x] 5.2 End-to-end verification with a real toolchain and sample backtrace
