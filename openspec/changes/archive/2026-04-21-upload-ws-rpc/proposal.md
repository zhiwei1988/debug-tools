## Why

The current File Browser upload uses `multipart/form-data` POST via multer, which has three concrete limits on our LAN tooling use case: (1) no upload progress, (2) hard-coded 500 MB per-file cap from multer buffering, (3) folder uploads collapse into a flat filename list because `webkitRelativePath` is dropped and multer does not preserve directory structure.

## What Changes

- **BREAKING**: Replace `POST /api/files/upload` with a WebSocket endpoint `/ws` that carries a minimal custom RPC for file transfer.
- Transfer is chunked and streamed: client reads via `File.stream()` and sends binary frames; server appends to a `.uploading.<rand>` tmp file and atomically renames on `finish`.
- Folder uploads preserve directory layout by sending `relPath` in each `init`; server `mkdirSync` recursively under the target path.
- Progress reporting is based on server `ack` messages (actual bytes persisted), not bytes sent.
- On-demand connection: client opens WS only when user triggers upload; closes after 30 s idle.
- Remove `multer` dependency entirely; no backward-compatible HTTP upload route retained.
- Single WS = one serial upload channel. No multiplexing, no client-side WS pool. 1000-small-file folder uploads will be slower than theoretically optimal; acceptable on LAN.

## Capabilities

### New Capabilities
- `file-upload`: WebSocket-based chunked file upload protocol for the File Browser. Covers connection lifecycle, message schema (`init`/`ready`/binary/`ack`/`finish`/`done`/`error`/`abort`), flow control, size verification, tmp-file safety, and orphan cleanup.

### Modified Capabilities
(none — no existing `file-browser` spec to amend; the other listing/download routes keep their current HTTP semantics)

## Impact

- **Server** (`server/index.js`): Remove `/api/files/upload` route and its `fileUpload` multer instance. Remove `multer` `require` (still used by `/api/analyze` — keep that one). Add `ws` library, WS upgrade handler on `/ws`, per-connection state machine, startup orphan cleanup scan.
- **Server deps** (`server/package.json`): add `ws`.
- **Client** (`file-browser.html`): Replace `FormData` + `fetch` block with a WS client module (connect on demand, serial loop over `uploadInput.files`, backpressure via `bufferedAmount`, progress bar driven by `ack`, idle close after 30 s).
- **File layout**: `.uploading.<random>` tmp files appear under `FILE_ROOT` during transfers and are cleaned on server startup and on WS close.
- **UI**: add per-file progress indicator (currently blank during upload).
- No change to `/api/files/list`, `/api/files/download`, `/api/files/download-folder`, `/api/files/mkdir`, `/api/files/delete`, or the Log Parser / stack analyzer paths.
