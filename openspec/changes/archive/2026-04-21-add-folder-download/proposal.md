## Why

File Browser 目前只支持单文件下载，用户若想把一个目录（例如嵌入式设备产出的日志/符号文件夹）整体取走，只能逐个文件点下载，效率低且容易漏掉内容。为文件夹提供一键打包下载可以显著降低多文件取回成本。

## What Changes

- 后端新增 `GET /api/files/download-folder?path=<rel>` 接口：对指定目录进行流式 zip 打包并返回，保留目录层级。
- 前端 `file-browser.html` 的目录行在 Action 列新增 "Download" 按钮，点击后通过新接口触发浏览器下载（文件名为 `<dirname>.zip`）。
- 后端对目录路径做与现有 `safePath` 一致的越权校验；拒绝对根目录的下载请求，避免一次性打包整棵树造成压力。
- 为服务端引入 `archiver` 依赖，用于生成 zip 流。

## Capabilities

### New Capabilities
- `folder-download`: File Browser 中对任意可访问子目录进行 zip 打包并流式下载的能力。

### Modified Capabilities
<!-- 无：当前 File Browser 未建立 spec，本次仅新增 folder-download 能力 -->

## Impact

- 代码：`server/index.js` 新增一个路由；`server/package.json` 新增 `archiver` 依赖；`file-browser.html` 列表渲染与按钮逻辑调整。
- API：新增 `GET /api/files/download-folder`，不影响现有接口。
- 依赖：引入 `archiver`（MIT 协议，纯 Node，无原生编译依赖）。
- 运行时：长时间传输会占用连接与 CPU；通过流式写出 `res`、不缓冲到内存来规避内存压力。
