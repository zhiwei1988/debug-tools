## 1. Tar Format Detection

- [x] 1.1 Read first 2 bytes of uploaded file to check gzip magic bytes `1f 8b`
- [x] 1.2 If not gzip, feed raw chunks directly to `processTarData` (skip pako Inflate)
- [x] 1.3 Update file input accept attribute to include `.tar`

## 2. Nested Decompression

- [x] 2.1 Extend marker file detection to collect `.gz`, `.tgz`, `.bin` file data
- [x] 2.2 After collecting a `.gz` entry, inflate with `pako.inflate()` and treat result as log text
- [x] 2.3 After collecting a `.tgz` entry, inflate then run result through `processTarData` recursively
- [x] 2.4 Add recursion depth parameter to `processTarData`, limit to 2 levels
- [x] 2.5 Send decompressed log content to main thread via `log-file` message type (source name + full text)

## 3. Log Data Model

- [x] 3.1 On main thread, build log entries array: `{ source, lines: [{ lineNum, text, timestamp }] }`
- [x] 3.2 Implement timestamp parser supporting `YYYY-MM-DD HH:MM:SS`, `MMM DD HH:MM:SS`, `YYYY/MM/DD HH:MM:SS`
- [x] 3.3 Implement timestamp inheritance for lines without recognizable timestamps

## 4. Keyword Filter with Logical Operators

- [x] 4.1 Implement tokenizer: split input into tokens (words, AND, OR, NOT, parentheses, `-prefix`)
- [x] 4.2 Implement parser: build AST from tokens (precedence: NOT > AND > OR)
- [x] 4.3 Implement evaluator: evaluate AST against a line string (case-insensitive)

## 5. Filter UI

- [x] 5.1 Add date picker input for date filtering
- [x] 5.2 Add start time and end time inputs for time range filtering
- [x] 5.3 Add keyword text input with placeholder showing syntax help
- [x] 5.4 Wire filter inputs to trigger re-filtering on change

## 6. Log Viewer with Virtual Scrolling

- [x] 6.1 Build flat array of filtered log lines from all sources
- [x] 6.2 Implement virtual scroll container: fixed-height viewport, translated inner container
- [x] 6.3 Render only visible lines (~50-100) based on scroll position and fixed line height
- [x] 6.4 Show source file name and line number for each rendered line
- [x] 6.5 Re-render on filter change: rebuild filtered array, reset scroll position
