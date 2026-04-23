## ADDED Requirements

### Requirement: Single-Process HTTP Host

The Node.js server SHALL be the sole process required to make every page of the tool fully functional. Starting `server/index.js` SHALL simultaneously serve the project's static HTML/JS/CSS assets, the JSON API under `/api/*`, and the upload WebSocket at `/ws`, all on one HTTP port.

#### Scenario: One command starts everything
- **WHEN** the user runs `npm start` inside `server/`
- **THEN** a single Node.js process binds one TCP port and accepts requests for static files, `/api/*`, and `/ws`

#### Scenario: No auxiliary static server required
- **WHEN** the user opens `http://<host>:<port>/index.html` in a browser without any other process running
- **THEN** the page loads and all in-page features (including those that call the API) work without further configuration

### Requirement: Default Port

The server SHALL listen on TCP port `8090` by default. The `PORT` environment variable SHALL override this default.

#### Scenario: Default port
- **WHEN** `npm start` is run with no `PORT` environment variable
- **THEN** the server listens on `0.0.0.0:8090` (or equivalent)

#### Scenario: Overridden port
- **WHEN** `PORT=9000 npm start` is run
- **THEN** the server listens on port `9000`

### Requirement: Static Asset Mount

The server SHALL serve the repository root as a static-file directory so that any file at the repository root is retrievable by HTTP GET under the path that matches its name.

#### Scenario: Root HTML served
- **WHEN** a GET request is made to `/index.html`
- **THEN** the server responds with status 200 and the body of the repository's root `index.html`

#### Scenario: Other HTML pages served
- **WHEN** a GET request is made to `/stack-analyzer.html` or `/file-browser.html`
- **THEN** the server responds with status 200 and the corresponding file body

#### Scenario: Shared assets served
- **WHEN** a GET request is made to `/common.css` or `/decompress-worker.js`
- **THEN** the server responds with status 200 and the file body

#### Scenario: Static mount does not shadow API
- **WHEN** a request path begins with `/api/` or equals `/ws`
- **THEN** the request is handled by the API/WebSocket handler and not by the static-file mount

### Requirement: Root Path Entry

The server SHALL respond to `GET /` with the body of `index.html` so that visiting `http://<host>:<port>/` opens the Log Parser without requiring a filename in the URL.

#### Scenario: Bare root path
- **WHEN** a GET request is made to `/`
- **THEN** the server returns status 200 and the body of the repository's root `index.html`

### Requirement: Same-Origin Delivery

All resources needed by any page (the page's HTML, its scripts and stylesheets, the API endpoints it calls, and the WebSocket it connects to) SHALL be served from the same origin so that pages never require cross-origin requests.

#### Scenario: API and page share origin
- **WHEN** `stack-analyzer.html` is loaded from `http://<host>:<port>/stack-analyzer.html` and fetches `/api/toolchains`
- **THEN** the request resolves to `http://<host>:<port>/api/toolchains` without any cross-origin preflight

#### Scenario: WebSocket and page share origin
- **WHEN** `file-browser.html` is loaded from `http://<host>:<port>/file-browser.html` and opens a WebSocket to `/ws`
- **THEN** the WebSocket connects to `ws://<host>:<port>/ws` (or `wss://` if the page is served over HTTPS) without any cross-origin concern

### Requirement: No CORS Middleware

The server SHALL NOT attach a permissive CORS middleware that advertises `Access-Control-Allow-Origin` on API responses, because all callers are same-origin by design.

#### Scenario: No Access-Control-Allow-Origin header
- **WHEN** a client sends a request to any `/api/*` endpoint
- **THEN** the response does not include an `Access-Control-Allow-Origin` header
