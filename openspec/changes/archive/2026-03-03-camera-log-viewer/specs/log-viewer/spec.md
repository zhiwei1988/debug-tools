## ADDED Requirements

### Requirement: Unified log view
The system SHALL display all collected log lines in a single unified view, sorted by source file. Each line SHALL show its source file name and line number.

#### Scenario: Multiple log files extracted
- **WHEN** tar contains 5 log files
- **THEN** all lines from all 5 files appear in the unified log viewer

### Requirement: Virtual scrolling
The system SHALL use virtual scrolling to render only visible log lines. The viewport SHALL render approximately 50-100 lines at a time regardless of total line count.

#### Scenario: Large log with 100k lines
- **WHEN** filtered results contain 100,000 lines
- **THEN** only ~50-100 DOM elements exist at any time, scrolling is smooth

### Requirement: Render only filtered results
The log viewer SHALL display only lines that pass all active filters. When no filters are active, all lines SHALL be displayed.

#### Scenario: Apply filter reduces visible lines
- **WHEN** user enters a keyword filter
- **THEN** log viewer immediately updates to show only matching lines

### Requirement: Timestamp parsing
The system SHALL attempt to parse timestamps from log lines using common patterns: `YYYY-MM-DD HH:MM:SS`, `MMM DD HH:MM:SS`, `YYYY/MM/DD HH:MM:SS`. Lines without recognizable timestamps SHALL inherit the most recent timestamp from preceding lines in the same file.

#### Scenario: Standard timestamp format
- **WHEN** a log line contains `2026-02-09 11:03:14`
- **THEN** system parses it as date=2026-02-09, time=11:03:14

#### Scenario: Line without timestamp
- **WHEN** a log line has no recognizable timestamp but the previous line had `2026-02-09 11:03:14`
- **THEN** the line inherits timestamp `2026-02-09 11:03:14` for filtering purposes
