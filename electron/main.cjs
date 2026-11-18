const { app, BrowserWindow, ipcMain, dialog, nativeImage, Menu, shell, screen } = require('electron')
const path = require('path')
const fs = require('fs')
const net = require('net')
const os = require('os')
const {
  normalizeSeq,
  ensureUidHead,
  generateCodes,
  generateBulkCodes
} = require('./codegen.cjs')
const updater = require('./updater.cjs')

const isDev = !app.isPackaged

/** 默认在线更新目录（阿里云 OSS） */
const DEFAULT_UPDATE_URL = 'https://bnspic.oss-cn-guangzhou.aliyuncs.com/tcp-server-tool/'

/**
 * 配置固定存到 AppData，不跟安装目录/.exe 走，升级覆盖安装不会丢数据。
 * Windows 示例：%APPDATA%\HansChaoyun\TCPServerSim\config.json
 */
function getConfigDir() {
  return path.join(app.getPath('appData'), 'HansChaoyun', 'TCPServerSim')
}

function getConfigPath() {
  return path.join(getConfigDir(), 'config.json')
}

/** @type {Map<string, { server: net.Server | null, sockets: Set<net.Socket>, timer: NodeJS.Timeout | null, sentCount: number }>} */
const sessions = new Map()

/** 码包仅内存保存，重启清空；key=服务端id，value=剩余单码队列（一行一条） */
/** @type {Map<string, string[]>} */
const codePackages = new Map()

/** 一键发送启动后，PLC 在每周期末尾略提前于下一帧读码器（ms） */
const BATCH_PLC_END_LEAD_MS = 10

/** 一键发送（批量自动发码）状态 */
const batchState = {
  running: false,
  logPath: '',
  batchPumpTimer: null,
  /** @type {{ at: number, run: () => void }[]} */
  batchEventQueue: [],
  batchEpoch: 0,
  /** 已排期的 PLC 帧数（下一帧索引） */
  batchPlannedFrameCount: 0,
  plcStaggerTimers: [],
  readerTimers: new Map(),
  frameCycleMs: 1000
}

function getLocalLanIp() {
  const nets = os.networkInterfaces()
  const fallbacks = []
  for (const list of Object.values(nets)) {
    for (const item of list || []) {
      const family = item.family
      const isV4 = family === 'IPv4' || family === 4
      if (!isV4 || item.internal) continue
      if (String(item.address).startsWith('192.168.')) return item.address
      fallbacks.push(item.address)
    }
  }
  return fallbacks[0] || '127.0.0.1'
}

function defaultLogPath() {
  return path.join(app.getPath('documents'), 'tcp-server-logs')
}

function defaultPayload() {
  return {
    logPath: defaultLogPath(),
    /** 在线更新根地址（generic），目录内放 latest.yml 与安装包 */
    updateUrl: DEFAULT_UPDATE_URL,
    servers: [
      {
        id: '1',
        enabled: false,
          enableBatch: false,
          enableId: false,
          enableImport: false,
          enableLog: true,
          type: 'PLC',
          name: 'PLC1',
          ip: getLocalLanIp(),
          port: 2000,
          prefix: 'https://www.bottle.com/',
          suffix: '',
          codeLength: 20,
          sendCount: 1,
          generateCount: 10,
          cycleMs: 1000,
          planCount: 0,
        timedSend: false,
        uidSeq: 1,
        uidHead: '',
        draftCode: ''
      }
    ]
  }
}

function normalizeData(raw) {
  const servers = Array.isArray(raw?.servers)
    ? raw.servers
    : Array.isArray(raw?.clients)
      ? raw.clients
      : []
  return {
    logPath: typeof raw?.logPath === 'string' && raw.logPath ? raw.logPath : defaultLogPath(),
    updateUrl:
      typeof raw?.updateUrl === 'string' && raw.updateUrl.trim()
        ? raw.updateUrl.trim()
        : DEFAULT_UPDATE_URL,
    servers: servers.map((s) => {
      const codeLength = Math.max(5, Number(s.codeLength) || 20)
      return {
        id: String(s.id || `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`),
        enabled: !!s.enabled,
        enableBatch: !!s.enableBatch,
        timedSend: !!s.timedSend,
        enableId: !!s.enableId,
        enableImport: !!s.enableImport,
        enableLog: s.enableLog !== false,
        type: s.type || '读码器',
        name: s.name || '服务端',
        ip: s.ip || getLocalLanIp(),
        port: Number(s.port) || 2000,
        prefix: s.prefix || '',
        suffix: typeof s.suffix === 'string' ? s.suffix : '',
        codeLength,
        sendCount: Number(s.sendCount) || 1,
        generateCount: Math.max(1, Number(s.generateCount) || 10),
        cycleMs: Number(s.cycleMs) || 1000,
        planCount: Number(s.planCount) || 0,
        uidSeq: normalizeSeq(s.uidSeq == null ? 1 : s.uidSeq),
        uidHead: ensureUidHead(s.uidHead, codeLength),
        draftCode: typeof s.draftCode === 'string' ? s.draftCode : ''
      }
    })
  }
}

function tryReadJson(file) {
  try {
    if (!fs.existsSync(file)) return null
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return null
  }
}

