const { app } = require('electron')
const { autoUpdater } = require('electron-updater')
const fs = require('fs')
const http = require('http')
const https = require('https')
const path = require('path')
const { spawn } = require('child_process')
const { URL } = require('url')

autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true
autoUpdater.allowDowngrade = true
// nsis-web 差量更新；阿里云 OSS 不支持 multipart Range，必须关多段请求
autoUpdater.disableDifferentialDownload = false
autoUpdater.disableWebInstaller = false

/** @type {Electron.BrowserWindow | null} */
let mainWindow = null
let currentUrl = ''
let lastStatus = {
  state: 'idle',
  message: '',
  version: '',
  progress: 0,
  error: ''
}

function emit(payload) {
  lastStatus = { ...lastStatus, ...payload }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update:status', { ...lastStatus })
  }
}

function bindEvents() {
  autoUpdater.removeAllListeners()

  autoUpdater.on('checking-for-update', () => {
    emit({ state: 'checking', message: '正在检查更新…', error: '' })
  })

  autoUpdater.on('update-available', (info) => {
    const current = app.getVersion()
    const remote = info.version || ''
    const downgrade = compareVersion(remote, current) < 0
    emit({
      state: 'available',
      message: downgrade ? `可回退到 ${remote}` : `发现新版本 ${remote}`,
      version: remote,
      error: ''
    })
  })

  autoUpdater.on('update-not-available', (info) => {
    emit({
      state: 'latest',
      message: `已是最新版本（${info.version || '当前'}）`,
      version: info.version || '',
      error: ''
    })
  })

  autoUpdater.on('error', (err) => {
    emit({
      state: 'error',
      message: '更新失败',
      error: err?.message || String(err)
    })
  })

  autoUpdater.on('download-progress', (p) => {
    const percent = Math.round(Number(p.percent) || 0)
    const transferred = Number(p.transferred) || 0
    const total = Number(p.total) || 0
    const deltaHint =
      total > 0 && transferred > 0 && transferred < total * 0.85 ? '（差量）' : ''
    emit({
      state: 'downloading',
      message: `正在下载${deltaHint} ${percent}%`,
      progress: percent,
      error: ''
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    const files = info?.files || []
    const hasWebPackage = files.some((f) => f && (f.url || '').includes('.7z'))
    emit({
      state: 'downloaded',
      message: hasWebPackage
        ? `新版本 ${info.version} 已就绪（web/差量包），可安装重启`
        : `新版本 ${info.version} 已下载，可立即安装重启`,
      version: info.version || '',
      progress: 100,
      error: ''
    })
  })
}

function setMainWindow(win) {
  mainWindow = win
}

function normalizeUpdateUrl(url) {
  return String(url || '')
    .trim()
    .replace(/\/+$/, '')
}

function joinUrl(base, file) {
  const encoded = String(file || '')
    .replace(/^\/+/, '')
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
  return `${normalizeUpdateUrl(base)}/${encoded}`
}

function applyFeedUrl(url) {
  const u = normalizeUpdateUrl(url)
  currentUrl = u
  if (!u) return { ok: false, msg: '请先配置更新下载地址' }
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: u,
    // 单 Range 差量下载；OSS/多数 CDN 对 multipart Range 会失败并回退整包
    useMultipleRangeRequest: false
  })
  return { ok: true, url: u }
}

function getStatus() {
  return {
    ...lastStatus,
    updateUrl: currentUrl,
    currentVersion: app.getVersion(),
    packaged: true
  }
}

function compareVersion(a, b) {
  const pa = String(a || '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0)
  const pb = String(b || '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d
  }
  return 0
}

function requestText(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error('重定向过多'))
      return
    }
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      reject(new Error('无效的更新地址'))
      return
    }
    const lib = parsed.protocol === 'https:' ? https : http
    const req = lib.get(
      url,
      {
        headers: { 'User-Agent': 'tcp-server-sim-updater', Accept: '*/*' }
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = new URL(res.headers.location, url).toString()
          res.resume()
          requestText(next, redirects + 1).then(resolve, reject)
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
        res.on('error', reject)
      }
    )
    req.on('error', reject)
  })
}

