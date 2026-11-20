# TCP 服务端数据模拟（Vue3 + Element Plus + Electron）

多服务端 TCP 监听、PLC/读码器发码模拟、一键/定时发码、码包与日志。配置与安装目录分离，覆盖安装不丢数据。

## 功能

### 设备与发码

| 能力 | 说明 |
| --- | --- |
| 多服务端 | 类型 **PLC** / **读码器**：IP、端口、前缀、**后缀**、码长度、单次个数、周期、计划发码数等 |
| TCP 服务端 | 设置里 **开启** 后监听，等待客户端连接；发送内容末尾统一加 `\r\n` |
| 生码规则 | **前缀 + 码体**（码长按前缀类型自动判断）；码包优先；随机前段 + 流水尾；**启用 ID** / **后缀** |
| 生成 / 发送 | 界面可编辑待发内容；**生成码**、单次 **发送**、**生码导出**（导出不带 ID） |
| 定时发码 | 各设备卡片「定时发送码」独立开关；未参与一键发码的设备可在一键发送运行中照常定时 |
| **一键发送** | 顶栏按钮；仅 **开启** 且勾选 **一键发码** 的设备参与；有 PLC 时按帧同步读码器与 PLC |
| 码包 | **启用导入码** 后可导入 txt（内存队列，重启清空） |
| 达计划提示 | 定时/一键发满 **计划发码数** 后界面提示并自动收尾 |

### 界面与其它

- 无边框窗口（标题栏拖拽、最小化/最大化/关闭；**F11** 全屏切换，全屏或最大化时标题栏按钮为「还原」；开发态 **F12** / Ctrl+Shift+I 开发者工具）
- 每个服务端可单独 **输出日志**
- 在线检查更新 / 差量下载 / 版本回退（设置内）

## 配置保存

- 路径：`%APPDATA%\HansChaoyun\TCPServerSim\config.json`（悬停主界面底部可查看完整路径）
- **手动落盘**：主界面 **「保存配置」** 或设置弹窗 **「保存」**；改待发内容、生成码等会先提示「有未保存修改」
- 启动时 **只恢复 TCP 监听**，不自动恢复定时发码 / 一键发码
- 换机：复制 `config.json` 到新机同路径；码包、会话计数需重新导入 / 清零

详见 [docs/配置与AppData持久化说明.md](docs/配置与AppData持久化说明.md)。

## 日志

- 默认目录：`文档\tcp-server-logs`（可在界面修改 **日志路径**）
- 按日单文件：`YYYY-MM-DD.txt`
- 生码导出 txt 与日志同目录

## 项目结构

仓库内主要目录（`node_modules/`、`dist/`、`release/`、`release-pack-*/` 为构建或打包产出，一般不提交）：

```text
tcp-client/
├── electron/                 # Electron 主进程
│   ├── main.cjs              # 窗口、TCP、定时/一键发码、IPC、config.json 读写
│   ├── preload.cjs           # contextBridge → window.api
│   ├── codegen.cjs           # 生码规则（PLC/读码器、码包、ID、后缀）
│   └── updater.cjs           # electron-updater 检查/差量/回退
├── src/                      # Vue 3 界面（Vite）
│   ├── App.vue               # 主界面：设备卡、发码、保存配置、一键发送
│   ├── components/
│   │   └── SettingsDialog.vue  # 设置表、在线更新/回退
│   ├── styles/app.css
│   └── main.js
├── scripts/
│   ├── dev-electron.cjs      # npm run dev 时启动 Electron
│   ├── pack.cjs              # 打包：版本号、nsis + nsis-web、release-pack-*
│   └── update-versions-json.cjs  # 生成 versions.json（回退列表）
├── docs/                     # 说明文档
├── build/icon.png            # 应用图标（打包用）
├── public/icon.png
├── index.html
├── vite.config.js
└── package.json              # 依赖与 electron-builder 配置
```

运行时数据（不在仓库内）：

| 路径 | 内容 |
| --- | --- |
| `%APPDATA%\HansChaoyun\TCPServerSim\config.json` | 设备配置、日志路径、更新地址 |
| 用户配置的 `logPath` | 按日 `.txt` 日志、生码导出文件 |

## 启动

需 Node.js 18+（推荐 22）：

```bash
npm install
npm run dev
```

> 修改 `electron/main.cjs`、`preload.cjs` 后需 **重启** Electron；仅改 Vue 可热更新。

## 打包分发

```bash
npm run pack
```

完成后在 **`release-pack-YYYYMMDD/`**（同日多次为 `release-pack-YYYYMMDD-2`）得到安装包，例如：

`release-pack-20261118/TCP服务端数据模拟-Setup-1.0.x.exe`

> `npm run build` 只生成前端 `dist/`，不出安装包；安装包请用 **`npm run pack`**。

把 **Setup.exe** 拷到目标电脑安装即可；目标机无需 Node。安装后可从设置配置在线更新地址。

## 在线更新（差量 + 回退）

打包会同时生成 **完整 Setup** 与 **WebSetup + .nsis.7z**（差量）。更新地址在 **设置 → 更新地址**，写入 AppData。

| 文件 | 说明 |
| --- | --- |
| `latest.yml` | 当前版本清单（含 web 包信息） |
| `*-WebSetup-*.exe` + `*.nsis.7z` | 在线差量升级 |
| `versions.json` | 历史版本（回退列表） |
| `*-Setup-*.exe` | 离线安装 / 回退整包 |

默认 OSS 根目录（**不要**末尾 `/`）：

```text
https://bnspic.oss-cn-guangzhou.aliyuncs.com/tcp-server-tool/
```

发版：`npm run pack` → 上传上表文件 → 保留旧版 `.7z` / Setup 以便差量与回退。

完整说明见 [docs/在线更新功能说明.md](docs/在线更新功能说明.md)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [配置与 AppData 持久化说明](docs/配置与AppData持久化说明.md) | 读写时机、字段结构、换机备份 |
| [在线更新功能说明](docs/在线更新功能说明.md) | OSS 布局、差量、回退、打包脚本 |