function ensureDataFile() {
  const DATA_FILE = getConfigPath()
  const dir = path.dirname(DATA_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  if (fs.existsSync(DATA_FILE)) return DATA_FILE

  // 兼容旧位置（开发目录 / Electron userData）
  const legacyCandidates = [
    path.join(__dirname, '../data/config.json'),
    path.join(__dirname, '../data/servers.json'),
    path.join(app.getPath('userData'), 'config.json'),
    path.join(app.getPath('userData'), 'servers.json'),
    path.join(app.getPath('userData'), 'clients.json')
  ]
  for (const legacy of legacyCandidates) {
    const old = tryReadJson(legacy)
    if (old) {
      const migrated = normalizeData(old)
      fs.writeFileSync(DATA_FILE, JSON.stringify(migrated, null, 2), 'utf-8')
      return DATA_FILE
    }
  }

  fs.writeFileSync(DATA_FILE, JSON.stringify(defaultPayload(), null, 2), 'utf-8')
  return DATA_FILE
}

function loadData() {
  const DATA_FILE = ensureDataFile()
  const raw = tryReadJson(DATA_FILE) || defaultPayload()
  const data = normalizeData(raw)
  return {
    ...data,
    configPath: DATA_FILE
  }
}

function saveData(data) {
  const DATA_FILE = ensureDataFile()
  const payload = normalizeData(data)
  fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2), 'utf-8')
  return { ok: true, configPath: DATA_FILE, ...payload }
}

function todayLogName() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}.txt`
}

function formatLogTime(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  const ms = String(date.getMilliseconds()).padStart(3, '0')
  return `${y}/${m}/${d} ${hh}:${mm}:${ss}.${ms}`
}

function writeLogSync(logPath, enableLog, line) {
  if (!enableLog || !logPath) return
  try {
    if (!fs.existsSync(logPath)) fs.mkdirSync(logPath, { recursive: true })
    const file = path.join(logPath, todayLogName())
    fs.appendFileSync(file, `[${formatLogTime()}] ${line}\n`, 'utf-8')
  } catch (err) {
    console.error('write log failed:', err)
  }
}

function writeLog(logPath, enableLog, line) {
  if (!enableLog || !logPath) return
  if (batchState.running) {
    setImmediate(() => writeLogSync(logPath, enableLog, line))
    return
  }
  writeLogSync(logPath, enableLog, line)
}

function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, { server: null, sockets: new Set(), timer: null, sentCount: 0 })
  }
  return sessions.get(id)
}

function stopServer(id) {
  const sess = getSession(id)
  if (sess.timer) {
    clearInterval(sess.timer)
    sess.timer = null
  }
  for (const socket of sess.sockets) {
    try {
      socket.destroy()
    } catch {}
  }
  sess.sockets.clear()
  if (sess.server) {
    try {
      sess.server.close()
    } catch {}
    sess.server = null
  }
}

function startServer(serverCfg, logPath) {
  return new Promise((resolve) => {
    stopServer(serverCfg.id)
    const sess = getSession(serverCfg.id)
    const host = serverCfg.ip || '0.0.0.0'
    const port = Number(serverCfg.port)
    const server = net.createServer((socket) => {
      sess.sockets.add(socket)
      const remote = `${socket.remoteAddress}:${socket.remotePort}`
      writeLog(logPath, serverCfg.enableLog, `[${serverCfg.name}] 客户端接入 ${remote}`)

      socket.on('data', (buf) => {
        writeLog(logPath, serverCfg.enableLog, `[${serverCfg.name}] 收到(${remote}): ${buf.toString('utf-8')}`)
      })

      socket.on('error', (err) => {
        writeLog(logPath, serverCfg.enableLog, `[${serverCfg.name}] 连接错误(${remote}): ${err.message}`)
      })

      socket.on('close', () => {
        sess.sockets.delete(socket)
        writeLog(logPath, serverCfg.enableLog, `[${serverCfg.name}] 客户端断开 ${remote}`)
      })
    })

    let settled = false
    const done = (ok, msg) => {
      if (settled) return
      settled = true
      writeLog(logPath, serverCfg.enableLog, `[${serverCfg.name}] ${msg}`)
      resolve({ ok, msg })
    }

    server.on('error', (err) => {
      sess.server = null
      done(false, `监听失败: ${err.message}`)
    })

    server.listen(port, host, () => {
      sess.server = server
      done(true, `服务端已开启 ${host}:${port}`)
    })
  })
}

function takeFromPackage(serverId, count) {
  const list = codePackages.get(serverId) || []
  const n = Math.max(0, Number(count) || 0)
  const taken = list.splice(0, n)
  codePackages.set(serverId, list)
  return { taken, remain: list.length }
}

function buildPayload(serverCfg) {
  return generateCodes(serverCfg, {
    getPackageRemain,
    takeFromPackage
  })
}

function sanitizeFileToken(name) {
  return String(name || '读码器')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80) || '读码器'
}

function codeExportFileName(serverName) {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${sanitizeFileToken(serverName)}_${y}-${m}-${day}_${hh}-${mm}-${ss}.txt`
}

