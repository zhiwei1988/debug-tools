## Context

The File Browser (`file-browser.html` + `server/index.js`) currently uploads via `POST /api/files/upload` with `multipart/form-data`, handled server-side by `multer` with a 500 MB per-file cap and a tmp-then-rename flow. Three concrete gaps emerged:

1. No progress feedback — the fetch is opaque until completion.
2. multer buffers whole parts before the handler runs, so size limits are enforced by memory/disk ceilings rather than a stream.
3. `webkitRelativePath` is discarded, so folder uploads flatten into a single directory.

The deployment target is a LAN-only internal tool. There is no auth layer, no TLS termination concern, and transfer latency is dominated by disk I/O rather than network RTT.

## Goals / Non-Goals

**Goals:**
- Stream file bytes from browser to server without buffering whole files in memory on either end.
- Provide accurate progress reflecting bytes actually persisted (not merely sent).
- Preserve directory structure for folder uploads.
- Remove the 500 MB cap; let disk capacity be the limit.
- Single-user, LAN-only ergonomics: simple protocol, no auth, no TLS assumptions.
- Keep the protocol small enough to re-read in five minutes.

**Non-Goals:**
- Resumable / chunk-replay uploads after disconnect. A broken transfer restarts from zero.
- Concurrent multi-file parallelism on a single connection. Folder uploads are serialized through one WS.
- Backward compatibility with the existing HTTP upload route. Removed cleanly.
- Authentication, rate limiting beyond per-connection timeouts.
- Generalizing to other FS operations (list/download/mkdir/delete stay on HTTP).

## Decisions

### D1. WebSocket + custom RPC (vs. HTTP PUT streaming, vs. tus protocol)

**Chosen:** WebSocket at `/ws` with 6 message types (`init`, `ready`, binary, `ack`, `finish`, `done`/`error`/`abort`).

**Why:**
- Needed bidirectional `ack` for accurate "bytes persisted" progress — HTTP response-only feedback cannot emit intermediate progress from server to client.
- Full-duplex lets the server exert explicit backpressure via periodic `ack` plus pause/resume, instead of TCP-only congestion.
- Reuses one TCP connection across multiple files in a folder upload (amortize TLS/handshake cost when later deployed behind a reverse proxy).

**Alternatives:**
- `HTTP PUT` with `req.pipe(createWriteStream)`: simpler, but no server→client progress stream during upload.
- `tus` protocol: solves resumability we don't need; adds dependency and protocol surface; overkill for LAN single-user.

### D2. Single WS = one serial upload channel (vs. multiplexed sids, vs. WS pool)

**Chosen:** No multiplexing. One active upload per WS at any time. Folder upload serializes files on the same WS.

**Why:**
- User confirmed LAN deployment; RTT overhead per file is acceptable.
- Eliminates sid framing, ack-per-stream bookkeeping, head-of-line blocking concerns.
- Protocol can use raw binary frames with no header; the server always knows "current active upload" from state.

**Alternative rejected:** WS pool (N parallel connections) — would speed up many-small-files case but adds UI complexity (aggregate progress) and server-side state. Revisit if profiling proves it matters.

### D3. Progress driven by server `ack` (not client `bytesSent`)

**Chosen:** Server emits `ack { received: <bytes> }` whenever either threshold fires:
- cumulative bytes since last ack ≥ **1 MB**, OR
- time since last ack ≥ **200 ms**

Plus one final ack before `done`.

**Why:**
- Client `bytesSent` reflects what `ws.send()` accepted into the send buffer, not what actually reached disk. On slow disk or full pipe, that gap can be misleading.
- Double-duty as liveness signal: if client sees no ack for 5 s, assume stall and `abort`.

**Trade-off:** Small overhead of ack frames (~5–10 per second under load). Negligible on LAN.

### D4. Client-side backpressure via `ws.bufferedAmount`; server-side via `ws.pause()` + write callback

**Chosen:**
- **Client**: before each `ws.send(chunk)`, await `ws.bufferedAmount < 8 MB`.
- **Server**: on each binary frame, `ws.pause()`; call `writeStream.write(data, () => ws.resume())`.

**Why:** Each side independently bounds its own queue. No explicit window-protocol needed.

**Alternative rejected:** ack-based sliding window. More robust but duplicates what TCP + local flow already do well enough on LAN.

### D5. Tmp-file naming and atomic rename

**Chosen:** `<target>.uploading.<random6>`. Rename to target on `finish` only after verifying `received === size`.

