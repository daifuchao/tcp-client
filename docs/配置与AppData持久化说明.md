# 配置与 AppData 持久化说明

本文说明 **TCP服务端数据模拟** 如何把用户配置写入磁盘、何时读回、与界面/主进程如何配合，以及如何迁移到其他电脑。

---

## 1. 设计目标

| 目标 | 做法 |
| --- | --- |
| 升级安装不丢配置 | 配置与 `.exe` / 安装目录分离，固定写在系统 **AppData** |
| 单一数据源 | 一台机器一份 `config.json`，包含全局项 + 全部设备 |
| 双通道写盘 | **界面** `saveData` 整表保存；**主进程** `persistServerUidState` 发码时增量写单设备字段 |
| 运行时状态与配置分离 | TCP 连接、发码计数、码包队列、一键发码调度等 **不写入** `config.json` |
| 发码调度与配置项关系 | `enableBatch` 只影响顶栏「一键发送」；**定时发码**按设备单独开关，互不禁止 |

---

## 2. 文件路径

### 2.1 正式路径（当前唯一权威位置）

逻辑在 `electron/main.cjs`：

```javascript
function getConfigDir() {
  return path.join(app.getPath('appData'), 'HansChaoyun', 'TCPServerSim')
}

function getConfigPath() {
  return path.join(getConfigDir(), 'config.json')
}
```

| 平台 | 示例 |
| --- | --- |
| Windows | `%APPDATA%\HansChaoyun\TCPServerSim\config.json` |
| 展开示例 | `C:\Users\<用户名>\AppData\Roaming\HansChaoyun\TCPServerSim\config.json` |

> `app.getPath('appData')` 在 Windows 上即 `%APPDATA%`（Roaming），**不是** 安装目录，也 **不是** Electron 默认的 `userData`（一般形如 `%APPDATA%\tcp-server-sim`）。

### 2.2 日志与配置的物理分离

| 内容 | 存放 |
| --- | --- |
| 应用配置 `config.json` | 上表 AppData 目录 |
| 运行日志、生码导出 `.txt` | `config.json` 里的 `logPath`（默认 `文档/tcp-server-logs`，用户可改） |

日志按日追加：`{logPath}/{年}-{月}-{日}.txt`。

### 2.3 在界面中查看 / 打开 `config.json`

| 入口 | 行为 |
| --- | --- |
| 底栏 **「打开配置」** 按钮 | IPC `data:openConfig` |
| 底栏 **「配置保存在 AppData…」** 链接 | 同上 |
| 悬停提示 | 显示 `configPath` 绝对路径（来自 `loadData().configPath`） |

Windows 上 **`.json` 常无系统默认打开方式**，不能像 `.txt` 一样用 `shell.openPath` 双击打开。因此 `openConfigFile()` **固定调用 `notepad.exe` + 文件路径**，不依赖文件关联。

| 对比 | 说明 |
| --- | --- |
| 今日日志 `.txt` | `log:openToday` 使用 `shell.openPath`，系统多已关联记事本 |
| `config.json` | `data:openConfig` 使用记事本进程打开，避免「没有与之关联的应用」 |

实现：`electron/main.cjs` 中 `openConfigFile()`；`preload` 暴露 `window.api.openConfigFile()`。

---

## 3. `config.json` 结构

经 `normalizeData()` 规范化后，根对象字段如下：

```json
{
  "logPath": "C:\\Users\\...\\Documents\\tcp-server-logs",
  "updateUrl": "https://bnspic.oss-cn-guangzhou.aliyuncs.com/tcp-server-tool",
  "servers": [
    {
      "id": "1731_abc123",
      "enabled": true,
      "enableBatch": false,
      "timedSend": false,
      "enableId": false,
      "enableImport": false,
      "enableLog": true,
      "type": "读码器",
      "name": "读码器1",
      "ip": "192.168.1.10",
      "port": 2001,
      "prefix": "https://www.bottle.com/",
      "suffix": "",
      "codeLength": 20,
      "sendCount": 1,
      "generateCount": 10,
      "cycleMs": 1000,
      "planCount": 0,
      "uidSeq": 1,
      "uidHead": "abcdefghijklmnop",
      "draftCode": "当前待发送内容，多码逗号分隔"
    }
  ]
}
```

### 3.1 根级字段