function exportCodesToFile(serverCfg, logPath) {
  const count = Math.max(1, Number(serverCfg.generateCount) || 10)
  const dir = String(logPath || '').trim()
  if (!dir) return { ok: false, msg: '请先配置日志路径' }

  const built = generateBulkCodes(serverCfg, count)
  const lines = (built.codes || []).map((c) => String(c || '').trim()).filter(Boolean)
  if (!lines.length) return { ok: false, msg: '未生成有效条码' }

  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const fileName = codeExportFileName(serverCfg.name)
    const filePath = path.join(dir, fileName)
    fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf-8')
    persistServerUidState(serverCfg.id, { uidSeq: built.uidSeq, uidHead: built.uidHead })
    if (serverCfg.enableLog) {
      writeLog(dir, true, `[${serverCfg.name}] 生码 ${lines.length} 条 → ${fileName}`)
    }
    return { ok: true, count: lines.length, filePath, fileName, uidSeq: built.uidSeq, uidHead: built.uidHead }
  } catch (err) {
    return { ok: false, msg: err?.message || String(err) }
  }
}

function persistServerUidState(serverId, patch) {
  const data = loadData()
  const target = (data.servers || []).find((s) => s.id === serverId)
  if (!target) return
  if (patch.uidSeq != null) target.uidSeq = normalizeSeq(patch.uidSeq)
  if (patch.uidHead != null) target.uidHead = ensureUidHead(patch.uidHead, target.codeLength)
  if (patch.draftCode != null) target.draftCode = String(patch.draftCode)
  saveData(data)
}

function notifyDraftUpdated(payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send('tcp:draftUpdated', payload)
  }
}

function notifySendFinished(payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send('tcp:sendFinished', payload)
  }
}

function persistTimedSendOff(serverId) {
  const data = loadData()
  const target = (data.servers || []).find((s) => s.id === serverId)
  if (!target || !target.timedSend) return
  target.timedSend = false
  saveData(data)
}

function stopTimedCycleForPlan(serverCfg, logPath) {
  const sess = getSession(serverCfg.id)
  if (sess.timer) {
    clearInterval(sess.timer)
    sess.timer = null
  }
  persistTimedSendOff(serverCfg.id)
  const plan = Number(serverCfg.planCount) || 0
  const sent = sess.sentCount
  writeLog(
    logPath || loadData().logPath,
    serverCfg.enableLog !== false,
    `[${serverCfg.name}] 定时发码结束：已达计划 ${sent}/${plan} 条`
  )
  notifySendFinished({
    mode: 'timed',
    reason: 'plan-done',
    id: serverCfg.id,
    name: serverCfg.name || serverCfg.id,
    planCount: plan,
    sentCount: sent
  })
}

function notifyBatchDevicePlanDone(serverCfg, logPath) {
  const plan = Number(serverCfg.planCount) || 0
  if (plan <= 0 || !isDevicePlanDone(serverCfg)) return
  const enabled = getBatchServers()
  const hasOpenEnded = enabled.some((s) => s.id !== serverCfg.id && !(Number(s.planCount) > 0))
  const hasPendingLimited = enabled.some(
    (s) => s.id !== serverCfg.id && Number(s.planCount) > 0 && !isDevicePlanDone(s)
  )
  if (!hasOpenEnded && !hasPendingLimited) return

  const sent = getSession(serverCfg.id).sentCount
  writeLog(
    logPath || loadData().logPath,
    serverCfg.enableLog !== false,
    `[${serverCfg.name}] 一键发码：已达计划 ${sent}/${plan} 条`
  )
  notifySendFinished({
    mode: 'batch',
    reason: 'plan-done-device',
    id: serverCfg.id,
    name: serverCfg.name || serverCfg.id,
    planCount: plan,
    sentCount: sent
  })
}

function notifyBatchAllPlanDone(logPath, enabled) {
  const limited = enabled.filter((s) => Number(s.planCount) > 0)
  const servers = limited.map((s) => ({
    id: s.id,
    name: s.name || s.id,
    planCount: Number(s.planCount) || 0,
    sentCount: getSession(s.id).sentCount
  }))
  notifySendFinished({
    mode: 'batch',
    reason: 'plan-done-all',
    servers
  })
  writeLog(logPath, true, '[一键发送] 已停止：全部已达计划发码数')
}

function runTimedCycleTick(serverId, logPath) {
  const data = loadData()
  const latest = (data.servers || []).find((s) => s.id === serverId)
  const sess = getSession(serverId)
  if (!latest || !latest.enabled || !latest.timedSend) {
    if (sess.timer) {
      clearInterval(sess.timer)
      sess.timer = null
    }
    return
  }
  const built = buildPayload(latest)
  const draftCode = String(built.text || '').replace(/(?:\r\n|\n|\r)+$/g, '')
  persistServerUidState(latest.id, {
    uidSeq: built.uidSeq,
    uidHead: built.uidHead,
    draftCode
  })
  notifyDraftUpdated({
    id: latest.id,
    draftCode,
    uidSeq: built.uidSeq,
    uidHead: built.uidHead
  })
  const result = sendOnce(
    data.logPath || logPath,
    built.text
  )
  const plan = Number(latest.planCount) || 0
  if (plan > 0) {
    if (result.ok && sess.sentCount >= plan) {
      stopTimedCycleForPlan(latest, data.logPath || logPath)
    } else if (result.msg === '已达计划发码数') {
      stopTimedCycleForPlan(latest, data.logPath || logPath)
    }
  }
}

