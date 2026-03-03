## ADDED Requirements

### Requirement: Decompress nested gz files
The system SHALL detect `.gz` entries inside the tar and decompress them using pako. The decompressed content SHALL be treated as a log file.

#### Scenario: Tar contains a gzipped log
- **WHEN** tar contains `utasrunlog_2026-02-05_14-59-11_21.gz`
- **THEN** system decompresses it and presents the text content as a log file named `utasrunlog_2026-02-05_14-59-11_21`

### Requirement: Decompress nested tgz files
The system SHALL detect `.tgz` entries inside the tar and decompress then parse them as tar archives recursively. All files extracted from the nested tar SHALL be collected.

#### Scenario: Tar contains a tgz archive
- **WHEN** tar contains `0_kbox.log.tgz`
- **THEN** system decompresses the gzip layer, parses the inner tar, and extracts all files within

### Requirement: Recursion depth limit
The system SHALL limit nested decompression to 2 levels to prevent infinite recursion.

#### Scenario: Deeply nested tgz
- **WHEN** a tgz inside a tgz contains another tgz
- **THEN** system stops decompressing at the third level and treats remaining archives as raw files

### Requirement: Treat bin files as log files
The system SHALL treat `.bin` files as text log files and include them in the log viewer.

#### Scenario: Tar contains bin log files
- **WHEN** tar contains `utasoperatelog.bin`
- **THEN** system reads it as text and includes it in the log collection
