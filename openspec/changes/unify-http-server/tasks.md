## 1. Server

- [x] 1.1 In `server/index.js`, change `PORT` default from `3000` to `8090`
- [x] 1.2 In `server/index.js`, remove `const cors = require('cors');` and `app.use(cors())`
- [x] 1.3 In `server/index.js`, add `app.use(express.static(path.join(__dirname, '..')))` after the body-parsing middleware and before `/api/*` routes
- [x] 1.4 Remove `cors` from `server/package.json` dependencies; regenerate `server/package-lock.json` with `npm install`

## 2. Stack Analyzer (`stack-analyzer.html`)

- [x] 2.1 Remove the Backend URL input element and the Connect button from the HTML
- [x] 2.2 Remove the JS that reads/validates the Backend URL and triggers the Connect flow
- [x] 2.3 Replace the `fetch(baseUrl + '/api/toolchains')` call with `fetch('/api/toolchains')` wired to `DOMContentLoaded` so the dropdown populates on page load
- [x] 2.4 Update the analyze submission to call `/api/analyze` (relative URL)
- [x] 2.5 Move the existing "connection failed" error display into the auto-fetch failure handler (inline banner visible on page)

## 3. File Browser (`file-browser.html`)

- [x] 3.1 Remove the Backend URL input element and the Connect button from the HTML
- [x] 3.2 Remove the JS that reads/validates the Backend URL and triggers the Connect flow
- [x] 3.3 Auto-run the initial `fetch('/api/files/root')` + `fetch('/api/files/list?path=.')` on `DOMContentLoaded`
- [x] 3.4 Replace any other `baseUrl + '/api/...'` or `baseUrl + '/ws'` concatenation with relative paths and `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws` for WebSocket
- [x] 3.5 Move the existing "connection failed" error display into the auto-fetch failure handler

## 4. Log Parser (`index.html`)

- [x] 4.1 Confirm no backend URL / Connect UI is present; if any is found, remove it (Log Parser does not use the backend but may share the header snippet)

## 5. Documentation

- [x] 5.1 In `README.md`, delete the "只用 Log Parser" section's `python3 -m http.server` example
- [x] 5.2 Rewrite the "快速开始" / "启动后端" section so the single start procedure is `cd server && npm install && npm start`, default URL `http://localhost:8090/`
- [x] 5.3 Replace every occurrence of port `3000` with `8090` in `README.md`
- [x] 5.4 Remove any instructions that tell the user to fill a Backend URL and click **Connect**; replace with "open the page URL in a browser"
- [x] 5.5 Update the dependencies list: remove `cors` from the backend dependencies bullet

## 6. Manual Verification

- [x] 6.1 Run `cd server && npm start`; confirm console prints port `8090`
- [x] 6.2 Open `http://localhost:8090/`; verify Log Parser loads
- [x] 6.3 Open `http://localhost:8090/stack-analyzer.html`; verify toolchain dropdown auto-populates and a test analysis returns frames
- [x] 6.4 Open `http://localhost:8090/file-browser.html`; verify directory listing auto-loads, WebSocket upload of a small file succeeds, a folder download returns a zip
- [x] 6.5 Confirm `curl -I http://localhost:8090/api/toolchains` shows no `Access-Control-Allow-Origin` response header
- [x] 6.6 Confirm `PORT=9000 npm start` overrides the port and the pages still work when addressed at `http://localhost:9000/`