| 字段 | 含义 |
| --- | --- |
| `logPath` | 日志目录与生码导出目录 |
| `updateUrl` | 在线更新 OSS 根地址（保存时会同步到 `electron-updater`） |
| `servers` | 设备列表（兼容旧字段名 `clients`，读入时会映射为 `servers`） |

### 3.2 单台 `servers[]` 字段

| 字段 | 含义 |
| --- | --- |
| `id` | 稳定主键，TCP 会话、码包 Map 均按此关联 |
| `enabled` | 是否开启 TCP 监听（与「设置-开启」一致） |
| `enableBatch` | 是否参与顶栏 **「一键发送」**（与单机 **定时发码** 可同时勾选） |
| `timedSend` | 是否处于「定时发送码」状态（会写入；**启动应用时界面会全部清 false 并写回**，不自动续跑） |
| `enableId` / `enableImport` / `enableLog` | 启用 ID、导入码包 UI、写日志 |
| `type` | `PLC` 或 `读码器` |
| `name` / `ip` / `port` | 显示名与监听地址 |
| `prefix` / `suffix` | 码前缀；后缀（拼在码体与 `:01` 等 ID 之间） |
| `codeLength` / `sendCount` / `generateCount` | 码长度（**按前缀自动**：URL 类为码体位数；短前缀如 `OK` 为整条码上限）、单次个数、生码导出条数 |
| `cycleMs` / `planCount` | 发码周期、计划发码数（0=不限） |
| `uidSeq` / `uidHead` | 流水号（尾段自增）；`uidHead` 历史字段，长码现改为每条随机前段 |
| `draftCode` | 界面文本框中的待发内容 |

缺省值、类型矫正（如 `codeLength` 最小 1）均在 `normalizeData()` / `codegen.cjs` 中完成。生码规则见 `codegen.cjs` 文件头注释。

---

## 4. 核心 API（主进程）

### 4.1 `ensureDataFile()`

**首次需要磁盘文件时调用**（读、写前都会走到）：

1. 创建目录 `getConfigDir()`（若不存在）。
2. 若 `config.json` 已存在 → 直接返回路径。
3. 否则按顺序尝试 **旧版迁移**（读到即写入新路径并规范化）：
   - `项目/data/config.json`
   - `项目/data/servers.json`
   - `%APPDATA%/<Electron userData>/config.json`
   - `.../servers.json`
   - `.../clients.json`
4. 仍无有效旧文件 → 写入 `defaultPayload()` 默认配置。

### 4.2 `loadData()`

1. `ensureDataFile()`
2. `JSON.parse` 读 `config.json`，失败则用 `defaultPayload()`
3. `normalizeData(raw)`
4. 返回 `{ ...data, configPath: DATA_FILE }`（多一个 `configPath` 供界面展示）

**不经过 IPC 的内部调用很多**：发码、一键发码排期、合并设备参数等都会 `loadData()` 取 **磁盘上最新** 的 `servers` 条目。

### 4.3 `saveData(data)`

1. `ensureDataFile()`
2. `normalizeData(data)`
3. **整文件覆盖** `fs.writeFileSync(config.json, JSON.stringify(payload, null, 2))`
4. 返回 `{ ok: true, configPath, ...payload }`

### 4.4 `persistServerUidState(serverId, patch)`（主进程增量写）

仅更新 **单台** 设备的字段，用于发码流程中不经过界面 `persist()` 的写回：

| patch 字段 | 写回内容 |
| --- | --- |
| `uidSeq` | 下一流水号 |
| `uidHead` | 前段固定串 |
| `draftCode` | 本次生成/发送后的待发文本 |

流程：`loadData()` → 找到 `servers[].id` → 改字段 → `saveData(data)`。

**调用场景（主进程）**：

| 场景 | 通常写入 |
| --- | --- |
| `tcp:buildPayload`（界面「生成码」） | `uidSeq`、`uidHead` |
| 定时发码 tick `runTimedCycleTick` | `uidSeq`、`uidHead`、`draftCode` |
| 一键发码 `batchSendDevice` | 同上 |
| 生码导出 `exportCodesToFile` | `uidSeq`、`uidHead` |
| 定时达计划 `stopTimedCycleForPlan` | `persistTimedSendOff` → 磁盘 `timedSend: false` |

### 4.5 `openConfigFile(filePath)`

