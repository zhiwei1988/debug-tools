## MODIFIED Requirements

### Requirement: Temporary File Safety

The server SHALL write data to a temporary file inside a dedicated collection directory `<FILE_ROOT>/.uploads-tmp/`, named `<random16>.part`. The file SHALL be renamed to the final target only after a successful `finish` with size verification. The `.uploads-tmp/` directory SHALL reside on the same filesystem as the final targets so that `fs.rename` is atomic.

#### Scenario: Tmp file created in collection directory

- **WHEN** server opens a tmp file for upload to target `foo/bar.bin`
- **THEN** the tmp file is created as `<FILE_ROOT>/.uploads-tmp/<16-char-random>.part`, independent of the target's directory

#### Scenario: Collection directory is created lazily

- **WHEN** server attempts to open a tmp file and `<FILE_ROOT>/.uploads-tmp/` does not exist
- **THEN** the server creates the directory with `recursive: true` before opening the tmp file

#### Scenario: Concurrent uploads to same target do not corrupt tmp

- **WHEN** two WebSocket connections both initiate upload to `foo/bar.bin` simultaneously
- **THEN** each gets a distinct tmp file in `.uploads-tmp/`, and whichever `finish` completes later overwrites the earlier on rename

#### Scenario: Finish renames tmp to target

- **WHEN** client sends `finish` and `received === size`
- **THEN** server closes the tmp file and renames `<FILE_ROOT>/.uploads-tmp/<random16>.part` to the target path under `FILE_ROOT`

### Requirement: Orphan Tmp Cleanup

The server SHALL remove stale tmp files by scanning only `<FILE_ROOT>/.uploads-tmp/` (non-recursive) on startup. The scan SHALL run asynchronously **after** the HTTP listener has started, so that cleanup never delays the server from accepting connections. The server SHALL also remove the current session's tmp file when the WebSocket closes mid-transfer.

Additionally, on the **first** startup after upgrading to the collection-directory layout, the server SHALL perform a one-time recursive sweep of `FILE_ROOT` to delete legacy `*.uploading.*` residues left by the previous layout. This one-time sweep SHALL be guarded by a sentinel file at `<FILE_ROOT>/.uploads-tmp/.legacy-cleaned`: the sweep runs only if the sentinel is absent, and creates the sentinel on completion. Subsequent starts SHALL skip the recursive sweep entirely.

#### Scenario: Startup cleanup scans only collection directory

- **WHEN** server starts and the legacy sentinel already exists
- **THEN** the server scans only `<FILE_ROOT>/.uploads-tmp/` (a single directory, non-recursive) and deletes any `*.part` entry found
- **AND** the server does not touch any other path under `FILE_ROOT`

#### Scenario: Cleanup does not block HTTP listener

- **WHEN** the server starts
- **THEN** the HTTP listener begins accepting connections before orphan cleanup begins
- **AND** cleanup is scheduled via `setImmediate` (or equivalent) so it runs after the first tick

#### Scenario: Cleanup snapshot avoids racing new uploads

- **WHEN** orphan cleanup runs while a fresh upload has just created a new tmp file in `.uploads-tmp/`
- **THEN** cleanup only deletes entries captured in the `readdir` snapshot taken at the start of cleanup
- **AND** the fresh tmp file created after the snapshot is preserved

#### Scenario: First-time legacy sweep on upgrade

- **WHEN** the server starts and `<FILE_ROOT>/.uploads-tmp/.legacy-cleaned` does not exist
- **THEN** the server performs a recursive sweep of `FILE_ROOT` in the background, deleting any file whose name matches `*.uploading.*`
- **AND** the server creates the sentinel file on successful completion of the sweep

#### Scenario: Subsequent starts skip legacy sweep

- **WHEN** the server starts and `<FILE_ROOT>/.uploads-tmp/.legacy-cleaned` already exists
- **THEN** the server does not perform any recursive scan of `FILE_ROOT`

#### Scenario: Cleanup on mid-transfer disconnect

- **WHEN** a WebSocket closes while state is `receiving` or `finalizing`
- **THEN** the current tmp file in `.uploads-tmp/` is deleted

### Requirement: Upload Initiation Message

The client SHALL begin each file upload by sending a JSON text frame with `type: "init"`, including the fields `path` (target directory relative to `FILE_ROOT`), `relPath` (file path relative to the target directory, preserving subdirectories), and `size` (total file size in bytes). The server SHALL respond with a JSON text frame `{ type: "ready" }` after creating a temporary file inside `<FILE_ROOT>/.uploads-tmp/` and creating any missing target directories under `<FILE_ROOT>/<path>/<dirname(relPath)>/`.

#### Scenario: Valid init opens tmp file in collection directory

- **WHEN** client sends `{ type: "init", path: "logs", relPath: "2026/04/a.log", size: 1024 }` while connection is `idle`
- **THEN** server creates directory `logs/2026/04/` under `FILE_ROOT` if missing, opens `<FILE_ROOT>/.uploads-tmp/<random16>.part` for writing, and sends `{ type: "ready" }`

#### Scenario: Init with unsafe path is rejected

- **WHEN** client sends `init` with `relPath` that resolves outside `FILE_ROOT` (e.g., `../../etc/passwd`)
- **THEN** server sends `{ type: "error", msg: <access denied> }` and remains `idle`

#### Scenario: Init without size is rejected

- **WHEN** client sends `init` missing the `size` field
- **THEN** server sends `{ type: "error", msg: <missing size> }` and remains `idle`

#### Scenario: Init while already transferring is rejected

- **WHEN** client sends `init` while the connection is in `receiving` or `finalizing` state
- **THEN** server sends `{ type: "error", msg: <protocol error: concurrent init> }` and current transfer is aborted

### Requirement: Finish and Atomic Rename

The client SHALL send `{ type: "finish" }` after all binary frames. The server SHALL verify `received === size`, close the tmp file, and atomically rename it from `<FILE_ROOT>/.uploads-tmp/<random16>.part` to the target path. On success the server SHALL send `{ type: "done", path: <final-rel-path> }`.

#### Scenario: Finish with size match

- **WHEN** client sends `finish` and `received === size`
- **THEN** server closes tmp, renames `<FILE_ROOT>/.uploads-tmp/<random16>.part` to the target path, sends `{ type: "done", path: <final-rel-path> }`, and returns to `idle`

#### Scenario: Finish with size mismatch

- **WHEN** client sends `finish` and `received !== size`
- **THEN** server sends `{ type: "error", msg: <size mismatch> }`, removes the tmp file from `.uploads-tmp/`, and returns to `idle`
