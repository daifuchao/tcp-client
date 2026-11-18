# TCP 服务端数据模拟（Vue3 + Element Plus + Electron）

多服务端监听、周期发码、可编辑生码内容，支持按服务端开关输出按日期命名的 `.txt` 日志。

## 功能

- 多服务端配置（PLC / 读码器）：监听 IP、端口、前缀、码长度、周期等
- **开启**后作为 TCP **服务端**监听，等待客户端接入
- 生成码后可编辑内容再发送；支持定时发码、  导入码包
- 配置持久化到 `%APPDATA%\HansChaoyun\TCPServerSim\config.json`（与安装目录分离，升级 .exe 不丢失）
- 日志默认在「文档\tcp-server-logs」，路径可改
- 每个服务端可单独勾选「输出日志」
- 日志路径可编辑；文件名按 `YYYY-MM-DD.txt`

## 启动

需 Node.js 18+（推荐 22）：

```bash
npm install
npm run dev
```

## 打包分发

```bash
npm run pack
```

完成后在 **`release-pack-YYYYMMDD/`**（每次打包单独目录，同日多次打包为 `release-pack-YYYYMMDD-2`）得到安装包，例如：

`release-pack-20261117/TCP服务端数据模拟-Setup-1.0.7.exe`

> `npm run build` 只生成前端 `dist/`，不会出安装包；安装包请用 **`npm run pack`**。

**只需把这一个 Setup.exe 拷到其他电脑运行安装即可**，不必拷贝 `win-unpacked` 或其它文件。安装后会生成桌面/开始菜单快捷方式，程序自带运行时，目标电脑无需再装 Node。

## 在线更新（局部/差量）

打包会同时生成：

- **完整安装包** `*-Setup-*.exe`：U 盘/离线首次安装
- **Web 差量包** `*-WebSetup-*.exe` + `*.7z`：在线升级只拉变更块（HTTP Range），不整包下 90MB+ 的 Setup

更新地址在 **设置 → 更新地址** 配置，并会写入 AppData。OSS 需支持单段 `Range`（阿里云默认支持）。

### 1. 服务器上放哪些文件

把 `npm run pack` 生成的这些文件放到同一个 HTTP 目录：

| 文件 | 说明 |
| --- | --- |
| `latest.yml` | 更新清单（含 `packages`，指向 web 差量包） |
| `TCP服务端数据模拟-WebSetup-x.y.z.exe` | 小体积 web 安装器 |
| `*-x64.nsis.7z` | 应用包（差量下载主体，勿删旧版 7z） |
| `versions.json` | 历史版本列表（建议上传；没有时客户端会自动探测旧 Setup） |
| `TCP服务端数据模拟-Setup-x.y.z.exe` | 完整安装包（离线安装 / 版本回退） |

默认更新目录（阿里云 OSS）：

```text
https://bnspic.oss-cn-guangzhou.aliyuncs.com/tcp-server-tool/
  latest.yml                          ← 必须是含 packages 的 web 清单
  versions.json
  TCP服务端数据模拟-WebSetup-1.0.4.exe
  tcp-server-sim-1.0.4-x64.nsis.7z
  TCP服务端数据模拟-Setup-1.0.4.exe   ← 离线/回退
  （保留上一版 .nsis.7z / Setup）
```

`npm run pack` 会把 `nsis-web/` 里的更新清单与差量包提升到输出根目录，上传根目录文件即可。

> Web 安装器会把包地址写成 `{publish.url}/{文件名}`。`publish.url` / `nsisWeb.appPackageUrl` **不要**带末尾 `/`，否则会变成 `tool//xxx.7z` 导致 404。

### 2. 客户端

- 升级：检查更新 → 下载更新（优先差量）→ 安装并重启  
  首次从完整 Setup 装上后的**第一次**在线更新可能仍接近整包；之后版本间多为差量。
- 回退：选择更低版本 → 回退并安装（下载对应完整 Setup）

### 3. 发新版本流程

1. `npm run pack`（自动 patch 自增 `version`，打 nsis + nsis-web，并更新 `versions.json`）
2. 上传 `latest.yml`、`WebSetup`、`*.7z`、`versions.json`；完整 `Setup.exe` 也建议上传（离线/回退）
3. **不要删旧版 `.7z` / Setup**，否则差量或回退会失败
4. 已安装电脑打开设置检查更新即可

> 修改 Electron 主进程后需重启 `npm run dev`。