function importCodePackage(serverId, content) {
  const lines = String(content || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  codePackages.set(serverId, lines)
  return { ok: true, count: lines.length }
}

function getPackageRemain(serverId) {
  return (codePackages.get(serverId) || []).length
}

function sendOnce(serverCfg, logPath, customPayload) {
  const sess = getSession(serverCfg.id)
  if (!sess.server) {
    writeLog(logPath, serverCfg.enableLog, `[${serverCfg.name}] 服务端未开启，无法发送`)
    return { ok: false, msg: '服务端未开启' }
  }
  if (!sess.sockets.size) {
    writeLog(logPath, serverCfg.enableLog, `[${serverCfg.name}] 当前无客户端连接`)
    return { ok: false, msg: '当前无客户端连接' }
  }
  if (serverCfg.planCount > 0 && sess.sentCount >= serverCfg.planCount) {
    return { ok: false, msg: '已达计划发码数' }
  }

  let payload
  if (customPayload != null && String(customPayload).length) {
    payload = String(customPayload)
  } else {
    const built = buildPayload(serverCfg)
    payload = built.text
    payload = built.text
  }
  // 去掉已有结尾换行后，统一以回车换行 \r\n 结束每条消息
  const body = String(payload).replace(/(?:\r\n|\n|\r)+$/g, '')
  const wire = `${body}\r\n`

  try {
    let okCount = 0
    for (const socket of sess.sockets) {
      if (socket.destroyed) continue
      socket.write(wire, 'utf-8')
      okCount += 1
    }
    if (!okCount) return { ok: false, msg: '当前无可用连接' }
    const codeCount = body.split(',').map((x) => x.trim()).filter(Boolean).length || 1
    sess.sentCount += codeCount
    writeLog(
      logPath,
      serverCfg.enableLog,
      `[${serverCfg.name}] 向 ${okCount} 个连接发送: ${body}\\r\\n`
    )
    return { ok: true, msg: '发送成功', sentCount: sess.sentCount, payload: body, peers: okCount }
  } catch (err) {
    writeLog(logPath, serverCfg.enableLog, `[${serverCfg.name}] 发送失败: ${err.message}`)
    return { ok: false, msg: err.message }
  }
}

function getAppIconPath() {
  return path.join(__dirname, '../build/icon.png')
}

function getAppIcon() {
  const iconPath = getAppIconPath()
  if (!fs.existsSync(iconPath)) return undefined
  return nativeImage.createFromPath(iconPath)
}

/** 保留标题栏区域在可见工作区内，避免整窗拖出屏幕 */
function clampWindowPosition(win, x, y) {
  if (!win || win.isDestroyed()) return { x, y }
  const bounds = win.getBounds()
  const display = screen.getDisplayNearestPoint({ x: x + bounds.width / 2, y: y + 16 })
  const { workArea } = display
  const minVisible = 56
  let nx = x
  let ny = y
  if (nx + bounds.width - minVisible < workArea.x) nx = workArea.x - bounds.width + minVisible
  if (nx + minVisible > workArea.x + workArea.width) nx = workArea.x + workArea.width - minVisible
  if (ny < workArea.y) ny = workArea.y
  if (ny + minVisible > workArea.y + workArea.height) ny = workArea.y + workArea.height - minVisible
  return { x: nx, y: ny }
}

const windowDragState = new WeakMap()

function createWindow() {
  const icon = getAppIcon()
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 600,
    backgroundColor: '#14181c',
    frame: false,
    autoHideMenuBar: true,
    ...(icon && !icon.isEmpty() ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  const pushMaximized = () => {
    if (win.isDestroyed()) return
    win.webContents.send('window:maximized-changed', { maximized: win.isMaximized() })
  }
  win.on('maximize', pushMaximized)
  win.on('unmaximize', pushMaximized)

  updater.setMainWindow(win)
  const data = loadData()
  if (data.updateUrl) updater.applyFeedUrl(data.updateUrl)

  loadRenderer(win)
  return win
}

/** 打包版走 dist；开发时 npm run dev 用 Vite，npm run start 优先本地 dist */
function loadRenderer(win) {
  const distIndex = path.join(__dirname, '../dist/index.html')
  const viteUrl = process.env.ELECTRON_DEV_URL || 'http://localhost:5173'
  const useVite = isDev && process.env.ELECTRON_USE_VITE === '1'

  const tryVite = () => {
    win.loadURL(viteUrl)
    win.webContents.once('did-fail-load', (_e, code, _desc, url) => {
      if (String(url || '').includes('5173') || code === -102) {
        console.error(
          '[启动] 无法连接 Vite (5173)。请任选其一：\n' +
            '  · 开发热更新：npm run dev\n' +
            '  · 先构建再启动：npm run build && npm run start'
        )
      }
    })
  }

  if (!isDev) {
    win.loadFile(distIndex)
    return
  }
  if (useVite) {
    tryVite()
    return
  }
  if (fs.existsSync(distIndex)) {
    win.loadFile(distIndex)
    return
  }
  tryVite()
}

app.whenReady().then(() => {
  // 打包版不显示顶部菜单栏（File/Edit/View…）
  if (!isDev) {
    Menu.setApplicationMenu(null)
  }
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.hanschaoyun.tcpserversim')
  }
  const icon = getAppIcon()
  if (icon && !icon.isEmpty() && process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(icon)
  }
  ensureDataFile()
  stopBatchSend()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  for (const id of sessions.keys()) stopServer(id)
  if (process.platform !== 'darwin') app.quit()
})

function getWinFromEvent(event) {
  return BrowserWindow.fromWebContents(event.sender)
}

ipcMain.handle('window:minimize', (event) => {
  getWinFromEvent(event)?.minimize()
  return { ok: true }
})

ipcMain.handle('window:maximizeToggle', (event) => {
  const win = getWinFromEvent(event)
  if (!win) return { ok: false, maximized: false }
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
  return { ok: true, maximized: win.isMaximized() }
})

ipcMain.handle('window:isMaximized', (event) => ({
  maximized: !!getWinFromEvent(event)?.isMaximized()
}))

ipcMain.handle('window:close', (event) => {
  getWinFromEvent(event)?.close()
  return { ok: true }
})

ipcMain.on('window:drag-start', (event, point) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isMaximized()) return
  const [wx, wy] = win.getPosition()
  windowDragState.set(win, {
    startX: point.x,
    startY: point.y,
    originX: wx,
    originY: wy
  })
})

