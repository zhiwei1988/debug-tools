## Context

Current app handles `.tar.gz` only: streams the file through pako Inflate, parses tar headers via FSM, extracts "marker files" (text-based extensions) and displays them as collapsible cards. Uses a Web Worker with `FileReaderSync` for chunked reading.

Camera log tars contain nested compressed files (`.gz`, `.tgz`) and plain text logs mixed together. Binary `.bin` files should be skipped.

## Goals / Non-Goals

**Goals:**
- Support `.tar` input (no gzip outer layer)
- Decompress nested `.gz` files (single-file gzip) inside tar to extract log text
- Decompress nested `.tgz` files (gzipped tar) and recursively extract their contents
- Collect all log text into a unified data structure for filtering
- Provide filter UI: date picker, time range input, keyword search
- Render only matching log lines with virtual scrolling for performance
- Treat `.bin` files as log files (readable text logs in binary extension)

**Non-Goals:**
- Editing or modifying log files
- Exporting or downloading filtered results
- Supporting formats beyond tar/gz/tgz (e.g., zip, bzip2, xz)
- Server-side processing - everything stays in-browser

## Decisions

### D1: Detect tar vs tar.gz by file content, not extension

Try gzip inflate first (check magic bytes `1f 8b`). If not gzip, treat as plain tar. This avoids relying on file extensions which may be wrong.

Alternative: Check file extension. Rejected because users may rename files.

### D2: Two-pass approach for nested archives

During tar parsing, when a `.gz` or `.tgz` entry is encountered:
- Collect its full data (already done for marker files)
- After collection, inflate with pako
- For `.gz`: result is the decompressed log text, treat as a single file
- For `.tgz`: result is tar data, run it through `processTarData` recursively

Alternative: Stream nested archives. Rejected because nested files are small (individual logs) and buffering is simpler.

### D3: Unified log data model

All extracted log content stored as an array of log entries:
```
{ source: "path/to/file.log", lines: [{ lineNum, text, timestamp }] }
```

Timestamp is parsed from each line if a recognizable date/time pattern is found (e.g., `YYYY-MM-DD HH:MM:SS`, `MMM DD HH:MM:SS`). Lines without timestamps inherit the most recent timestamp from above.

### D4: Filtering happens on the main thread

Worker extracts and sends all log data to main thread. Filtering (date/time/keyword) runs on main thread against the in-memory array. This keeps the worker simple and allows instant re-filtering without re-parsing.

Alternative: Filter in worker. Rejected because filter criteria change frequently and re-posting messages adds latency.

### D5: Virtual scrolling for log viewer

Use a simple virtual scroll implementation: render only visible lines (~50-100) based on scroll position. Each line has fixed height for easy offset calculation. No external library needed.

Alternative: Paginated view. Rejected because scrolling is more natural for log viewing.

### D6: Keep existing marker file display for non-log files

Files like `.csv`, `.json`, `.xml` keep the existing card-based display. The new log viewer is for `.log`, `.bin`, and `.gz`/`.tgz` decompressed text logs.

### D7: Filter keyword supports logical operators

Keyword filter supports AND, OR, NOT operators. Syntax:
- `foo bar` or `foo AND bar`: both must match
- `foo OR bar`: either matches
- `NOT foo` or `-foo`: exclude lines containing foo
- Parentheses for grouping: `(foo OR bar) AND NOT baz`

Parse the expression into a simple AST and evaluate per line.

## Risks / Trade-offs

- **Large log files in memory**: All log text loaded into main thread memory. For typical camera logs (tens of MB decompressed) this is acceptable. Mitigation: warn if total exceeds 500MB.
- **Timestamp parsing heuristics**: Different log formats may use different timestamp patterns. Mitigation: support common patterns, lines without recognized timestamps still appear but can't be date-filtered.
- **Recursive decompression depth**: `.tgz` inside `.tgz` is unlikely but possible. Mitigation: limit recursion to 2 levels.
