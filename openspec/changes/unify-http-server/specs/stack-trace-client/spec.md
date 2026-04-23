## MODIFIED Requirements

### Requirement: Toolchain selection
The client SHALL fetch available toolchain names from the server API and display them in a dropdown selector. The server is addressed by path-only URLs resolved against the page's own origin; the client SHALL NOT expose a user-facing control for configuring the backend URL.

#### Scenario: Page load populates toolchain list
- **WHEN** the stack analyzer page loads
- **THEN** the client fetches `GET /api/toolchains` against the page origin and populates the dropdown with returned toolchain names, without requiring any user action

#### Scenario: Server unreachable
- **WHEN** the toolchain API request fails
- **THEN** the client displays an error message indicating the server is unavailable

#### Scenario: No backend URL configuration UI
- **WHEN** the page is rendered
- **THEN** no textbox, button, or other widget for entering or applying a backend URL is present

### Requirement: Submit analysis request
The client SHALL send a multipart POST request to `/api/analyze` with the backtrace log, toolchain name, and ELF binary. The request target SHALL be a path-only URL resolved against the page's origin.

#### Scenario: Successful submission
- **WHEN** user clicks the analyze button with all fields filled
- **THEN** the client sends `POST /api/analyze` (resolved against the page origin) with multipart form data containing backtrace text, toolchain name, and ELF file

#### Scenario: Missing required fields
- **WHEN** user clicks analyze with any required field empty
- **THEN** the client highlights the missing field and prevents submission