ipcMain.on('window:drag-move', (event, point) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const st = windowDragState.get(win)
  if (!win || !st) return
  const nx = st.originX + (point.x - st.startX)
  const ny = st.originY + (point.y - st.startY)
  const pos = clampWindowPosition(win, nx, ny)
  win.setPosition(Math.round(pos.x), Math.round(pos.y))
})

ipcMain.on('window:drag-end', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win) windowDragState.delete(win)
})

ipcMain.handle('data:load', () => loadData())

ipcMain.handle('data:save', (_e, data) => {
  const result = saveData(data)
  if (result.updateUrl) updater.applyFeedUrl(result.updateUrl)
  else updater.applyFeedUrl('')
  return result
})

ipcMain.handle('update:status', () => ({
  ...updater.getStatus(),
  packaged: !isDev,
  currentVersion: app.getVersion()
}))

ipcMain.handle('update:check', async (_e, updateUrl) => {
  if (isDev) {
    return { ok: false, msg: '开发模式不支持在线更新，请使用打包安装版' }
  }
  const data = loadData()
  const url = updateUrl || data.updateUrl
  if (url && url !== data.updateUrl) {
    saveData({ ...data, updateUrl: url })
  }
  return updater.checkForUpdates(url)
})

ipcMain.handle('update:download', async () => {
  if (isDev) return { ok: false, msg: '开发模式不支持在线更新' }
  return updater.downloadUpdate()
})

ipcMain.handle('update:install', () => {
  if (isDev) return { ok: false, msg: '开发模式不支持在线更新' }
  return updater.quitAndInstall()
})

ipcMain.handle('update:listVersions', async (_e, updateUrl) => {
  // 开发模式也允许拉列表，便于验证回退探测；真正安装仍建议用打包版
  const data = loadData()
  const url = updateUrl || data.updateUrl
  return updater.listVersions(url)
})

ipcMain.handle('update:rollback', async (_e, updateUrl, version) => {
  if (isDev) {
    return { ok: false, msg: '开发模式不支持在线更新，请使用打包安装版' }
  }
  const data = loadData()
  const url = updateUrl || data.updateUrl
  if (url && url !== data.updateUrl) {
    saveData({ ...data, updateUrl: url })
  }
  return updater.rollbackToVersion(url, version)
})

ipcMain.handle('data:configPath', () => getConfigPath())

ipcMain.handle('net:getLocalIp', () => getLocalLanIp())

ipcMain.handle('dialog:selectLogPath', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory']
  })
  if (result.canceled || !result.filePaths[0]) return null
  return result.filePaths[0]
})

ipcMain.handle('dialog:selectCodeFile', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: '文本/码包', extensions: ['txt', 'csv', 'log', 'dat'] },
      { name: '全部文件', extensions: ['*'] }
    ]
  })
  if (result.canceled || !result.filePaths[0]) return null
  try {
    const content = fs.readFileSync(result.filePaths[0], 'utf-8')
    return { path: result.filePaths[0], content }
  } catch (err) {
    return { error: err.message }
  }
})

ipcMain.handle('tcp:startServer', async (_e, serverCfg, logPath) => startServer(serverCfg, logPath))

ipcMain.handle('tcp:stopServer', (_e, id) => {
  stopServer(id)
  return { ok: true }
})

ipcMain.handle('tcp:sendOnce', (_e, serverCfg, logPath, customPayload) =>
  sendOnce(serverCfg, logPath, customPayload)
)

