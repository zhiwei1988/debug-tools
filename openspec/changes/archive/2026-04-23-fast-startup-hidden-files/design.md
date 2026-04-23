## Context

`server/index.js` calls `cleanupOrphans(FILE_ROOT)` synchronously **before** `app.listen(PORT)`. That function recursively walks every subdirectory looking for `*.uploading.*` files left by a previous crash. In production usage `fileRoot` is set to `/home/zhiwei` (user home), which contains large nested trees (node_modules, caches, git clones, …). The synchronous recursion blocks the event loop for seconds to tens of seconds; the HTTP listener cannot bind until it finishes, so the File Browser page appears to "hang" after a restart.

The File Browser page itself renders all directory entries returned by `/api/files/list`, including `.`-prefixed hidden files. With `fileRoot = /home/zhiwei`, the first page load is dominated by dotfiles (`.cache`, `.config`, `.local`, …) that the user almost never wants to see.

Current tmp file layout: `<target>.uploading.<6-hex>` alongside the final target (same directory as the uploaded file). This is why cleanup has to recurse — tmp files can be anywhere under the tree.

## Goals / Non-Goals

**Goals:**
- Make the HTTP listener reachable within ~hundreds of milliseconds after `npm start`, independent of `FILE_ROOT` size.
- Keep tmp-file safety semantics (atomic rename, crash-resistant cleanup) intact.
- Hide `.`-prefixed entries by default in the File Browser with a one-click toggle; remember the choice across visits and across directories.

**Non-Goals:**
- Changing the `/api/files/list` contract (it still returns all entries; filtering is a client concern).
- Changing `fileRoot` default or adding a config knob for it.
- Adding a periodic background cleanup job (cleanup remains a startup-time responsibility, plus on-close for the active session).
- Adding server-side support for arbitrary hidden-file patterns (only the `.`-prefix convention matters).
- Authenticating or auditing the hidden-file toggle — it's a pure UI preference.

## Decisions

### Decision 1: Relocate upload tmp files to a dedicated directory

**Choice:** Write all upload tmp files to `<FILE_ROOT>/.uploads-tmp/<16-hex>.part`. On `finish`, `fs.rename` the tmp file to its final target. `.uploads-tmp/` is created lazily on the first upload (or the first startup, whichever comes first).

**Rationale:** This decouples orphan cleanup from `fileRoot` size. The cleanup scan becomes O(pending tmp count) instead of O(entire file tree).

**Alternatives considered:**
- *Keep tmp adjacent to target (status quo) but make cleanup async + parallel.* Rejected: treats the symptom. A deeply nested `fileRoot` can still block for a long time, just now in the background where it can show up as sluggish I/O during the first few requests.
- *Use `os.tmpdir()` for tmp files.* Rejected: `os.tmpdir()` is usually on a different filesystem (`/tmp` on tmpfs), so `fs.rename` would fail with `EXDEV` and require a copy+unlink fallback. Keeping tmp under `FILE_ROOT` guarantees same-volume rename.
- *Tmp filename stays in `<target>.uploading.<random>` form inside `.uploads-tmp/`.* Rejected: the target path can have `/` in it, which would either need escaping or mkdir-per-tmp. Flat `<hex>.part` is simpler; the mapping from tmp to target is tracked in the session object (`sess.tmp` → `sess.target`).

### Decision 2: Listen first, clean up after

**Choice:** Call `app.listen()` first. Schedule `cleanupOrphans` via `setImmediate` so it runs after the event loop starts accepting connections.

**Rationale:** Users perceive readiness by "can I load the page?". Putting `listen` first makes the server reachable immediately; since the new cleanup only scans `.uploads-tmp/` (a small directory), even the "in-progress" window is short. If a user uploads during the cleanup window, there is no collision: new tmp filenames use fresh random bytes and the cleanup only touches pre-existing entries (we snapshot the directory listing before deleting).

**Alternatives considered:**
- *Run cleanup synchronously, but on a worker thread.* Rejected: adds thread-spawn complexity for something that, post-relocation, takes milliseconds.
- *Skip orphan cleanup entirely.* Rejected: orphan tmp files would accumulate indefinitely across crashes/kills and waste disk.

### Decision 3: One-time legacy sweep with sentinel

**Choice:** On startup, check for `<FILE_ROOT>/.uploads-tmp/.legacy-cleaned`. If absent, run a one-time recursive scan of `FILE_ROOT` that deletes `*.uploading.*` files, then `touch` the sentinel. The sweep runs asynchronously in the background (does not block `listen`).

