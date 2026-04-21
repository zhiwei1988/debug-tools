# file-upload Specification

## Purpose
TBD - created by syncing change upload-ws-rpc. Update Purpose after archive.

## Requirements

### Requirement: WebSocket Upload Endpoint

The server SHALL expose a WebSocket endpoint at path `/ws` that is the sole mechanism for uploading files to `FILE_ROOT`. No HTTP multipart upload route SHALL be available.

#### Scenario: Client connects to /ws
- **WHEN** a client opens a WebSocket to `/ws`
- **THEN** the server accepts the connection and enters the `idle` state for that connection

#### Scenario: Legacy HTTP upload route is absent
- **WHEN** a client sends `POST /api/files/upload` with any body
- **THEN** the server responds with HTTP 404

### Requirement: Upload Initiation Message

The client SHALL begin each file upload by sending a JSON text frame with `type: "init"`, including the fields `path` (target directory relative to `FILE_ROOT`), `relPath` (file path relative to the target directory, preserving subdirectories), and `size` (total file size in bytes). The server SHALL respond with a JSON text frame `{ type: "ready" }` after creating a temporary file.

#### Scenario: Valid init opens tmp file
- **WHEN** client sends `{ type: "init", path: "logs", relPath: "2026/04/a.log", size: 1024 }` while connection is `idle`
- **THEN** server creates directory `logs/2026/04/` if missing, opens `logs/2026/04/a.log.uploading.<random6>` for writing, and sends `{ type: "ready" }`

#### Scenario: Init with unsafe path is rejected
- **WHEN** client sends `init` with `relPath` that resolves outside `FILE_ROOT` (e.g., `../../etc/passwd`)
- **THEN** server sends `{ type: "error", msg: <access denied> }` and remains `idle`

#### Scenario: Init without size is rejected
- **WHEN** client sends `init` missing the `size` field
- **THEN** server sends `{ type: "error", msg: <missing size> }` and remains `idle`

#### Scenario: Init while already transferring is rejected
- **WHEN** client sends `init` while the connection is in `receiving` or `finalizing` state
- **THEN** server sends `{ type: "error", msg: <protocol error: concurrent init> }` and current transfer is aborted

### Requirement: Streamed Binary Data Transfer

After `ready`, the client SHALL send file contents as WebSocket binary frames. The server SHALL append each frame to the temporary file in order.

#### Scenario: Binary frame appended to tmp
- **WHEN** connection is in `receiving` state and client sends a binary frame of N bytes
- **THEN** server writes N bytes to the current tmp file and increments `received` by N

#### Scenario: Received exceeds declared size
- **WHEN** cumulative `received` bytes would exceed the `size` declared in `init`
- **THEN** server sends `{ type: "error", msg: <oversize> }`, removes the tmp file, and resets to `idle`

### Requirement: Acknowledgement Messages for Progress and Liveness

The server SHALL emit `{ type: "ack", received: <bytes-persisted> }` messages during transfer. An ack SHALL be sent whenever at least 1 MB has been persisted since the last ack, or at least 200 ms has elapsed since the last ack, whichever comes first. A final ack SHALL be sent immediately before `done`.

#### Scenario: Ack fires after 1 MB
- **WHEN** server has persisted 1 MB of data since the last ack
- **THEN** server sends an `ack` with the current cumulative `received` value

#### Scenario: Ack fires after 200 ms
- **WHEN** 200 ms has elapsed since the last ack and at least one byte has been persisted
- **THEN** server sends an `ack` with the current cumulative `received` value

#### Scenario: Final ack before done
- **WHEN** server is about to send `done`
- **THEN** server first sends an `ack` with `received === size`

### Requirement: Finish and Atomic Rename

The client SHALL send `{ type: "finish" }` after all binary frames. The server SHALL verify `received === size`, close the tmp file, and atomically rename it to the target path. On success the server SHALL send `{ type: "done", path: <final-rel-path> }`.

#### Scenario: Finish with size match
- **WHEN** client sends `finish` and `received === size`
- **THEN** server closes tmp, renames `<target>.uploading.<random6>` to `<target>`, sends `{ type: "done", path: <final-rel-path> }`, and returns to `idle`

#### Scenario: Finish with size mismatch
- **WHEN** client sends `finish` and `received !== size`
- **THEN** server sends `{ type: "error", msg: <size mismatch> }`, removes the tmp file, and returns to `idle`

### Requirement: Client Abort

The client SHALL be able to cancel an in-progress upload by sending `{ type: "abort" }` or by closing the WebSocket. The server SHALL remove the current tmp file and return to `idle` (or terminate, if the WS closed).