ipcMain.handle('codes:exportFile', (_e, serverCfg, logPath) => {
  const data = loadData()
  const latest = (data.servers || []).find((s) => s.id === serverCfg.id) || serverCfg
  const latest = (data.servers || []).find((s) => s.id === serverCfg.id) || serverCfg
  const merged = {
    ...serverCfg,
    ...latest,
    id: serverCfg.id || latest.id,
    type: latest.type || serverCfg.type || '读码器',
    codeLength: Number(latest.codeLength ?? serverCfg.codeLength) || 20,
    prefix: latest.prefix != null ? latest.prefix : serverCfg.prefix,
    suffix: latest.suffix != null ? latest.suffix : serverCfg.suffix,
    enableId: !!(latest.enableId ?? serverCfg.enableId),
    generateCount: Math.max(1, Number(latest.generateCount ?? serverCfg.generateCount) || 10),
    uidSeq: latest.uidSeq ?? serverCfg.uidSeq,
    uidHead: latest.uidHead || serverCfg.uidHead,
    name: latest.name || serverCfg.name || '读码器',
    enableLog: latest.enableLog !== false
  return exportCodesToFile(merged, logPath || data.logPath)
})

ipcMain.handle('tcp:buildPayload', (_e, serverCfg) => {
  const data = loadData()
  const latest = (data.servers || []).find((s) => s.id === serverCfg.id) || serverCfg
  // 码长度/前缀/类型/启用ID/单次个数等以本地配置为准
  // 码长度/前缀/类型/启用ID/单次个数等以本地配置为准
  const merged = {
    ...serverCfg,
    ...latest,
    id: serverCfg.id || latest.id,
    type: latest.type || serverCfg.type || '读码器',
    codeLength: Number(latest.codeLength ?? serverCfg.codeLength) || 20,
    prefix: latest.prefix != null ? latest.prefix : serverCfg.prefix,
    suffix: latest.suffix != null ? latest.suffix : serverCfg.suffix,
    enableId: !!(latest.enableId ?? serverCfg.enableId),
    sendCount: Number(latest.sendCount ?? serverCfg.sendCount) || 1,
    uidSeq: latest.uidSeq ?? serverCfg.uidSeq,
    uidHead: latest.uidHead || serverCfg.uidHead
  }
  const result = buildPayload(merged)
  persistServerUidState(merged.id, { uidSeq: result.uidSeq, uidHead: result.uidHead })
})

ipcMain.handle('tcp:startCycle', (_e, serverCfg, logPath) => {
  const sess = getSession(serverCfg.id)
  if (sess.timer) clearInterval(sess.timer)
  if (sess.timer) clearInterval(sess.timer)
  const cycle = Math.max(100, Number(serverCfg.cycleMs) || 1000)
  runTimedCycleTick(serverCfg.id, logPath)
  sess.timer = setInterval(() => runTimedCycleTick(serverCfg.id, logPath), cycle)
  return { ok: true }
})

ipcMain.handle('tcp:stopCycle', (_e, id) => {
  const sess = getSession(id)
    clearInterval(sess.timer)
    sess.timer = null
  }
  return { ok: true }
})

function stopBatchSend() {
  batchState.running = false
  if (batchState.batchPumpTimer) {
    clearTimeout(batchState.batchPumpTimer)
    batchState.batchPumpTimer = null
  }
  batchState.batchEventQueue = []
  batchState.batchPlannedFrameCount = 0
  batchState.batchEpoch = 0
  for (const t of batchState.plcStaggerTimers) clearTimeout(t)
  batchState.plcStaggerTimers = []
  for (const t of batchState.readerTimers.values()) clearInterval(t)
  batchState.readerTimers.clear()
}

function isDevicePlanDone(serverCfg) {
  const plan = Number(serverCfg.planCount) || 0
  if (plan <= 0) return false
  return getSession(serverCfg.id).sentCount >= plan
}

function getEnabledServers() {
  return (loadData().servers || []).filter((s) => s.enabled)
}

/** 一键发送参与者：服务端已开启且勾选「一键发码」 */
function getBatchServers() {
  return (loadData().servers || []).filter((s) => s.enabled && s.enableBatch)
}

function deviceCycleMs(serverCfg) {
  return Math.max(100, Number(serverCfg.cycleMs) || 1000)
}

/**
 * 帧周期（有 PLC 时）：以 PLC 配置 cycleMs 的最大值为准，如 PLC 2000ms；
 * 无 PLC 时取全部参与设备最大值。
 */
function computeBatchFrameCycleMs(list, plcs) {
  if (plcs && plcs.length) {
    return Math.max(...plcs.map(deviceCycleMs))
  }
  if (!list.length) return 1000
  return Math.max(...list.map(deviceCycleMs))
}

/** 同一 PLC 帧内读码器发送次数 = floor(帧长 / 读码器 cycleMs) */
function readerSendsInFrame(frameMs, readerCycleMs) {
  if (readerCycleMs <= 0) return 0
  let n = 0
  for (let t = 0; t < frameMs; t += readerCycleMs) n++
  return n
}

function plcStaggerDelayMs(frameMs, plcCount, index) {
  if (plcCount <= 0) return 0
  if (plcCount === 1) return Math.max(0, frameMs - 5)
  const gap = frameMs / (plcCount + 1)
  return Math.round(gap * (index + 1))
}

