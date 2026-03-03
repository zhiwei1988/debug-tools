## ADDED Requirements

### Requirement: Toolchain list endpoint
The server SHALL expose `GET /api/toolchains` returning an array of available toolchain names read from the config file.

#### Scenario: Config file exists with toolchains
- **WHEN** a GET request is made to `/api/toolchains`
- **THEN** the server returns JSON `{ "toolchains": ["arm-none-eabi", ...] }` with status 200

#### Scenario: Config file missing or empty
- **WHEN** the config file is missing or contains no entries
- **THEN** the server returns `{ "toolchains": [] }` with status 200

### Requirement: Analysis endpoint
The server SHALL expose `POST /api/analyze` accepting multipart form data with fields: `backtrace` (text), `toolchain` (string), `elf` (file).

#### Scenario: Valid request
- **WHEN** a POST is made with all required fields and a valid toolchain name
- **THEN** the server parses the backtrace, invokes addr2line, and returns resolved frames with status 200

#### Scenario: Invalid toolchain name
- **WHEN** the toolchain name does not match any key in the config
- **THEN** the server returns status 400 with error `"Unknown toolchain"`

#### Scenario: Missing required field
- **WHEN** any of backtrace, toolchain, or elf is missing
- **THEN** the server returns status 400 with error indicating the missing field

### Requirement: Temp file cleanup
The server SHALL delete uploaded ELF temp files after analysis completes, whether successful or failed.

#### Scenario: Cleanup after success
- **WHEN** addr2line completes successfully
- **THEN** the uploaded temp file is deleted

#### Scenario: Cleanup after failure
- **WHEN** addr2line fails or times out
- **THEN** the uploaded temp file is still deleted

### Requirement: addr2line invocation security
The server SHALL use `execFile` (not shell exec) and validate the toolchain name against the config whitelist before invocation.

#### Scenario: Whitelisted toolchain
- **WHEN** toolchain name matches a config key
- **THEN** the server invokes the corresponding addr2line binary path via `execFile`

#### Scenario: Injection attempt in toolchain name
- **WHEN** toolchain name contains shell metacharacters or does not match any config key
- **THEN** the server rejects the request with status 400 without invoking any process

### Requirement: Upload size limit
The server SHALL enforce a maximum upload size of 100MB for the ELF binary.

#### Scenario: File within limit
- **WHEN** an ELF file under 100MB is uploaded
- **THEN** the upload is accepted normally

#### Scenario: File exceeds limit
- **WHEN** an ELF file over 100MB is uploaded
- **THEN** the server returns status 413 with an error message

### Requirement: addr2line timeout
The server SHALL kill the addr2line process if it does not complete within 30 seconds.

#### Scenario: Process exceeds timeout
- **WHEN** addr2line runs longer than 30 seconds
- **THEN** the process is killed and the server returns status 504 with a timeout error

### Requirement: Response format
The server SHALL return resolved stack frames as a JSON array.

#### Scenario: Successful resolution
- **WHEN** addr2line produces output
- **THEN** the server returns `{ "frames": [{ "address": "0x...", "function": "...", "file": "...", "line": N }, ...] }`
