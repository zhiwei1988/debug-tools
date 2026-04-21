## 1. Dependencies

- [x] 1.1 Add `ws` to `server/package.json` dependencies and run `npm install` inside `server/`
- [x] 1.2 Confirm `multer` is still required (only by `/api/analyze`); do not remove the package

## 2. Server: Remove HTTP Upload Route

- [x] 2.1 Delete the `POST /api/files/upload` route handler in `server/index.js`
- [x] 2.2 Delete the `fileUpload` multer instance (the one with 500 MB limit) in `server/index.js`
- [x] 2.3 Verify `/api/files/list`, `/api/files/download`, `/api/files/download-folder`, `/api/files/mkdir`, `/api/files/delete` still work unchanged

## 3. Server: WebSocket Upload Handler

- [x] 3.1 Import `WebSocketServer` from `ws` in `server/index.js`
- [x] 3.2 Attach a `WebSocketServer` to the HTTP server instance returned by `app.listen(...)` on path `/ws`
- [x] 3.3 Implement per-connection session object: `{ state, target, tmp, size, received, stream, lastAck, ackBytes, ackTimer, idleTimer }`
- [x] 3.4 Implement `init` handler: validate `path` / `relPath` via `safePath(join(path, relPath))`, ensure `size` is present and numeric, `mkdirSync(dirname(target), { recursive: true })`, open `<target>.uploading.<random6>` for write, set state to `receiving`, send `ready`
- [x] 3.5 Implement binary-frame handler: call `ws.pause()`, `stream.write(data, () => ws.resume())`, update `received`, enforce `received <= size`, trigger ack if thresholds met
- [x] 3.6 Implement ack scheduler: emit `{type:"ack", received}` when either 1 MB accumulated since last ack or 200 ms elapsed since last ack
- [x] 3.7 Implement `finish` handler: `stream.end(cb)`, verify `received === size`, `renameSync(tmp, target)`, send final ack then `{type:"done", path: <final-rel-path>}`, reset state to `idle`
- [x] 3.8 Implement `abort` handler: close stream, unlink tmp, reset state to `idle`
- [x] 3.9 Implement idle timeout: 30 s after `ready` without binary frame, 30 s between binary frames during `receiving`; on timeout emit `error` and close WS
- [x] 3.10 Implement WS close handler: if session has open tmp, destroy stream and unlink tmp
- [x] 3.11 Implement `init`-while-not-idle protocol error: abort current tmp and send `error`
- [x] 3.12 Centralize error emission helper (`sendError(msg)`) used by all failure paths

## 4. Server: Orphan Cleanup

- [x] 4.1 On server start, recursively walk `FILE_ROOT` and `unlink` any file matching `*.uploading.*`
- [x] 4.2 Confirm the walk handles nested directories and unreadable subpaths without crashing the server startup

## 5. Client: WS Upload Module

- [x] 5.1 Replace the `uploadInput.addEventListener('change', ...)` block in `file-browser.html` with a WS-based upload flow
- [x] 5.2 Implement on-demand connection: lazy-open WS only when user triggers an upload and no WS is currently open; cache the WS instance for reuse
- [x] 5.3 Implement 30 s idle-close timer armed after each `done`, reset on new `init`, cleared when WS closes
- [x] 5.4 For each `file` in `uploadInput.files` / `webkitdirectory` selection: send `init` with `path=currentPath`, `relPath=file.webkitRelativePath || file.name`, `size=file.size`; await `ready`
- [x] 5.5 Read file via `file.stream().getReader()`, send each `value` as binary frame with backpressure loop: `while (ws.bufferedAmount >= 8*1024*1024) await sleep(10)`
- [x] 5.6 Send `finish` after last chunk; await `done`; accumulate progress from `ack` events
- [x] 5.7 On `error` event, abort loop, show error to user, close WS (or reset to idle)
- [x] 5.8 Add per-file progress indicator in the UI (percentage driven by `ack.received / file.size`)
- [x] 5.9 Handle WS `close` mid-upload: surface error to user, clear progress UI

## 6. Client: Folder Upload Support

- [x] 6.1 Ensure `uploadInput` accepts both files and folders (add `webkitdirectory` as an alternate input or toggle; confirm existing `multiple` remains)
- [x] 6.2 Verify `file.webkitRelativePath` is populated for folder drops and passed as `relPath`

## 7. Smoke Tests (manual on LAN)

- [x] 7.1 Upload single small file (<1 MB); verify `done` and file appears in target directory
- [x] 7.2 Upload single large file (>500 MB, previously blocked by multer cap); verify streaming progress and final size match
- [x] 7.3 Upload a folder with nested subdirectories; verify directory structure is preserved on server
- [x] 7.4 Close browser tab mid-upload; verify tmp file removed on server and no orphan in target directory
- [x] 7.5 Kill server mid-upload, restart; verify startup orphan cleanup removes `.uploading.*`
- [x] 7.6 Two browser tabs upload to same target path; verify no tmp collision and last-writer semantics

## 8. Cleanup

- [x] 8.1 Remove any dead imports or helper variables left from the old multer path
- [x] 8.2 Update `README.md` if it documents the old HTTP upload endpoint
