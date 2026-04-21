## Context

File Browser 基于 `server/index.js` 暴露的若干 REST 接口（root/list/download/upload/mkdir/delete）和 `file-browser.html` 的纯前端页面实现。当前下载只支持单文件：`/api/files/download` 在 `stat.isFile()` 不成立时直接返回 400。目录下载尚无任何后端或前端支持。

服务端已经在 `safePath()` 里做了根目录越权保护，可以复用。页面没有打包 / bundler，所有前端逻辑内联在 `file-browser.html` 中。

## Goals / Non-Goals

**Goals:**
- 允许用户在 File Browser 里对任意子目录触发一键下载，浏览器得到一个 `.zip` 文件，保留原目录结构。
- 后端以流式方式写出 zip，避免整目录先落盘或加载进内存。
- 复用现有的路径越权校验，不引入新的安全面。

**Non-Goals:**
- 不做客户端侧压缩（保持浏览器"直接另存"的体验）。
- 不提供断点续传、多文件打包（只针对单个目录）。
- 不做后台生成 + 链接轮询的异步方案（实现复杂，本阶段不需要）。
- 不涉及鉴权系统（当前 File Browser 本身也没有）。

## Decisions

### D1: 使用 `archiver` 生成 zip 流

- 选项 A：`archiver`（纯 JS，支持 store/deflate，流式，最广泛的 Node zip 库）。
- 选项 B：`yazl`、`zip-stream`（更底层，需要自己遍历目录）。
- 选项 C：调用系统 `zip` 命令（依赖宿主环境，跨平台差）。

选 A。`archiver.directory(abs, dirname)` 一行完成目录递归+写入，API 简单；输出是可 pipe 到 `res` 的流；MIT 协议，与项目风格一致；无原生依赖。

### D2: 默认使用 STORE（不压缩）

`archiver` 默认 `zlib: { level: 9 }`。考虑到典型场景是已压缩的日志/固件/符号文件，再压缩收益低但 CPU 开销高。选择 `{ store: true }` 或 `{ zlib: { level: 0 } }`，以最快速度吐出字节流。若后续有压缩诉求可通过 query 参数 `compress=1` 开启。

### D3: 路由放在现有 `/api/files/*` 命名空间

新增 `GET /api/files/download-folder?path=<rel>`。原 `/api/files/download` 仍只处理文件。不合并到同一路由，原因：
- 响应头不同（单文件用 `res.download()` 推断文件名；目录需要手动设置 `Content-Type: application/zip` 和 `Content-Disposition`）。
- 前端行为也不同（文件直接用 `window.open`；目录需要 `<dirname>.zip` 命名）。

### D4: 禁止下载根目录

若用户在面包屑根一层点击（不会渲染到，但接口层仍需兜底）或构造 URL 直接打 `path=.`，后端返回 400。理由：打包整棵树的代价不可控；面包屑顶层没有"下载"按钮也符合用户直觉。

### D5: 错误处理使用流头前置校验

流式响应一旦 `pipe` 开始就无法再改 HTTP status。因此：
1. 校验 `safePath`、`isDirectory`、非根目录，都在 pipe 之前完成；这些错误用正常 JSON 错误响应。
2. `archiver` 过程中的错误（例如某个子文件读失败）通过 `archive.on('warning')` 吞掉（ENOENT 类），`archive.on('error')` 后 `res.destroy(err)`，让客户端感知传输中断。

### D6: 文件名编码

`Content-Disposition` 按 RFC 5987 写两份：`filename="xxx.zip"; filename*=UTF-8''<encoded>`，以兼容包含中文/空格的目录名。

## Risks / Trade-offs

- [大目录传输时间长，连接可能中途断开] → 不做断点续传；用户重试即可。文档中提示大目录下载可能耗时。
- [客户端在下载过程中导航离开会中断 archiver] → `res` 关闭时触发 `archive.abort()`，避免泄漏 fd。
- [archiver 对符号链接默认跟随，可能循环] → 使用 `archive.directory(abs, dirname, { stats: fs.lstatSync })` 模式规避；或依赖 `archiver` 默认行为并在文档里说明（当前 File Browser 根也没有做 symlink 限制，保持一致即可）。
- [新依赖引入] → `archiver` 本身较稳，但仍然增加 1 个顶层依赖。收益（文件夹下载）足以覆盖成本。
