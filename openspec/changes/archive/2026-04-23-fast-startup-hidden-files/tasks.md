## 1. Server: tmp path relocation

- [x] 1.1 Define a module-scope constant for the collection directory (`UPLOAD_TMP_DIR = path.join(FILE_ROOT, '.uploads-tmp')`) and a helper that generates `<random16>.part` names
- [x] 1.2 Modify `handleInit` to `mkdirSync(UPLOAD_TMP_DIR, { recursive: true })` on first use and open the write stream inside `UPLOAD_TMP_DIR` instead of alongside the target; keep `sess.target` as the final absolute path and `sess.tmp` as the collection-dir path
- [x] 1.3 Confirm `handleFinish` still calls `fs.renameSync(s.tmp, s.target)` with the new paths; verify that target parent directory is created in `handleInit` before rename
- [x] 1.4 Confirm `cleanupSession` / `closeTmp` / mid-transfer error paths still `fs.unlink(sess.tmp, ...)` correctly with the new path

## 2. Server: startup ordering and new cleanup

- [x] 2.1 Rewrite `cleanupOrphans(dir)` to be non-recursive: `readdirSync(UPLOAD_TMP_DIR)` (return if ENOENT), filter to names ending in `.part`, snapshot the list, then `unlinkSync` each entry ignoring ENOENT
- [x] 2.2 Add `runLegacySweepOnce()` that checks for `<UPLOAD_TMP_DIR>/.legacy-cleaned` sentinel; if absent, recursively walk `FILE_ROOT` deleting `*.uploading.*` files, then create the sentinel file (empty). Skip the walk entirely when the sentinel exists
- [x] 2.3 Move the `cleanupOrphans(FILE_ROOT)` call from before `app.listen` to after, wrapped in `setImmediate(() => { cleanupOrphans(); runLegacySweepOnce(); })`
- [x] 2.4 Ensure `mkdirSync(UPLOAD_TMP_DIR, { recursive: true })` is also invoked at startup (before the cleanup schedule) so the sentinel write in 2.2 doesn't race with the first upload

## 3. Frontend: hidden-file toggle

- [x] 3.1 Add a `<label><input type="checkbox" id="showHiddenToggle"> Show hidden</label>` to the toolbar in `file-browser.html` next to the existing buttons
- [x] 3.2 In the `<script>` block, add a module-scope `showHidden` variable initialized from `localStorage.getItem('fb.showHidden') === 'true'`, and sync the checkbox `checked` state to it in `init()`
- [x] 3.3 In `renderTable`, filter `entries` to exclude any entry whose `name` starts with `.` when `showHidden` is false; keep the `..` parent row and the "Empty directory" placeholder behavior intact
- [x] 3.4 Wire the checkbox `change` handler to update `showHidden`, write `localStorage.setItem('fb.showHidden', String(showHidden))`, and re-invoke `renderTable(lastEntries, currentPath)` — cache `lastEntries` from the most recent `loadDir` response so the re-render does not refetch

## 4. Manual verification

- [x] 4.1 With `fileRoot = /home/zhiwei`, run `npm start` and confirm the File Browser page loads in < 1 second after the `listening on port` log line
- [x] 4.2 Upload a file; confirm `<FILE_ROOT>/.uploads-tmp/<hex>.part` appears during transfer and the file ends up at the intended target after `finish`
- [x] 4.3 Kill the server mid-upload; restart; confirm the leftover `.part` file is removed after startup and the HTTP listener does not wait for cleanup
- [x] 4.4 Plant a legacy file `<fileRoot>/some/path/foo.uploading.abc123`, delete the sentinel, restart; confirm the legacy file is deleted in the background and `.uploads-tmp/.legacy-cleaned` is created; restart again and confirm no recursive scan occurs (stat the sentinel before/after)
- [x] 4.5 Open the File Browser with a fresh `localStorage`; confirm dotfiles under `/home/zhiwei` are hidden; toggle on, confirm they appear including `.uploads-tmp/`; reload, confirm the toggle state persists; navigate into a subdirectory and confirm the preference applies globally