function batchSendDevice(serverCfg, logPath) {
  if (!batchState.running || isDevicePlanDone(serverCfg)) return
  if (!batchState.running || isDevicePlanDone(serverCfg)) return
  const built = buildPayload(serverCfg)
  const draftCode = String(built.text || '').replace(/(?:\r\n|\n|\r)+$/g, '')
  persistServerUidState(serverCfg.id, {
    uidSeq: built.uidSeq,
    uidHead: built.uidHead,
    draftCode
  })
  notifyDraftUpdated({
    id: serverCfg.id,
    draftCode,
    uidSeq: built.uidSeq,
    uidHead: built.uidHead
  })
  const result = sendOnce(
    logPath,
    built.text
  )
  if (result?.ok && Number(serverCfg.planCount) > 0 && isDevicePlanDone(serverCfg)) {
    notifyBatchDevicePlanDone(serverCfg, logPath)
  }
}

function checkBatchShouldStop(logPath) {
  const enabled = getBatchServers()
  const limited = enabled.filter((s) => Number(s.planCount) > 0)
  const unlimited = enabled.filter((s) => !(Number(s.planCount) > 0))
  if (limited.length && limited.every((s) => isDevicePlanDone(s)) && !unlimited.length) {
    notifyBatchAllPlanDone(logPath, enabled)
    stopBatchSend()
    return true
  }
  const still = enabled.filter((s) => !isDevicePlanDone(s))
  if (!still.length && !unlimited.length) {
    notifyBatchAllPlanDone(logPath, enabled)
    stopBatchSend()
    return true
  }
  return false
}

function enqueueBatchEvent(at, run) {
  batchState.batchEventQueue.push({ at, run })
  batchState.batchEventQueue.sort((a, b) => a.at - b.at)
}

function armBatchEventPump(logPath) {
  if (!batchState.running) return
  const q = batchState.batchEventQueue
  if (!q.length) return
  if (batchState.batchPumpTimer) {
    clearTimeout(batchState.batchPumpTimer)
    batchState.batchPumpTimer = null
  }
  const wait = Math.max(0, q[0].at - Date.now())
  batchState.batchPumpTimer = setTimeout(() => {
    batchState.batchPumpTimer = null
    if (!batchState.running) return
    const now = Date.now()
    while (q.length && q[0].at <= now) {
      const ev = q.shift()
      try {
        ev.run()
      } catch (err) {
        console.error('batch event failed:', err)
      }
    }
    ensureBatchFramesPlanned(logPath)
    if (checkBatchShouldStop(logPath)) return
    armBatchEventPump(logPath)
  }, wait)
}

/** 为第 frameIndex 帧排期：读码器按各自 cycleMs；PLC 在帧末（与读码器同一 epoch） */
function planBatchFrame(logPath, frameIndex) {
  const enabled = getBatchServers()
  if (!enabled.length) return

  const plcsAll = enabled.filter((s) => String(s.type || '').trim() === 'PLC')
  batchState.frameCycleMs = computeBatchFrameCycleMs(enabled, plcsAll)
  const frameMs = batchState.frameCycleMs
  const frameStart = batchState.batchEpoch + frameIndex * frameMs
  const pending = enabled.filter((s) => !isDevicePlanDone(s))
  const readers = pending.filter((s) => String(s.type || '').trim() !== 'PLC')
  const plcs = pending.filter((s) => String(s.type || '').trim() === 'PLC')

  for (const s of readers) {
    const cycle = deviceCycleMs(s)
    for (let offset = 0; offset < frameMs; offset += cycle) {
      const at = frameStart + offset
      const serverId = s.id
      enqueueBatchEvent(at, () => {
        const latest = getBatchServers().find((x) => x.id === serverId)
        if (latest) batchSendDevice(latest, logPath)
      })
    }
  }

  if (plcs.length === 1) {
    const at = frameStart + frameMs - BATCH_PLC_END_LEAD_MS
    const serverId = plcs[0].id
    enqueueBatchEvent(at, () => {
      const latest = getBatchServers().find((x) => x.id === serverId)
      if (latest) batchSendDevice(latest, logPath)
    })
  } else if (plcs.length > 1) {
    for (let i = 0; i < plcs.length; i++) {
      const at = frameStart + plcStaggerDelayMs(frameMs, plcs.length, i)
      const serverId = plcs[i].id
      enqueueBatchEvent(at, () => {
        const latest = getBatchServers().find((x) => x.id === serverId)
        if (latest) batchSendDevice(latest, logPath)
      })
    }
  }
}

/** 滚动向前排期，保证队列里始终有未来若干帧 */
function ensureBatchFramesPlanned(logPath) {
  if (!batchState.running) return
  const frameMs = batchState.frameCycleMs
  const targetMs = Date.now() + frameMs * 5
  while (batchState.batchEpoch + batchState.batchPlannedFrameCount * frameMs < targetMs) {
    planBatchFrame(logPath, batchState.batchPlannedFrameCount)
    batchState.batchPlannedFrameCount += 1
  }
  armBatchEventPump(logPath)
}

function startPlcBatchTimeline(logPath) {
  batchState.batchEpoch = Date.now()
  batchState.batchPlannedFrameCount = 0
  batchState.batchEventQueue = []
  ensureBatchFramesPlanned(logPath)
}

