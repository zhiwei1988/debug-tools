## ADDED Requirements

### Requirement: Toolchain selection
The client SHALL fetch available toolchain names from the server API and display them in a dropdown selector.

#### Scenario: Page load populates toolchain list
- **WHEN** the stack analyzer page loads
- **THEN** the client fetches `GET /api/toolchains` and populates the dropdown with returned toolchain names

#### Scenario: Server unreachable
- **WHEN** the toolchain API request fails
- **THEN** the client displays an error message indicating the server is unavailable

### Requirement: Backtrace log input
The client SHALL provide a textarea for pasting backtrace log content.

#### Scenario: User pastes backtrace
- **WHEN** user pastes text into the backtrace textarea
- **THEN** the content is stored and ready for submission

### Requirement: ELF binary upload
The client SHALL provide a file input for uploading an ELF binary with debug symbols.

#### Scenario: User selects ELF file
- **WHEN** user selects a file via the file input
- **THEN** the file is staged for upload with its filename displayed

### Requirement: Submit analysis request
The client SHALL send a multipart POST request to the server with the backtrace log, toolchain name, and ELF binary.

#### Scenario: Successful submission
- **WHEN** user clicks the analyze button with all fields filled
- **THEN** the client sends `POST /api/analyze` with multipart form data containing backtrace text, toolchain name, and ELF file

#### Scenario: Missing required fields
- **WHEN** user clicks analyze with any required field empty
- **THEN** the client highlights the missing field and prevents submission

### Requirement: Display resolved stack trace
The client SHALL display the server response as a formatted, readable stack trace.

#### Scenario: Successful resolution
- **WHEN** the server returns resolved stack frames
- **THEN** the client displays each frame with index, function name, source file, and line number

#### Scenario: Partial resolution
- **WHEN** some addresses could not be resolved (marked with `??`)
- **THEN** the client displays resolved frames normally and shows unresolved addresses with a visual indicator

#### Scenario: Server error
- **WHEN** the server returns an error response
- **THEN** the client displays the error message to the user

### Requirement: Loading state
The client SHALL show a loading indicator while the analysis request is in progress.

#### Scenario: Analysis in progress
- **WHEN** the analysis request is sent
- **THEN** a loading spinner is shown and the analyze button is disabled until the response arrives
