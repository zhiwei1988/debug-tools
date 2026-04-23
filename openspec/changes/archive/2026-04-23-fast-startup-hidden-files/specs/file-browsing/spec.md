## ADDED Requirements

### Requirement: Directory Listing Endpoint Returns All Entries

The server SHALL return every directory entry under the requested path via `GET /api/files/list`, regardless of whether the entry's name begins with a dot. Visibility filtering is a client-side concern and MUST NOT be applied by the server.

#### Scenario: Dotfiles included in response

- **WHEN** a client requests `GET /api/files/list?path=.` and the directory contains `.config`, `.cache`, and `README.md`
- **THEN** the response body's `entries` array includes entries for `.config`, `.cache`, and `README.md`

#### Scenario: No query parameter toggles server filtering

- **WHEN** a client sends any value of any query parameter other than `path`
- **THEN** the server ignores it and returns the same full listing

### Requirement: Hidden-File Default Visibility

The File Browser page SHALL hide directory entries whose names begin with `.` by default on first load. Filtering SHALL be performed client-side during rendering, on the same response received from `/api/files/list`.

#### Scenario: First-time visitor sees no dotfiles

- **WHEN** a user loads `file-browser.html` with no prior `localStorage` state and the current directory contains `.config/`, `.cache/`, and `workspace/`
- **THEN** only `workspace/` is rendered in the file table

#### Scenario: Dotfile filter applies in every directory

- **WHEN** a user navigates into a subdirectory that also contains `.`-prefixed entries and has not toggled the preference
- **THEN** the `.`-prefixed entries are also hidden in that subdirectory

### Requirement: Show Hidden Toggle

The File Browser page SHALL provide a single toolbar control (checkbox or equivalent button) labeled "Show hidden" that toggles visibility of `.`-prefixed entries across all directories. Toggling the control SHALL update the currently rendered list immediately without issuing a new network request.

#### Scenario: Toggle on reveals dotfiles

- **WHEN** the user enables "Show hidden" while viewing a directory that contains both `.config/` and `workspace/`
- **THEN** both `.config/` and `workspace/` are rendered in the file table
- **AND** no HTTP request to `/api/files/list` is issued

#### Scenario: Toggle off re-hides dotfiles

- **WHEN** the user disables "Show hidden" after previously enabling it
- **THEN** `.`-prefixed entries disappear from the table without a network request

### Requirement: Show Hidden Preference Persistence

The toggle state SHALL be persisted in `localStorage` under the key `fb.showHidden` as a boolean string (`"true"` or `"false"`). On page load the File Browser SHALL read this key and apply the stored preference globally to every directory viewed in that session.

#### Scenario: Preference survives reload

- **WHEN** a user enables "Show hidden", reloads the page, and navigates to any directory
- **THEN** `.`-prefixed entries are visible without further user action
- **AND** `localStorage.getItem('fb.showHidden')` is `"true"`

#### Scenario: Absent preference defaults to hidden

- **WHEN** `localStorage.getItem('fb.showHidden')` returns `null`
- **THEN** the toggle renders as off and `.`-prefixed entries are hidden

#### Scenario: Preference applies globally across directories

- **WHEN** the user has "Show hidden" enabled and navigates from `/` to a subdirectory
- **THEN** the preference carries over: `.`-prefixed entries remain visible in the subdirectory without any per-directory interaction

### Requirement: Directory Listing Rendering

The File Browser page SHALL render the entries returned by `/api/files/list` as a table with columns for name, size, modified time, and actions. Directories SHALL sort before files; within each group entries SHALL sort alphabetically by name. A ".." row SHALL appear in every non-root directory to allow navigation up.

#### Scenario: Directories precede files

- **WHEN** the server returns a listing containing directory `apps/` and file `note.txt`
- **THEN** `apps/` appears above `note.txt` in the rendered table

#### Scenario: Parent link in subdirectory

- **WHEN** the user is viewing a non-root path such as `logs/2026/`
- **THEN** the first row is a `..` link that navigates to `logs/`

#### Scenario: Empty directory placeholder

- **WHEN** the rendered list would be empty at the root path (no entries, or all entries hidden by the dotfile filter)
- **THEN** a placeholder row reading "Empty directory" is shown instead