function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const doGet = (currentUrl, redirects = 0) => {
      if (redirects > 5) {
        reject(new Error('重定向过多'))
        return
      }
      let parsed
      try {
        parsed = new URL(currentUrl)
      } catch {
        reject(new Error('无效的下载地址'))
        return
      }
      const lib = parsed.protocol === 'https:' ? https : http
      const req = lib.get(
        currentUrl,
        {
          headers: { 'User-Agent': 'tcp-server-sim-updater', Accept: '*/*' }
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const next = new URL(res.headers.location, currentUrl).toString()
            res.resume()
            doGet(next, redirects + 1)
            return
          }
          if (res.statusCode !== 200) {
            res.resume()
            reject(new Error(`下载失败 HTTP ${res.statusCode}`))
            return
          }
          const total = Number(res.headers['content-length']) || 0
          let received = 0
          const out = fs.createWriteStream(destPath)
          res.on('data', (chunk) => {
            received += chunk.length
            if (typeof onProgress === 'function' && total > 0) {
              onProgress(Math.min(99, Math.round((received / total) * 100)))
            }
          })
          res.pipe(out)
          out.on('finish', () => {
            out.close(() => resolve(destPath))
          })
          out.on('error', reject)
          res.on('error', reject)
        }
      )
      req.on('error', reject)
    }
    doGet(url)
  })
}