/** 无 PLC 时：读码器按各自配置的 cycleMs 独立定时 */
function startReaderOnlyBatchTimers(logPath) {
  const readers = getBatchServers().filter((s) => String(s.type || '').trim() !== 'PLC')
  for (const s of readers) {
    const cycle = deviceCycleMs(s)
    const tick = () => {
      if (!batchState.running) return
      if (checkBatchShouldStop(logPath)) return
      batchSendDevice(s, logPath)
    }
    tick()
    const id = setInterval(tick, cycle)
    batchState.readerTimers.set(s.id, id)
  }
}

ipcMain.handle('tcp:startBatch', (_e, logPath) => {
  if (batchState.running) return { ok: false, msg: '一键发送已在运行' }
  const list = getBatchServers()
  if (!list.length) {
    return { ok: false, msg: '请开启服务端并勾选「一键发码」' }
  }

  for (const s of list) {
    const sess = getSession(s.id)
    if (sess.timer) {
      clearInterval(sess.timer)
      sess.timer = null
    }
    sess.sentCount = 0
  }

  const log = logPath || loadData().logPath || ''
  const plcs = list.filter((s) => String(s.type || '').trim() === 'PLC')
  batchState.running = true
  batchState.logPath = log
  batchState.frameCycleMs = computeBatchFrameCycleMs(list, plcs)

  if (plcs.length) {
    const gap =
      plcs.length > 1 ? Math.round(batchState.frameCycleMs / (plcs.length + 1)) : 0
    const readerHint = list
      .filter((s) => String(s.type || '').trim() !== 'PLC')
      .map(
        (s) =>
          `${s.name || s.id} ${deviceCycleMs(s)}ms×${readerSendsInFrame(batchState.frameCycleMs, deviceCycleMs(s))}`
      )
      .join('，')
    writeLog(
      log,
      true,
      `[一键发送] 已启动：单时间轴 PLC 帧 ${batchState.frameCycleMs}ms；读码器帧内：${readerHint || '无'}${
        plcs.length > 1 ? `；多 PLC 间隔约 ${gap}ms` : ''
      }`
    )
    startPlcBatchTimeline(log)
  } else {
    writeLog(log, true, '[一键发送] 已启动：读码器按各自配置发码周期发送')
    startReaderOnlyBatchTimers(log)
  }
  return { ok: true }
})

ipcMain.handle('tcp:stopBatch', () => {
  const was = batchState.running
  stopBatchSend()
  if (was) writeLog(batchState.logPath || loadData().logPath, true, '[一键发送] 已手动停止')
  return { ok: true }
})

ipcMain.handle('tcp:batchStatus', () => ({
  running: batchState.running
}))

ipcMain.handle('tcp:clearCount', (_e, id) => {
  if (id) {
    getSession(id).sentCount = 0
  } else {
    for (const sess of sessions.values()) sess.sentCount = 0
  }
  return { ok: true }
})

ipcMain.handle('tcp:getStats', () => {
  const map = {}
  for (const [id, sess] of sessions.entries()) {
    map[id] = {
      sentCount: sess.sentCount,
      listening: !!sess.server,
      peers: sess.sockets.size,
      packageRemain: getPackageRemain(id)
    }
  }
  for (const id of codePackages.keys()) {
    if (!map[id]) {
      map[id] = {
        sentCount: 0,
        listening: false,
        peers: 0,
        packageRemain: getPackageRemain(id)
      }
    } else {
      map[id].packageRemain = getPackageRemain(id)
    }
  }
  return map
})

ipcMain.handle('package:import', (_e, serverId, content) => importCodePackage(serverId, content))

ipcMain.handle('package:remain', (_e, serverId) => getPackageRemain(serverId))

ipcMain.handle('package:clear', (_e, serverId) => {
  if (serverId) codePackages.delete(serverId)
  else codePackages.clear()
  return { ok: true }
})

ipcMain.handle('log:write', (_e, logPath, enableLog, line) => {
  writeLog(logPath, enableLog, line)
  return { ok: true }
})

function resolveLogDir(logPath) {
  const dir =
    String(logPath || '').trim() ||
    (typeof loadData().logPath === 'string' ? loadData().logPath : '')
  return dir
}

ipcMain.handle('log:openToday', async (_e, logPath) => {
  const dir = resolveLogDir(logPath)
  if (!dir) return { ok: false, msg: '请先配置日志路径' }
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  } catch (err) {
    return { ok: false, msg: err?.message || String(err) }
  }
  const filePath = path.join(dir, todayLogName())
  if (!fs.existsSync(filePath)) {
    try {
      fs.writeFileSync(filePath, '', 'utf-8')
    } catch (err) {
      return { ok: false, msg: err?.message || String(err) }
    }
  }
  const errMsg = await shell.openPath(filePath)
  if (errMsg) return { ok: false, msg: errMsg }
  return { ok: true, filePath }
})

ipcMain.handle('log:openDir', async (_e, logPath) => {
  const dir = resolveLogDir(logPath)
  if (!dir) return { ok: false, msg: '请先配置日志路径' }
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  } catch (err) {
    return { ok: false, msg: err?.message || String(err) }
  }
  const errMsg = await shell.openPath(dir)
  if (errMsg) return { ok: false, msg: errMsg }
  return { ok: true, dir }
})