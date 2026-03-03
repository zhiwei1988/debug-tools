## ADDED Requirements

### Requirement: Support plain tar file input
The system SHALL accept both `.tar` and `.tar.gz`/`.tgz` files as input. Detection SHALL be based on gzip magic bytes (`1f 8b`) at file start, not file extension.

#### Scenario: Upload a plain tar file
- **WHEN** user uploads a file without gzip magic bytes
- **THEN** system parses it directly as tar without attempting gzip decompression

#### Scenario: Upload a tar.gz file
- **WHEN** user uploads a file with gzip magic bytes `1f 8b`
- **THEN** system decompresses via gzip first, then parses the tar stream

### Requirement: Accept tar file via upload or drag-and-drop
The system SHALL accept `.tar` files through the file picker and drag-and-drop area. The file input accept attribute SHALL include `.tar`.

#### Scenario: Drag and drop a tar file
- **WHEN** user drags a `.tar` file onto the upload area
- **THEN** system accepts the file and begins parsing