#### Scenario: Explicit abort
- **WHEN** client sends `abort` during `receiving`
- **THEN** server removes the current tmp file and transitions to `idle` without sending `done`

#### Scenario: WebSocket closes mid-transfer
- **WHEN** the WebSocket connection closes during `receiving` or `finalizing`
- **THEN** server removes the current tmp file

### Requirement: Transfer Timeouts

The server SHALL enforce idle timeouts on the data path. If no binary frame is received for 30 seconds after `ready`, or no binary frame is received for 30 seconds while in `receiving`, the server SHALL emit an `error` and close the WebSocket.

#### Scenario: No data after ready
- **WHEN** 30 seconds elapse after `ready` without any binary frame
- **THEN** server sends `{ type: "error", msg: <timeout> }` and closes the connection

#### Scenario: Idle mid-transfer
- **WHEN** 30 seconds elapse while in `receiving` without any binary frame
- **THEN** server sends `{ type: "error", msg: <timeout> }` and closes the connection

### Requirement: Backpressure

The server SHALL apply backpressure by pausing the WebSocket until the tmp file write flushes. The client SHALL apply backpressure by waiting until `ws.bufferedAmount < 8 MB` before sending the next chunk.

#### Scenario: Server pauses when disk is slow
- **WHEN** server receives a binary frame while the previous write has not flushed
- **THEN** server calls `ws.pause()` before issuing the next `write`, and calls `ws.resume()` from the write callback

#### Scenario: Client throttles send buffer
- **WHEN** client is reading from `File.stream()` and `ws.bufferedAmount` is ≥ 8 MB
- **THEN** client waits until `bufferedAmount` drops below 8 MB before sending the next chunk

### Requirement: Temporary File Safety

The server SHALL write data to a temporary file named `<target>.uploading.<random6>` in the same directory as the final target. The file SHALL be renamed to the final target only after a successful `finish` with size verification.

#### Scenario: Tmp file name includes random suffix
- **WHEN** server opens a tmp file for upload to target `foo/bar.bin`
- **THEN** the tmp file is named `foo/bar.bin.uploading.<6-char-random>` in the same directory

#### Scenario: Concurrent uploads to same target do not corrupt tmp
- **WHEN** two WebSocket connections both initiate upload to `foo/bar.bin` simultaneously
- **THEN** each gets a distinct tmp file, and whichever `finish` completes later overwrites the earlier on rename

### Requirement: Orphan Tmp Cleanup

The server SHALL remove stale `.uploading.*` files on startup by recursively scanning `FILE_ROOT` and deleting any file whose name matches the pattern `*.uploading.*`. The server SHALL also remove the current session's tmp file when the WebSocket closes mid-transfer.

#### Scenario: Startup cleanup after crash
- **WHEN** server starts and finds `logs/a.log.uploading.abc123` left from a prior run
- **THEN** server deletes that file before accepting new connections

#### Scenario: Cleanup on mid-transfer disconnect
- **WHEN** a WebSocket closes while state is `receiving` or `finalizing`
- **THEN** the current tmp file is deleted

### Requirement: On-Demand Client Connection Lifecycle

The client SHALL open the WebSocket only when the user initiates an upload, and SHALL close the connection after a 30-second idle window following the last `done` with no subsequent `init`. A new upload after close SHALL open a fresh WebSocket.

#### Scenario: Connection opens on upload trigger
- **WHEN** user selects files for upload and no WebSocket is currently open
- **THEN** client opens a new WebSocket to `/ws` before sending `init`

#### Scenario: Idle close after 30s
- **WHEN** 30 seconds elapse after the last `done` with no new `init`
- **THEN** client closes the WebSocket

#### Scenario: Reopen on next upload
- **WHEN** user initiates a new upload after the WebSocket has been closed for idle
- **THEN** client opens a new WebSocket and proceeds with `init`

### Requirement: Directory Structure Preservation

When the client uploads a folder, each file's `init` SHALL include its `webkitRelativePath` as `relPath`. The server SHALL create any missing intermediate directories under the target `path` before opening the tmp file.

#### Scenario: Folder upload preserves layout
- **WHEN** client uploads a folder containing `docs/v1/readme.md`
- **THEN** server creates `docs/v1/` under the target path if absent and writes `readme.md` inside it

### Requirement: Serial Upload Channel Per Connection

Each WebSocket connection SHALL handle at most one active upload at any time. Binary frames are always attributed to the most recent `init` that has not yet been followed by `done`, `error`, or `abort`.

#### Scenario: Sequential files share one WS
- **WHEN** client uploads files A and B in sequence over one WebSocket
- **THEN** client sends `init(A) → ready → binary... → finish → done`, then `init(B) → ready → binary... → finish → done`, with no overlap
