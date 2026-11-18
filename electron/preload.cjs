const { contextBridge, ipcRenderer } = require('electron')

function plain(value) {
  if (value == null) return value
  return JSON.parse(JSON.stringify(value))
}

contextBridge.exposeInMainWorld('api', {
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximizeToggle: () => ipcRenderer.invoke('window:maximizeToggle'),
  windowIsMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data) => ipcRenderer.invoke('data:save', plain(data)),
  getConfigPath: () => ipcRenderer.invoke('data:configPath'),
  getLocalIp: () => ipcRenderer.invoke('net:getLocalIp'),
  selectLogPath: () => ipcRenderer.invoke('dialog:selectLogPath'),
  selectCodeFile: () => ipcRenderer.invoke('dialog:selectCodeFile'),
  startServer: (server, logPath) => ipcRenderer.invoke('tcp:startServer', plain(server), plain(logPath)),
  stopServer: (id) => ipcRenderer.invoke('tcp:stopServer', id),
  sendOnce: (server, logPath, customPayload) =>
    ipcRenderer.invoke('tcp:sendOnce', plain(server), plain(logPath), plain(customPayload)),
  buildPayload: (server) => ipcRenderer.invoke('tcp:buildPayload', plain(server)),
  exportCodesFile: (server, logPath) =>
    ipcRenderer.invoke('codes:exportFile', plain(server), plain(logPath)),
  startCycle: (server, logPath) => ipcRenderer.invoke('tcp:startCycle', plain(server), plain(logPath)),
  stopCycle: (id) => ipcRenderer.invoke('tcp:stopCycle', id),
  startBatch: (logPath) => ipcRenderer.invoke('tcp:startBatch', plain(logPath)),
  stopBatch: () => ipcRenderer.invoke('tcp:stopBatch'),
  batchStatus: () => ipcRenderer.invoke('tcp:batchStatus'),
  clearCount: (id) => ipcRenderer.invoke('tcp:clearCount', id),
  getStats: () => ipcRenderer.invoke('tcp:getStats'),
  importPackage: (serverId, content) => ipcRenderer.invoke('package:import', serverId, plain(content)),
  packageRemain: (serverId) => ipcRenderer.invoke('package:remain', serverId),
  clearPackage: (serverId) => ipcRenderer.invoke('package:clear', serverId),
  writeLog: (logPath, enableLog, line) =>
    ipcRenderer.invoke('log:write', plain(logPath), !!enableLog, plain(line)),
  openTodayLog: (logPath) => ipcRenderer.invoke('log:openToday', plain(logPath)),
  openLogDir: (logPath) => ipcRenderer.invoke('log:openDir', plain(logPath)),
  updateStatus: () => ipcRenderer.invoke('update:status'),
  checkUpdate: (updateUrl) => ipcRenderer.invoke('update:check', plain(updateUrl)),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  listUpdateVersions: (updateUrl) => ipcRenderer.invoke('update:listVersions', plain(updateUrl)),
  rollbackUpdate: (updateUrl, version) =>
    ipcRenderer.invoke('update:rollback', plain(updateUrl), plain(version)),
  onUpdateStatus: (handler) => {
    const listener = (_event, payload) => handler(payload)
    ipcRenderer.on('update:status', listener)
    return () => ipcRenderer.removeListener('update:status', listener)
  },
  onDraftUpdated: (handler) => {
    const listener = (_event, payload) => handler(payload)
    ipcRenderer.on('tcp:draftUpdated', listener)
    return () => ipcRenderer.removeListener('tcp:draftUpdated', listener)
  },
  onSendFinished: (handler) => {
    const listener = (_event, payload) => handler(payload)
    ipcRenderer.on('tcp:sendFinished', listener)
    return () => ipcRenderer.removeListener('tcp:sendFinished', listener)
  },
  onWindowMaximizedChanged: (handler) => {
    const listener = (_event, payload) => handler(payload)
    ipcRenderer.on('window:maximized-changed', listener)
    return () => ipcRenderer.removeListener('window:maximized-changed', listener)
  }
})

function setupFramelessDrag() {
  let dragging = false
  window.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return
    if (e.target.closest('[data-no-drag]')) return
    if (!e.target.closest('[data-drag-region]')) return
    e.preventDefault()
    dragging = true
    ipcRenderer.send('window:drag-start', { x: e.screenX, y: e.screenY })
    const onMove = (ev) => {
      if (!dragging) return
      ipcRenderer.send('window:drag-move', { x: ev.screenX, y: ev.screenY })
    }
    const onUp = () => {
      dragging = false
      ipcRenderer.send('window:drag-end')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupFramelessDrag)
} else {
  setupFramelessDrag()
}
