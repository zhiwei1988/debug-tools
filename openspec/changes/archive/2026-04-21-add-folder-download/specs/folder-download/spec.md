## ADDED Requirements

### Requirement: Folder download endpoint
The server SHALL provide a `GET /api/files/download-folder` endpoint that accepts a relative path under `FILE_ROOT` and streams a zip archive of that directory's contents to the client, preserving the original directory structure.

#### Scenario: Download a regular subdirectory
- **WHEN** the client requests `GET /api/files/download-folder?path=<rel>` and `<rel>` resolves (via the existing `safePath` logic) to an existing directory strictly under `FILE_ROOT`
- **THEN** the response status is 200, the `Content-Type` is `application/zip`, the `Content-Disposition` declares `attachment` with filename `<basename>.zip` (encoded per RFC 5987 for non-ASCII names), and the body is a valid zip stream containing every file and subdirectory of that directory with their relative paths preserved.

#### Scenario: Path escapes FILE_ROOT
- **WHEN** the client supplies a path that resolves outside `FILE_ROOT` (e.g. `../etc`)
- **THEN** the server MUST respond with status 403 and JSON `{ "error": "Access denied" }`, and MUST NOT stream any bytes.

#### Scenario: Path is a file, not a directory
- **WHEN** the client supplies a path that exists but is a regular file
- **THEN** the server MUST respond with status 400 and JSON `{ "error": "Not a directory" }`, and MUST NOT stream any bytes.

#### Scenario: Path does not exist
- **WHEN** the client supplies a path that does not exist under `FILE_ROOT`
- **THEN** the server MUST respond with status 404 and a JSON error body, and MUST NOT stream any bytes.

#### Scenario: Root directory download is rejected
- **WHEN** the client supplies a path that resolves exactly to `FILE_ROOT` (e.g. `path=.`, empty, or `/`)
- **THEN** the server MUST respond with status 400 and JSON `{ "error": "Cannot download root" }`.

#### Scenario: Streaming failure mid-transfer
- **WHEN** the archiver emits an `error` event after the response headers have been flushed (e.g. a file becomes unreadable mid-stream)
- **THEN** the server MUST destroy the response socket so the client observes a truncated transfer, and MUST NOT send further bytes.

### Requirement: File Browser UI folder download action
The File Browser page (`file-browser.html`) SHALL render a "Download" action for every directory row (except the parent-link row `..`), which triggers the folder download endpoint.

#### Scenario: Directory row exposes Download button
- **WHEN** the file list is rendered for a non-root directory and the row represents a subdirectory `<d>`
- **THEN** the Action column MUST contain a "Download" button in addition to the existing "Delete" button.

#### Scenario: Clicking Download triggers the archive download
- **WHEN** the user clicks the Download button on directory `<d>` whose relative path is `<rel>`
- **THEN** the browser MUST initiate a download against `GET /api/files/download-folder?path=<encoded rel>`, and the browser SHALL save the response as `<d>.zip` by default.

#### Scenario: Parent link row has no Download button
- **WHEN** the list renders the special `..` parent-link row
- **THEN** no Download button is shown on that row.
