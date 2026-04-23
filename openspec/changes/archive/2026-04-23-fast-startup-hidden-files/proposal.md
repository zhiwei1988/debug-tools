## Why

Restarting the server currently blocks for seconds-to-tens-of-seconds before the File Browser page becomes usable, because `cleanupOrphans` synchronously recurses the entire `FILE_ROOT` tree (configured to `/home/zhiwei`, a user home with node_modules, caches, etc.). The first listing then drowns the user in dotfiles that are rarely interesting. Both issues hurt the daily "open page and do something" loop.

## What Changes

- Relocate upload temporary files from `<target>.uploading.<random>` (alongside the final target) to a single collection directory `<FILE_ROOT>/.uploads-tmp/<random>.part`, so orphan cleanup only has to scan one small directory instead of the whole tree.
- Change startup ordering so the HTTP listener starts first and orphan cleanup runs asynchronously in the background, making the page reachable in milliseconds regardless of `FILE_ROOT` size.
- Perform a **one-time** legacy cleanup of old `*.uploading.*` residues anywhere under `FILE_ROOT` on first startup, guarded by a sentinel file inside `.uploads-tmp/`, so the full-tree scan never happens again after upgrade.
- Add a **Show hidden** toggle to the File Browser toolbar that filters out entries whose name starts with `.` by default. The toggle state is a global user preference persisted in `localStorage` (`fb.showHidden`), applied identically across all directories. Filtering is performed client-side.

## Capabilities

### New Capabilities
- `file-browsing`: File Browser page behavior — directory listing rendering, navigation, and the hidden-file visibility toggle. (The HTTP listing endpoint itself continues to return all entries unfiltered; visibility is a client-side concern.)

### Modified Capabilities
- `file-upload`: Temporary file location and orphan cleanup semantics change. Tmp files now live in a dedicated `.uploads-tmp/` directory; orphan cleanup scans only that directory on startup and runs asynchronously after the server begins listening. A one-time legacy sweep handles pre-existing residues.

## Impact

- Code:
  - `server/index.js`: tmp path construction in `handleInit`, rename behavior in `handleFinish`, rewrite of `cleanupOrphans`, new legacy sweep with sentinel, reordering of startup (`listen` before cleanup).
  - `file-browser.html`: new toolbar toggle, filter in `renderTable`, `localStorage` load/save in `init` and toggle handler.
- Configuration: none. `fileRoot` stays as user-configured (`/home/zhiwei`).
- Data on disk: a new hidden directory `<FILE_ROOT>/.uploads-tmp/` is created on first upload or first startup. Old residues are deleted once. The new tmp files live inside this directory until renamed to their targets; same-volume rename keeps the operation atomic.
- APIs: no endpoint contracts change. No breaking changes for clients.