**Rationale:** Upgraders likely have old-format residues scattered across `FILE_ROOT`. Without this, those files stay forever. The sentinel ensures we only pay the cost once per deployment — subsequent starts are fast.

**Alternatives considered:**
- *Require manual migration (doc only).* Rejected: users won't read it; residues waste disk.
- *Delete sentinel approach; always scan.* Rejected: defeats the whole optimization.
- *Use a version number in a migrations table.* Rejected: over-engineered for a single sweep.

### Decision 4: Hidden-file filtering is client-side and global

**Choice:** `/api/files/list` continues to return all entries. `file-browser.html` filters out names matching `/^\./` in `renderTable` unless a global toggle is on. The toggle state is persisted in `localStorage` under key `fb.showHidden` (boolean). A single toolbar control (checkbox or text button) exposes it.

**Rationale:**
- **Client-side**: Toggling does not incur a round trip; feels instant. Data volume overhead is negligible at typical directory sizes (hundreds of entries).
- **Global**: Users asking to hide dotfiles want it hidden everywhere, not per-directory. Avoids mental overhead of "why is this dir showing them and that one isn't".
- **`localStorage`**: Survives reload; scoped to origin, which is exactly right.

**Alternatives considered:**
- *Server-side filter with `?showHidden=1` query param.* Rejected: round trip on every toggle; no real bandwidth win at expected sizes.
- *Per-directory preference.* Rejected: more state, less intuitive.
- *Session-only toggle (no persistence).* Rejected: annoying — users would toggle on every page load.

### Decision 5: `.uploads-tmp/` is itself a hidden directory

**Choice:** The `.` prefix on `.uploads-tmp/` is intentional. With Decision 4, the File Browser's default view hides it. Users who enable "Show hidden" will see it and may be tempted to poke at it; that's acceptable (documented as implementation detail).

**Rationale:** Zero extra filter logic on the server. The hidden-file convention already covers it.

## Risks / Trade-offs

- **Risk:** A future refactor of the directory listing endpoint accidentally filters out `.uploads-tmp/` server-side, breaking the ability to inspect it when showing hidden files. → **Mitigation:** Keep the server endpoint's "return all entries" behavior documented in the `file-browsing` spec.
- **Risk:** Cleanup snapshot races with a fresh upload that creates a tmp file during the ~ms cleanup window. → **Mitigation:** Snapshot `readdirSync('.uploads-tmp/')` before any unlink; only delete names present in the snapshot. New tmp files created after the snapshot are untouched.
- **Risk:** `.uploads-tmp/` on a filesystem mounted differently from a subdirectory of `FILE_ROOT` (e.g., a bind mount) would make `rename` fail with EXDEV. → **Mitigation:** Document that `FILE_ROOT` must be a single filesystem (it already effectively must be for atomic rename guarantees on the old layout too).
- **Risk:** A user sets `localStorage['fb.showHidden'] = true` intentionally, then a later user on the same browser is surprised by the cluttered view. → **Mitigation:** Acceptable; same shared-browser tradeoff as every other UI preference.
- **Trade-off:** Legacy sweep runs recursively once. On a huge `fileRoot` this can take a while — but in the background, after `listen`, so the page is usable. The sentinel ensures it never repeats.
- **Trade-off:** The flat `<hex>.part` naming loses the human-readable hint that the old `<target>.uploading.<hex>` name gave for debugging "which file was this?". We consider this minor; `sess.target` in logs covers it if needed.

## Migration Plan

1. Deploy new server code. First start after deployment:
   - `.uploads-tmp/` is created.
   - `.legacy-cleaned` sentinel is absent → recursive sweep runs in background, deletes old `*.uploading.*` residues, writes sentinel.
   - New uploads use `.uploads-tmp/<hex>.part`.
2. Subsequent starts: sentinel present → cleanup only scans `.uploads-tmp/`; `listen` → cleanup ordering makes the server reachable immediately.
3. Rollback: reverting server code is safe. New tmp files already written via the relocated path would be orphaned on rollback (old cleanup recurses and would clean names matching `*.uploading.*`, not `<hex>.part`). If this matters, a pre-rollback operator step can `rm -rf <FILE_ROOT>/.uploads-tmp/`.

No database migration, no user action required.

## Open Questions

None remaining — all prior open points resolved in the explore session:
- Legacy residues: one-time sweep (Decision 3).
- Toggle scope: global (Decision 4).
- `.uploads-tmp/` mtime protection: none (cleanup only runs at startup; no concurrent uploads to protect against at that moment).
