## Context

`debug-tools` today runs on two processes:

- Python `http.server` on port 8080 (ad-hoc) serves the three HTML pages + shared assets from the project root.
- Node.js Express + `ws` on port 3000 serves `/api/*` and `/ws`.

Every page carries a Backend URL textbox and a **Connect** button. On Connect, the page records the base URL and fires the initial API call (`/api/toolchains` or `/api/files/root`). All subsequent API / WS calls build URLs by concatenating that base.

This is a single-user local debugging tool: the server and the browser always live on the same host (or on two hosts with a trivially reachable network, but never crossing origins we care about). There is no multi-tenancy, no external exposure, and no auth surface.

Constraints:

- Must not change the existing HTTP/WS protocols; only how the client *addresses* them.
- Must not break the "open `index.html` by `file://` double-click" mode for Log Parser, which today needs no server at all.
- Must keep all file-system side effects scoped to `FILE_ROOT` as they already are.
- No build step exists or should be introduced.

## Goals / Non-Goals

**Goals:**

- One process, one port, one start command covers every page.
- Browser can reach any page directly by URL and it works without manual configuration.
- README has a single "Quick Start" section.
- Code reduction in the three HTML pages (delete Connect UI, delete base-URL plumbing).

**Non-Goals:**

- Access control, auth, CORS allowlist, or any security hardening for the static mount. This is an owner-local tool and the user has explicitly accepted full project-root exposure.
- Cross-host deployment. Not supported any more; if needed, user can reverse-proxy externally.
- Packaging (pkg / `--experimental-single-executable-application`, Docker, systemd).
- Touching the WS upload protocol.
- Adding a landing/index page or inter-page navigation.

## Decisions

### D1: Static hosting mounted at `path.join(__dirname, '..')`

The server lives in `server/`; HTML lives in the repo root one level up. Mount static like:

```js
app.use(express.static(path.join(__dirname, '..')));
```

**Alternatives considered:**

- (a) **Whitelist route**: explicit `res.sendFile` for each known HTML/JS/CSS. Safer but each new page requires code change. Over-engineering for a personal tool.
- (b) **Relocate HTML into `server/public/`**: cleanest docroot, but disturbs git history, existing bookmarks, and the README's structure diagram. High-churn for zero user benefit.
- (c) **Blacklist via middleware**: reject `/server/`, `/.git/`, `/openspec/`. Owner explicitly said "no risk, skip it."

Chosen (the unconditional mount) because the tool is explicitly scoped to the local machine.

### D2: Default port `8090`

Free both `3000` (common for other Node projects) and `8080` (common for ad-hoc Python servers). `PORT` env var override is preserved.

### D3: Remove `app.use(cors())`

Same-origin only. Removing CORS eliminates a permanent header-pollution overhead and makes it explicit that we no longer support cross-origin callers. If a user later wants to call the API from a different origin they can re-introduce `cors` locally.

The `cors` npm dependency is removed from `package.json` to keep `node_modules` minimal.

### D4: Client API base = page origin, via relative paths

Simplest possible form: use path-only URLs. `fetch('/api/toolchains')` resolves against `location.origin` by construction, so there is no explicit base-URL variable in JS.

For the WebSocket, browsers don't accept path-only URLs, so derive:

```js
const wsUrl = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
```

**Alternatives considered:**

- Keep a `BASE_URL` constant defaulting to `location.origin` — leaves a useless variable. Rejected.
- Keep the Backend URL UI but pre-fill `location.origin` — contradicts "delete the UI" decision. Rejected.

### D5: Delete Connect UI; fold its side effects into page load

Each page currently has a three-part flow: render UI with fields grey, user clicks Connect, fields populate. After this change:

- **Stack Analyzer**: on `DOMContentLoaded`, immediately `fetch('/api/toolchains')` and populate the dropdown. Failure shows an inline error banner (same copy the Connect failure path used).
- **File Browser**: on `DOMContentLoaded`, immediately `fetch('/api/files/root')` then `fetch('/api/files/list?path=.')`. Failure shows an inline error banner.

The on-demand WS connection lifecycle (open on first upload, close after 30s idle) is already implemented that way and is unaffected.

### D6: Root URL serves `index.html`

`express.static` resolves `/` to `index.html` by default. No extra route needed. This matches the chosen "(a)" entry-point option. Users reach the other pages via their explicit filenames.

## Risks / Trade-offs

- **[Risk]** Static mount exposes `server/config.json`, `server/toolchains.json`, `.git/`, `openspec/` over HTTP. → **Mitigation**: owner accepted this explicitly (local-only tool). If ever exposed to a network, front it with a reverse proxy that restricts paths.

- **[Risk]** Users with muscle memory hitting `:3000` will get connection refused. → **Mitigation**: single-line in README migration note. Acceptable.

- **[Risk]** Deleting the Backend URL UI removes the cross-host debugging workflow. → **Mitigation**: owner explicitly decided this is not needed; can be restored with a small code change if ever needed.

- **[Trade-off]** Removing `cors` means any accidental cross-origin call will fail silently until CORS is re-added. Low concern since no caller exists.

- **[Trade-off]** No authentication on the static mount. The File Browser can already read/write files inside `FILE_ROOT`; that existing risk surface does not materially grow when static assets become readable.

## Migration Plan

This is a single-user tool; no staged rollout is needed. On the next `git pull`:

1. Users re-run `npm install` in `server/` (picks up `cors` removal — noop if already installed).
2. Start server: `cd server && npm start`.
3. Visit `http://localhost:8090/`. Log Parser loads directly; other pages reached at `/stack-analyzer.html` and `/file-browser.html`.

No data migration, no config migration. `server/config.json` format is unchanged.

Rollback: `git revert` the change commit.

## Open Questions

None. All scope decisions were settled during exploration.
