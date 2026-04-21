## 1. Dependency

- [x] 1.1 在 `server/package.json` 的 `dependencies` 中新增 `archiver`（建议 `^7.x`）
- [x] 1.2 在 `server/` 下执行安装（由用户确认后执行），确保 `package-lock.json` 同步更新

## 2. Backend route

- [x] 2.1 在 `server/index.js` 的 File Browser 区段新增 `GET /api/files/download-folder` 路由
- [x] 2.2 复用 `safePath()` 做路径校验；分别处理：越权返回 403、非目录返回 400、不存在返回 404、等于 `FILE_ROOT` 返回 400（"Cannot download root"）
- [x] 2.3 使用 `archiver('zip', { store: true })` 创建归档；设置 `Content-Type: application/zip` 与 `Content-Disposition`（含 `filename*=UTF-8''...` 形式）
- [x] 2.4 `archive.directory(abs, path.basename(abs))` 递归加入目录内容；`archive.pipe(res)` 后 `archive.finalize()`
- [x] 2.5 监听 `archive.on('warning')`（忽略 ENOENT 级）和 `archive.on('error')`（`res.destroy(err)`）；监听 `res.on('close')` 时调用 `archive.abort()` 防泄漏

## 3. Frontend UI

- [x] 3.1 修改 `file-browser.html` 的 `renderTable()`：目录行的 Action 列在 Delete 按钮之前插入 `Download` 按钮
- [x] 3.2 新增 `downloadFolder(rel)` 函数，通过 `window.open(.../api/files/download-folder?path=...)` 触发下载
- [x] 3.3 确保 `..` 行不会渲染 Download 按钮（该行当前只渲染 name-cell，已经无 action，保持原状；在 table 渲染逻辑中复核）

## 4. Manual verification

- [x] 4.1 启动 server 后，在 File Browser 中对一个已知子目录点击 Download，确认得到 `<dirname>.zip`，且解压后目录结构与内容一致
- [x] 4.2 构造 `path=..` 请求，确认返回 403 且无响应体字节流
- [x] 4.3 对文件路径请求 `/api/files/download-folder`，确认返回 400 "Not a directory"
- [x] 4.4 对 `path=.` 请求，确认返回 400 "Cannot download root"
- [x] 4.5 对含中文/空格的目录名测试，确认浏览器保存为正确文件名
