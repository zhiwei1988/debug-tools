## Why

The project currently requires two separate processes to run the full tool set: a Python `http.server` for static HTML hosting and a Node.js service for API + WebSocket. Users must start both, guess the backend host/port, and manually fill a "Backend URL" in every page and click **Connect** before anything works. For a single-user debug tool this split doubles deployment friction, fragments logs, and adds a per-session manual step that serves no purpose when the server and browser are always on the same host.

## What Changes

- **BREAKING** Default server port changes from `3000` to `8090`.
- **BREAKING** Stack Analyzer and File Browser HTML pages no longer expose a "Backend URL" input or a **Connect** button. API calls use the page's own origin.
- Node.js server (`server/index.js`) serves the project root as static files, so `index.html`, `stack-analyzer.html`, `file-browser.html`, `common.css`, and `decompress-worker.js` are available under the same origin as `/api/*` and `/ws`.
- Initialization requests previously triggered by **Connect** (`GET /api/toolchains` for Stack Analyzer, `GET /api/files/root` + initial listing for File Browser) now fire automatically on page load.
- `app.use(cors())` is removed — no longer needed under same-origin.
- README drops all references to `python3 -m http.server`; the only documented start procedure is `npm start` inside `server/`, visit `http://localhost:8090/`.
- `http://localhost:8090/` resolves to `index.html` (Log Parser). The other two pages are reached via explicit paths.

## Capabilities

### New Capabilities
- `web-host`: Single Node.js process responsible for serving the project's static HTML/JS/CSS assets, the JSON API under `/api/*`, and the upload WebSocket at `/ws`, all on one HTTP port with same-origin semantics. Owns the default port and the static-file mount point.

### Modified Capabilities
- `stack-trace-client`: Replace the "Backend URL + Connect" prerequisite with same-origin behavior. Toolchain list and other server-dependent state load automatically on page load from the page's own origin.

## Impact

- Code:
  - `server/index.js` — add `express.static`, change default `PORT`, remove `cors()` usage.
  - `server/package.json` — `cors` dependency may become removable.
  - `index.html` / `stack-analyzer.html` / `file-browser.html` — remove Backend URL input, Connect button, and related JS; replace configured-base-URL calls with relative paths (`/api/...`, and same-origin WS URL derivation for `/ws`).
- APIs: No request/response shapes change. Existing HTTP and WS endpoints are unchanged.
- Dependencies: Python `http.server` no longer needed. `cors` npm package no longer needed.
- Docs: `README.md` quick-start, API table, and port references.
- Deployment: One process (`npm start`), one port (`8090`).
