# Debug Tools

面向嵌入式设备调试的一套轻量工具集，包含三个浏览器页面与一个可选的 Node.js 后端服务。

- **Log Parser** (`index.html`)：浏览器内流式解析 `.tar` / `.tar.gz` / `.tgz` / `.zip` 归档，支持 10GB+ 的大文件，支持关键字 / 文件名 / 时间范围过滤与虚拟滚动日志查看。
- **Stack Analyzer** (`stack-analyzer.html`)：把崩溃 backtrace 与 ELF 文件发到后端，调用 `addr2line` 解析函数名、源码文件与行号。支持 GDB、ESP-IDF、ARM HardFault 等常见格式；对包含 `Exception Info` 的日志会根据 `Maps` 做手动栈回溯。
- **File Browser** (`file-browser.html`)：浏览 / 上传 / 下载 / 删除后端 `fileRoot` 目录下的文件。

前端页面是纯静态的，不需要构建。后端仅在使用 Stack Analyzer 或 File Browser 时才需要启动。

## 目录结构

```
debug-tools/
├── index.html              # Log Parser
├── stack-analyzer.html     # Stack Analyzer
├── file-browser.html       # File Browser
├── decompress-worker.js    # 解压 Web Worker（被 Log Parser 使用）
├── common.css
└── server/
    ├── index.js            # Express 后端
    ├── config.json         # fileRoot 配置
    ├── toolchains.json     # addr2line 路径白名单
    └── package.json
```

## 快速开始

### 只用 Log Parser

不需要后端，直接用浏览器打开 `index.html` 即可。也可以用任意静态服务器提供：

```bash
python3 -m http.server 8080
# 然后访问 http://localhost:8080/index.html
```

### 启动后端（Stack Analyzer / File Browser 需要）

```bash
cd server
npm install
npm start           # 默认监听 3000
PORT=8000 npm start # 自定义端口
```

服务启动后，前端页面顶部填入 `http://<host>:3000` 并点击 **Connect** 即可。

## 配置

### `server/config.json`

控制 File Browser 的根目录，所有文件操作都会被限制在此目录内：

```json
{ "fileRoot": "/path/to/shared" }
```

相对路径会基于 `server/` 解析。

### `server/toolchains.json`

Stack Analyzer 可选的 `addr2line` 白名单，key 会显示在前端 Toolchain 下拉框：

```json
{
  "arm-none-eabi": "/opt/gcc-arm-none-eabi/bin/arm-none-eabi-addr2line",
  "xtensa-esp32-elf": "/opt/xtensa-esp32-elf/bin/xtensa-esp32-elf-addr2line"
}
```

也可以在前端点击 **Detect Toolchains**，后端会扫描 `PATH` 和 `/opt`、`/usr/local`、`/usr` 下的 `*-addr2line` 自动补全此文件。

## 使用说明

### Log Parser

1. 打开 `index.html`，点上传区选择归档文件。
2. 解析完成后：
   - **File Downloads**：按文件名过滤并下载原始文件。
   - **Filter 栏**：按日期 / 时间范围 / 文件名 / 关键字过滤，支持 `AND` / `OR` / `()` / `"短语"`。
   - 过滤条件可以 **Save / Load**，整体配置可以 **Export / Import**。
3. 下方日志查看器支持虚拟滚动、上下文行数调整、书签跳转与最大化。

### Stack Analyzer

1. 填入后端 URL，点 **Connect** 拉取可用的 toolchain。
2. 选择 toolchain，粘贴 backtrace 日志，选择一个或多个 ELF 文件（带调试符号）。
3. 点 **Analyze**，解析后的栈帧可以 **Export** 为文本。

多 ELF 上传时：

- 结构化 backtrace：每个地址在所有 ELF 中尝试，取第一个能解析到符号的结果。
- `Exception Info` 格式：根据 `Maps` 段把地址分配给对应 basename 的 ELF，再做地址转换后解析。

### File Browser

1. 填入后端 URL，点 **Connect**。
2. 可以浏览 / 进入子目录 / 上传 / 新建目录 / 下载 / 删除。所有路径都限制在 `fileRoot` 下，无法越权。

## API（后端）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/api/toolchains` | 列出可用 toolchain |
| POST | `/api/toolchains/detect` | 扫描并补全 `toolchains.json` |
| POST | `/api/analyze` | `multipart/form-data`：`toolchain`、`backtrace`、`elf`（可多个） |
| GET  | `/api/files/root` | 返回 `fileRoot` 绝对路径 |
| GET  | `/api/files/list?path=` | 列目录 |
| GET  | `/api/files/download?path=` | 下载文件 |
| POST | `/api/files/upload` | `multipart/form-data`：`path`、`files`（可多个） |
| POST | `/api/files/mkdir` | JSON：`{ "path": "..." }` |
| DELETE | `/api/files/delete` | JSON：`{ "path": "..." }` |

上传限制：Stack Analyzer ELF ≤ 100MB；File Browser 单文件 ≤ 500MB。

## 依赖

- **前端**：浏览器，`pako` 与 `fflate`（通过 CDN `jsdelivr.net` 加载，离线环境需自行替换）。
- **后端**：Node.js ≥ 16，`express`、`cors`、`multer`，以及所需的 `*-addr2line` 可执行文件（如 `arm-none-eabi`、`xtensa-esp32-elf`）。