Windows：`spawn(notepad.exe, [filePath])`。非 Windows：尝试 `shell.openPath`，失败则 `showItemInFolder`。

---

## 5. IPC 与 `preload` 暴露

`electron/preload.cjs` → `window.api`：

| 方法 | 主进程 | 作用 |
| --- | --- | --- |
| `loadData()` | `data:load` | 读完整配置 + `configPath` |
| `saveData(data)` | `data:save` | 整表保存；并 `updater.applyFeedUrl(updateUrl)` |
| `getConfigPath()` | `data:configPath` | 仅返回 `config.json` 绝对路径 |
| `openConfigFile()` | `data:openConfig` | 用记事本（Windows）等方式打开配置 |

其他 TCP/发码 IPC **不直接替代** `saveData`，但可能触发 `persistServerUidState` 或 `loadData()` 读最新设备参数。

### 5.1 保存时同步更新源

`data:save` 成功后会：

```javascript
if (result.updateUrl) updater.applyFeedUrl(result.updateUrl)
```

检查/回退更新时，若传入的 URL 与磁盘不一致，主进程也会先 `saveData` 再检查。

---

## 6. 何时读取配置

### 6.1 应用启动

```text
app.whenReady()
  → ensureDataFile()          // 保证文件存在 / 迁移
  → stopBatchSend()           // 一键发码状态仅内存，不持久化
  → createWindow()
       → loadData()
       → updater.applyFeedUrl(data.updateUrl)
  → 加载 Vue 界面

界面 onMounted → load()
  → window.api.loadData()     // 填充 servers / logPath / updateUrl / configPath
  → 各设备 timedSend 置 false // 不自动恢复定时发码
  → applyServerRuntime        // 仅恢复 enabled 的 TCP 监听
  → persist()                 // 把 timedSend 清零等写回磁盘
```

主窗口创建时读一次配置是为了 **更新源**；界面 `load()` 再读一次是为了 **展示与运行态对齐**。

**一键发码**不会随启动自动运行，需点顶栏「一键发送」。

### 6.2 运行中「读盘」的典型时机

| 时机 | 目的 |
| --- | --- |
| `tcp:buildPayload` / `codes:exportFile` | 合并磁盘 `latest` 与界面传入的 `serverCfg` |
| `runTimedCycleTick` | 读 `enabled`、`timedSend`、`planCount` 等 |
| `getBatchServers()` | 读 `enabled` + `enableBatch` |
| `checkUpdate` / `rollback`（URL 变更） | 读写 `updateUrl` |

合并规则：IPC 处理器内将 `serverCfg` 与 `loadData()` 得到的 `latest` 字段合并（见 `tcp:buildPayload`、`codes:exportFile` 中的 `merged` 对象）。

---

## 7. 何时写入配置

### 7.1 渲染进程整表保存（`App.vue` → `persist()`）

`persist()` 调用 `saveData({ logPath, updateUrl, servers: snapshotServers() })`。

| 触发 | 说明 |
| --- | --- |
| 应用 `load()` 结束 | 写回启动时 `timedSend` 清零等 |
| 设置弹窗保存 | `onSettingsSaved` → `persist(true)` 并提示 |
| 主界面 **「保存配置」** | `persist(true)` |
| `logPath` / `draftCode` / `enableLog` 变更 | `@change` → `persist()` |
| 切换 **定时发码** | `timedSend` 变更后 `persist()` |
| **生成码** | 更新界面字段后 `persist()`（主进程也会写 `uidSeq`/`uidHead`） |
| **生码导出**成功 | `persist()` + 主进程写 `uidSeq`/`uidHead` |
| **一键发送** 开始/停止 | 清除参与设备 `timedSend` 等后 `persist()` |

设置弹窗 **不直接** `saveData`：点「保存」通过 `emit('saved')` 交给 `App.vue` 的 `persist(true)`。

### 7.2 主进程增量保存

见 §4.4；与界面 `persist()` **可能交错**（例如定时发码写 `draftCode` 的同时用户在改设置）。以 **最后一次 `saveData`** 为准。

### 7.3 **不会** 写入 `config.json` 的内容

| 数据 | 存储 |
| --- | --- |
| 已发条数 `sentCount` | 主进程 `sessions` Map，重启为 0 |
| 导入码包队列 | 主进程 `codePackages` Map，重启清空 |
| 一键发码运行中、事件队列 | `batchState`，仅内存 |
| TCP 连接、定时器句柄 | `sessions`，仅内存 |