function parseLatestYml(text) {
  const version = (text.match(/^version:\s*['"]?([^\s'"]+)/m) || [])[1] || ''
  const filePath =
    (text.match(/^path:\s*['"]?(.+?)['"]?\s*$/m) || [])[1] ||
    (text.match(/^\s*-\s*url:\s*['"]?(.+?)['"]?\s*$/m) || [])[1] ||
    ''
  if (!version) return null
  return {
    version,
    path: filePath.trim() || `TCP服务端数据模拟-Setup-${version}.exe`
  }
}

function installerName(version) {
  return `TCP服务端数据模拟-Setup-${version}.exe`
}

function requestHeadOk(url, redirects = 0) {
  return new Promise((resolve) => {
    if (redirects > 5) {
      resolve(false)
      return
    }
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      resolve(false)
      return
    }
    const lib = parsed.protocol === 'https:' ? https : http
    const req = lib.request(
      url,
      {
        method: 'HEAD',
        headers: { 'User-Agent': 'tcp-server-sim-updater', Accept: '*/*' }
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = new URL(res.headers.location, url).toString()
          res.resume()
          requestHeadOk(next, redirects + 1).then(resolve)
          return
        }
        res.resume()
        resolve(res.statusCode === 200)
      }
    )
    req.on('error', () => resolve(false))
    req.end()
  })
}

function buildProbeVersions(currentVersion, known = []) {
  const set = new Set()
  for (const v of known) {
    if (v) set.add(String(v))
  }
  const seeds = [currentVersion, ...known].filter(Boolean)
  for (const ver of seeds) {
    const [maj = 1, min = 0, pat = 0] = String(ver)
      .split('.')
      .map((n) => parseInt(n, 10) || 0)
    for (let m = 0; m <= Math.max(min, 0); m++) {
      const maxPat = m === min ? Math.max(pat + 2, 10) : 20
      for (let p = 0; p <= maxPat; p++) set.add(`${maj}.${m}.${p}`)
    }
  }
  // 常见历史补丁，避免 versions.json 未上传时列表为空
  for (let p = 0; p <= 30; p++) set.add(`1.0.${p}`)
  return [...set]
}

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length)
  let next = 0
  async function run() {
    while (next < items.length) {
      const i = next++
      results[i] = await worker(items[i], i)
    }
  }
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => run())
  await Promise.all(runners)
  return results
}

async function listVersions(updateUrl) {
  const feed = applyFeedUrl(updateUrl || currentUrl)
  if (!feed.ok) return feed

  const currentVersion = app.getVersion()
  const byVersion = new Map()
  let versionsJsonOk = false
  let latestOk = false
  let latestErr = ''

  try {
    const raw = await requestText(joinUrl(feed.url, 'versions.json'))
    const data = JSON.parse(raw)
    const list = Array.isArray(data?.versions) ? data.versions : Array.isArray(data) ? data : []
    for (const item of list) {
      const version = String(item?.version || '').trim()
      if (!version) continue
      byVersion.set(version, {
        version,
        path: item.path && String(item.path).includes('-Setup-') ? item.path : installerName(version),
        size: item.size,
        releaseDate: item.releaseDate || ''
      })
    }
    versionsJsonOk = true
  } catch {
    // versions.json 常未上传，后面用 HEAD 探测 Setup
  }

  try {
    const yml = await requestText(joinUrl(feed.url, 'latest.yml'))
    const latest = parseLatestYml(yml)
    if (latest?.version) {
      byVersion.set(latest.version, {
        version: latest.version,
        // 回退必须用完整 Setup，不能用 WebSetup
        path: installerName(latest.version),
        releaseDate: ''
      })
      latestOk = true
    }
  } catch (err) {
    latestErr = err?.message || String(err)
  }

  const known = [...byVersion.keys()]
  const candidates = buildProbeVersions(currentVersion, known)

  await mapPool(candidates, 8, async (version) => {
    const file = installerName(version)
    const ok = await requestHeadOk(joinUrl(feed.url, file))
    if (!ok) {
      // Setup 不存在则不能回退到该版本
      if (byVersion.has(version)) byVersion.delete(version)
      return
    }
    const prev = byVersion.get(version)
    byVersion.set(version, {
      version,
      path: file,
      size: prev?.size,
      releaseDate: prev?.releaseDate || ''
    })
  })

  if (byVersion.size === 0 && !latestOk) {
    return {
      ok: false,
      msg: latestErr
        ? `无法读取版本列表：${latestErr}`
        : '无法读取版本列表，请检查更新地址与 OSS 文件'
    }
  }

  const versions = [...byVersion.values()].sort((a, b) => compareVersion(b.version, a.version))
  const rollbackVersions = versions.filter((v) => compareVersion(v.version, currentVersion) < 0)

  return {
    ok: true,
    currentVersion,
    versions,
    rollbackVersions,
    versionsJsonOk,
    hint:
      rollbackVersions.length === 0
        ? `当前 v${currentVersion}，服务器上未发现更低版本的完整 Setup（可上传旧 Setup 或 versions.json）`
        : versionsJsonOk
          ? ''
          : `已探测到 ${rollbackVersions.length} 个可回退版本（建议上传 versions.json 加速列表）`
  }
}

async function checkForUpdates(updateUrl) {
  const feed = applyFeedUrl(updateUrl || currentUrl)
  if (!feed.ok) {
    emit({ state: 'error', message: feed.msg, error: feed.msg })
    return feed
  }
  bindEvents()
  try {
    const result = await autoUpdater.checkForUpdates()
    return {
      ok: true,
      updateInfo: result?.updateInfo || null,
      status: getStatus()
    }
  } catch (err) {
    const msg = err?.message || String(err)
    emit({ state: 'error', message: '检查更新失败', error: msg })
    return { ok: false, msg }
  }
}

async function downloadUpdate() {
  if (lastStatus.state !== 'available' && lastStatus.state !== 'error') {
    return { ok: false, msg: '当前没有可下载的更新' }
  }
  try {
    emit({ state: 'downloading', message: '开始下载…', progress: 0, error: '' })
    await autoUpdater.downloadUpdate()
    return { ok: true }
  } catch (err) {
    const msg = err?.message || String(err)
    emit({ state: 'error', message: '下载失败', error: msg })
    return { ok: false, msg }
  }
}

function quitAndInstall() {
  if (lastStatus.state !== 'downloaded') {
    return { ok: false, msg: '请先下载完成再安装' }
  }
  setImmediate(() => {
    autoUpdater.quitAndInstall(false, true)
  })
  return { ok: true }
}

async function rollbackToVersion(updateUrl, targetVersion) {
  const version = String(targetVersion || '').trim()
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    return { ok: false, msg: '版本号格式应为 x.y.z' }
  }

  const currentVersion = app.getVersion()
  if (compareVersion(version, currentVersion) >= 0) {
    return { ok: false, msg: `只能回退到低于当前版本（v${currentVersion}）的版本` }
  }

  const feed = applyFeedUrl(updateUrl || currentUrl)
  if (!feed.ok) {
    emit({ state: 'error', message: feed.msg, error: feed.msg })
    return feed
  }

  let fileName = installerName(version)
  try {
    const listed = await listVersions(feed.url)
    if (listed.ok) {
      const hit = listed.versions.find((v) => v.version === version)
      if (hit?.path) fileName = hit.path
    }
  } catch {
    // ignore, use default file name
  }

  const downloadUrl = joinUrl(feed.url, fileName)
  const destPath = path.join(app.getPath('temp'), fileName)

  try {
    emit({
      state: 'downloading',
      message: `正在下载回退包 ${version}…`,
      version,
      progress: 0,
      error: ''
    })
    await downloadFile(downloadUrl, destPath, (percent) => {
      emit({
        state: 'downloading',
        message: `正在下载回退包 ${version}… ${percent}%`,
        version,
        progress: percent,
        error: ''
      })
    })

    emit({
      state: 'downloaded',
      message: `回退包 ${version} 已就绪，即将安装并重启`,
      version,
      progress: 100,
      error: ''
    })

    setImmediate(() => {
      const child = spawn(destPath, ['--updated'], {
        detached: true,
        stdio: 'ignore'
      })
      child.unref()
      app.quit()
    })

    return { ok: true, version, path: destPath }
  } catch (err) {
    const msg = err?.message || String(err)
    emit({ state: 'error', message: '回退失败', error: msg, version })
    return { ok: false, msg }
  }
}

module.exports = {
  setMainWindow,
  applyFeedUrl,
  getStatus,
  checkForUpdates,
  downloadUpdate,
  quitAndInstall,
  listVersions,
  rollbackToVersion,
  normalizeUpdateUrl,
  compareVersion
}