**Why:**
- Suffix in target directory (not `/tmp`) avoids cross-filesystem rename cost.
- Random suffix prevents collision if two concurrent WS sessions both init the same target path (last writer wins on `finish`, but neither corrupts the other's tmp).
- Size mismatch is fatal — rename skipped, tmp removed, `error` returned.

### D6. Orphan cleanup

**Chosen:** On server startup, recursively scan `FILE_ROOT` and `unlink` any file matching `*.uploading.*`. On each WS close, clean the current session's tmp if still open.

**Why:** Server crash or WS drop leaves `.uploading.*` stranded. Startup scan is O(files) but runs once; per-close cleanup handles normal disconnects.

### D7. `size` is mandatory in `init`

**Why:** Enables both (a) server-side size-match verification on `finish` and (b) early rejection if size exceeds a (future) quota. `File.size` is always available in the browser; no reason to make it optional.

### D8. On-demand WS lifecycle

**Chosen:** Client opens WS when user triggers upload. After last `done`, set 30 s idle timer; if no new `init` within the window, close. Any subsequent upload re-opens a fresh WS.

**Why:**
- Avoids a persistent connection for a page where upload is an occasional action.
- 30 s window covers "user selected files, looks away, selects more" without reconnecting.

### D9. Endpoint is `/ws` (not `/api/files/upload-ws`)

**Why:** User's explicit choice. Rationale is that this project has a single WS concern and a short generic path is fine. If the server later grows other WS uses, rename is cheap (single-string change on both sides).

### D10. Remove HTTP upload route entirely (no dual-path transition)

**Why:** User confirmed no backward compat requirement. Dual paths would mean keeping `multer` and doubling the state-change code paths. LAN single-deployment context allows an atomic cutover.

## Protocol Reference

### Message schema

| type       | direction | JSON fields                         | binary frame? |
|------------|-----------|-------------------------------------|---------------|
| `init`     | C → S     | `path` (dest dir), `relPath` (file path under dest, preserves folders), `size` (bytes, required) | no |
| `ready`    | S → C     | —                                   | no |
| (data)     | C → S     | —                                   | **yes** (raw bytes) |
| `ack`      | S → C     | `received` (bytes persisted)        | no |
| `finish`   | C → S     | —                                   | no |
| `done`     | S → C     | `path` (final relative path)        | no |
| `error`    | S → C     | `msg`                               | no |
| `abort`    | C → S     | —                                   | no |

### Server state machine (per connection)

```
idle ──init──▶ opening ──(tmp opened)──▶ receiving ⇄ binary/ack
                                            │
                                       finish│
                                            ▼
                                       finalizing ──rename──▶ idle
                                            │
                                       error/close
                                            ▼
                                      cleanup tmp
```

### Timeouts

- **`ready` → first binary frame**: 30 s; on expiry, emit `error`, close tmp, close WS.
- **Between binary frames mid-transfer**: 30 s idle; same handling.
- **No timeout on `finalizing`** — local rename should be sub-second.

### Invariants

- Only one active upload per WS; `init` while not `idle` is a protocol error.
- `safePath` is re-validated on every `init`; `relPath` is joined and re-normalized to prevent `../` escape.
- `received` is checked monotonically: `received > size` during transfer → immediate `error` + cleanup.
- `finish` with `received !== size` → `error` + cleanup; no rename.

## Risks / Trade-offs

- **Folder uploads of thousands of small files are slow.** Each file incurs init→ready RTT on the same WS. On LAN this is tens of ms per file; 1000 files ≈ tens of seconds minimum overhead. Mitigation: accept the limitation (user explicitly confirmed); WS pool is a future optimization if profiling justifies.
- **No resume on disconnect.** A 5 GB upload lost at 4.9 GB restarts from zero. Mitigation: the tmp file is preserved with its random suffix; a future resume feature can pick it up by matching `.uploading.<random>`, but no manual intervention is promised today.
- **Server startup orphan scan is unbounded.** If `FILE_ROOT` has millions of files, startup is delayed. Mitigation: scan is shallow-match (filename suffix check during one `readdir` walk). Acceptable for expected LAN usage (thousands of files, not millions).
- **Race when two WS sessions target the same final path.** Last `finish` wins the rename; the other's rename will overwrite. Mitigation: accept last-write-wins semantics (matches HTTP upload behavior today). Random tmp suffix prevents corruption of the intermediate state.
- **ws library version drift.** New dependency. Mitigation: pin to a known-good version; `ws` is a mature, single-purpose library with stable API.
- **On-demand WS adds a first-upload latency penalty.** Open + upgrade before first `init`. Negligible on LAN (<10 ms).

## Migration Plan

Atomic cutover (no phased rollout needed for this single-deployment LAN tool):

1. Land server changes: add `/ws` handler, remove `/api/files/upload` route and its multer instance.
2. Land client changes in the same commit: replace `FormData` + `fetch` block with WS client module.
3. Bump `server/package.json` to add `ws`; `npm install`.
4. Restart server; startup orphan scan runs once.
5. Smoke test: single file, folder with nested dirs, >500 MB single file, mid-upload tab close (verify tmp cleaned), simultaneous uploads from two browser tabs.

**Rollback:** `git revert` the commit; `npm install` restores `multer`-only state. No data migration involved.

## Open Questions

None currently outstanding. All major decisions confirmed with the user in discovery (single WS serial / ack required / size mandatory / no backward compat / endpoint `/ws` / on-demand lifecycle with 30 s idle).