`tcp:clearCount` 只清内存计数，不写盘。

---

## 8. 数据流示意

```mermaid
flowchart TB
  subgraph disk["磁盘"]
    CFG["AppData/HansChaoyun/TCPServerSim/config.json"]
    LOG["logPath 下 .txt 日志 / 导出码"]
  end

  subgraph renderer["渲染进程 Vue"]
    UI["App.vue / SettingsDialog"]
    PERSIST["persist() → saveData"]
  end

  subgraph main["Electron 主进程"]
    LOAD["loadData()"]
    SAVE["saveData()"]
    PATCH["persistServerUidState()"]
    OPEN["openConfigFile → notepad"]
    RUN["TCP / 定时发码 / 一键发码"]
  end

  UI --> PERSIST
  PERSIST --> SAVE
  SAVE --> CFG
  LOAD --> CFG
  CFG --> LOAD
  LOAD --> RUN
  RUN --> PATCH
  PATCH --> SAVE
  RUN --> LOG
  UI --> LOAD
  UI --> OPEN
  OPEN --> CFG
```

---

## 9. 换机 / 备份 / 还原

1. **备份**：关闭应用，复制整个 `config.json`（必要时连同 `logPath` 目录）。
2. **还原**：在新机安装同版本应用，将 `config.json` 放到同路径（或先运行一次再覆盖）。
3. **注意**：
   - 修改 `ip`、日志路径等适应新环境。
   - **码包需重新导入**。
   - **已发条数** 从 0 开始。
   - 启动后 **不会自动定时/一键发码**，需手动再开。

仅同步部分设备：编辑 JSON 中 `servers` 数组，合并时注意 `id` 不重复。

---

## 10. 开发与打包差异

| 项 | 开发 `npm run dev` | 打包版 |
| --- | --- | --- |
| 配置路径 | 同上 AppData（非项目目录） | 同上 |
| 首次无文件 | 可迁移 `data/config.json` | 仅默认或旧 userData 迁移 |
| 界面加载 | Vite HMR；主进程改 `main.cjs` / `preload` 需重启 Electron | 加载 `dist/index.html` |

底栏「配置保存在 AppData」可点击；`configPath` 来自 `loadData().configPath`。

---

## 11. 相关源码索引

| 文件 | 职责 |
| --- | --- |
| `electron/main.cjs` | 配置读写、`persistServerUidState`、`openConfigFile`、`data:*` IPC |
| `electron/preload.cjs` | `loadData` / `saveData` / `getConfigPath` / `openConfigFile` |
| `src/App.vue` | `load()`、`persist()`、底栏打开配置、定时/一键交互 |
| `src/components/SettingsDialog.vue` | 编辑本地副本，`saved` → `persist(true)` |
| `electron/codegen.cjs` | 生码规则（不直接读写盘） |
| `electron/updater.cjs` | `updateUrl`（由 `saveData` / 启动时注入） |
| `README.md` | 用户向功能与项目结构说明 |

---

## 12. 常见问题

**Q：改了设置但发码仍像旧参数？**  
A：设置弹窗需点「保存」；发码 IPC 会 `loadData()` 合并磁盘。若刚改主界面待发内容，需等 `persist()` 完成或点「保存配置」。

**Q：生成码后 `uidSeq` 变了但重启又对不上？**  
A：主进程 `persistServerUidState` 与界面 `persist()` 都会写盘；查看 `config.json` 中对应字段是否已更新。

**Q：为什么打开 `config.json` 报错，打开 `.txt` 正常？**  
A：Windows 对 `.json` 常无默认应用。请用程序内「打开配置」（记事本打开），勿依赖资源管理器双击。

**Q：`enableBatch` 与「定时发送码」关系？**  
A：`enableBatch` 只控制是否加入顶栏一键发送；未勾选一键发码的设备在一键发送运行中仍可单独定时发码；仅参与一键的设备会互斥。

**Q：两个 Electron 实例同时开？**  
A：同一路径 `config.json` 会被后写覆盖，不建议多开。

**Q：配置与 Electron `userData` 关系？**  
A：本项目使用 `appData/HansChaoyun/TCPServerSim`；仅在 **迁移** 时读取旧 `userData` 下的 json，日常不再写入那里。