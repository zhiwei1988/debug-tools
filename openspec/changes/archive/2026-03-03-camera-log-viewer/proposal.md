## Why

Camera product collects device logs as a tar archive containing mixed file types: plain text logs, gzip-compressed logs (.gz), tgz archives, and binary files (.bin). Currently the app can decompress tar.gz but cannot handle the nested compressed files inside, nor provide log filtering/visualization. Engineers need a way to upload the tar, auto-decompress all nested archives, and search/filter logs by date, time, and keyword.

## What Changes

- Support uploading plain `.tar` files (not just `.tar.gz`)
- Recursively decompress nested compressed files inside the tar: `.gz`, `.tgz` entries
- Collect all decompressed log content into a unified view
- Add log filtering UI: date picker, time range, keyword search with logical operators (AND/OR/NOT)
- Render only filtered results with syntax highlighting and virtual scrolling for large logs
- Treat `.bin` files as log files (device binary logs)

## Capabilities

### New Capabilities
- `tar-extract`: Support extracting plain `.tar` archives in addition to existing `.tar.gz`
- `nested-decompress`: Recursively decompress `.gz` and `.tgz` files found inside the tar
- `log-filter`: Filter collected log lines by date, time range, and keyword
- `log-viewer`: Visualize filtered log results with virtual scrolling

### Modified Capabilities
None (no existing specs)

## Impact

- `decompress-worker.js`: Extend to handle plain tar and nested decompression
- `index.html`: Add filter UI components and log viewer section
- New worker logic for recursive decompression of nested `.gz`/`.tgz`
- May need additional UI state management for filter controls
