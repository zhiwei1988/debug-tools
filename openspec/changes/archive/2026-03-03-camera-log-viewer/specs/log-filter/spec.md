## ADDED Requirements

### Requirement: Filter by date
The system SHALL provide a date picker to filter log lines by date. Only lines with a parsed timestamp matching the selected date SHALL be shown.

#### Scenario: Select a specific date
- **WHEN** user selects date `2026-02-09`
- **THEN** only log lines with timestamps on `2026-02-09` are displayed

### Requirement: Filter by time range
The system SHALL provide time range inputs (start time, end time) to filter log lines. Lines with timestamps within the range SHALL be shown.

#### Scenario: Set time range
- **WHEN** user sets time range `09:00` to `12:00`
- **THEN** only log lines with timestamps between 09:00:00 and 12:00:00 are displayed

### Requirement: Filter by keyword with logical operators
The system SHALL provide a keyword input supporting logical operators: AND, OR, NOT. Default operator between space-separated terms SHALL be AND.

Syntax:
- `foo bar` or `foo AND bar`: line MUST contain both `foo` and `bar`
- `foo OR bar`: line MUST contain `foo` or `bar`
- `NOT foo` or `-foo`: line MUST NOT contain `foo`
- Parentheses for grouping: `(foo OR bar) AND NOT baz`

#### Scenario: AND filter
- **WHEN** user enters keyword `error timeout`
- **THEN** only lines containing both "error" and "timeout" are displayed

#### Scenario: OR filter
- **WHEN** user enters keyword `error OR warning`
- **THEN** lines containing "error" or "warning" are displayed

#### Scenario: NOT filter
- **WHEN** user enters keyword `error NOT debug`
- **THEN** lines containing "error" but not "debug" are displayed

#### Scenario: Grouped expression
- **WHEN** user enters keyword `(error OR warning) AND NOT debug`
- **THEN** lines containing "error" or "warning", but not "debug", are displayed

### Requirement: Combined filters
All active filters (date, time, keyword) SHALL be applied together with AND logic. Only lines matching all active filters SHALL be displayed.

#### Scenario: Date plus keyword
- **WHEN** user selects date `2026-02-09` and enters keyword `alarm`
- **THEN** only lines on `2026-02-09` containing "alarm" are displayed

### Requirement: Keyword matching is case-insensitive
Keyword filtering SHALL be case-insensitive by default.

#### Scenario: Case-insensitive match
- **WHEN** user enters keyword `Error`
- **THEN** lines containing "error", "Error", "ERROR" are all matched
