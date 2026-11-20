<template>
  <div class="app-shell dark">
    <header class="top-bar">
      <div class="title-wrap" data-drag-region @dblclick="onTitleBarDblClick">
        <div class="brand">大族瀚云</div>
        <div class="title-text">
          <div class="title">TCP服务端数据模拟</div>
          <div class="version-line" :title="`版本 ${appVersion} · 打包 ${appBuildTime}`">
            v{{ appVersion }} · {{ appBuildTime }}
          </div>
        </div>
      </div>
      <div class="top-drag-fill" data-drag-region aria-hidden="true" @dblclick="onTitleBarDblClick" />
      <div class="bar-trailing" data-no-drag>
        <div class="actions">
          <el-button type="primary" :plain="batchRunning" @click="onSendAll">
            <el-icon class="btn-icon"><Promotion /></el-icon>
            {{ batchRunning ? '停止发送' : '一键发送' }}
          </el-button>
          <el-button type="primary" plain @click="onClearCounts">清空发码计数</el-button>
          <el-button type="primary" plain @click="onForceReload">
            <el-icon class="btn-icon"><Refresh /></el-icon>
            强制刷新
          </el-button>
          <el-button type="primary" @click="settingsVisible = true">
            <el-icon class="btn-icon"><Setting /></el-icon>
            设置
          </el-button>
        </div>
        <div class="window-controls">
          <el-tooltip content="最小化" placement="bottom" :show-after="300">
            <button type="button" class="win-ctrl" @click="onWinMinimize">
              <el-icon :size="14"><Minus /></el-icon>
            </button>
          </el-tooltip>
          <el-tooltip :content="winChromeTip" placement="bottom" :show-after="300">
            <button type="button" class="win-ctrl" @click="onWinMaximizeToggle">
              <el-icon :size="13">
                <CopyDocument v-if="winZoomed" />
                <FullScreen v-else />
              </el-icon>
            </button>
          </el-tooltip>
          <el-tooltip content="关闭" placement="bottom" :show-after="300">
            <button type="button" class="win-ctrl win-ctrl--close" @click="onWinClose">
              <el-icon :size="14"><Close /></el-icon>
            </button>
          </el-tooltip>
        </div>
      </div>
    </header>

    <main class="main-panel">
      <div class="device-scroll" v-if="activeServers.length">
        <section
          v-for="(row, index) in activeServers"
          :key="row.id"
          class="device-card"
          :style="deviceBeamStyle()"
        >
          <span class="device-beam-orb device-beam-orb--halo" aria-hidden="true" />
          <span class="device-beam-orb" aria-hidden="true" />
          <div class="device-card-inner">
          <div class="device-head">
            <div class="device-meta">
              <span class="meta-item">设备名称：<b>{{ row.name }}</b></span>
              <span class="meta-item">IP：<code>{{ row.ip }}</code></span>
              <span class="meta-item">端口：<code>{{ row.port }}</code></span>
              <span class="meta-item">
                状态：
                <el-tag type="success" size="small" effect="dark">监听中</el-tag>
              </span>
              <span class="meta-item">连接数：{{ statsMap[row.id]?.peers || 0 }}</span>
              <span class="meta-item">已发：{{ statsMap[row.id]?.sentCount || 0 }}</span>
              <span v-if="row.enableImport" class="meta-item">
                码包剩余：{{ statsMap[row.id]?.packageRemain || 0 }}
              </span>
            </div>
            <div class="device-actions">
              <el-button
                type="primary"
                :plain="!row.timedSend"
                :disabled="batchRunning && row.enableBatch"
                @click="onToggleTimed(row)"
              >
                {{ row.timedSend ? '停止定时发码' : '定时发送码' }}
              </el-button>
              <el-button
                v-if="row.enableImport"
                type="primary"
                @click="onImportCode(row)"
              >
                导入码包
              </el-button>
            </div>
          </div>

          <div class="code-split">
            <div class="code-pane">
              <div class="code-pane-head">
                <span class="code-pane-label">发送</span>
              </div>
              <el-input
                v-model="row.draftCode"
                type="textarea"
                :rows="4"
                resize="vertical"
                class="code-box code-box--send"
                placeholder="待发内容（多码英文逗号分隔，发送自动加换行）"
                @change="persist"
              />
            </div>
            <div class="code-pane">
              <div class="code-pane-head">
                <span class="code-pane-label">客户端读值</span>
                <el-button type="primary" link size="small" @click="onClearClientRx(row)">清空</el-button>
              </div>
              <el-input
                :model-value="clientRxMap[row.id] || ''"
                type="textarea"
                :rows="4"
                resize="vertical"
                readonly
                class="code-box code-box--rx"
                placeholder="十六进制文本→UTF-8；不可见/单字节二进制以 Hex 显示"
              />
            </div>
          </div>

          <div class="device-foot">
            <el-button type="primary" @click="onGenerate(row)">生成码</el-button>
            <el-button type="primary" @click="onSendOne(row)">发送</el-button>
            <el-button @click="onClearOne(row)">清零计数</el-button>
            <el-button
              type="success"
              plain
              title="按设置中的生码数导出到日志目录，一行一条码"
              @click="onExportCodes(row)"
            >
              生码导出
            </el-button>
            <el-switch
              v-model="row.enableLog"
              active-text="输出日志"
              @change="persist"
            />
          </div>
          </div>
        </section>
      </div>

      <div v-else class="empty-box">
        暂无已开启的服务端，请到设置中开启设备
      </div>

      <div class="log-bar">
        <div class="log-label">
          <el-icon><FolderOpened /></el-icon>
          <span>日志路径</span>
        </div>
        <el-input
          v-model="logPath"
          class="log-path"
          placeholder="请选择或输入日志目录"
          :disabled="settingsLocked"
          @change="persist"
        />
        <el-button type="primary" :disabled="settingsLocked" @click="chooseLogPath">选择路径</el-button>
        <el-button type="primary" plain :disabled="settingsLocked" @click="onPersistConfig">保存配置</el-button>
        <el-button type="primary" plain @click="onOpenTodayLog">打开今日日志</el-button>
        <el-button type="primary" plain @click="onOpenLogDir">打开日志目录</el-button>
        <el-button
          type="primary"
          plain
          :title="configPath ? configPath : 'config.json'"
          @click="onOpenConfig"
        >
          打开配置
        </el-button>
        <span class="log-bar-grow" aria-hidden="true" />
        <span class="hint">
          日志：{{ todayName }} ·
          <span
            class="hint-config-link"
            role="button"
            tabindex="0"
            :title="
              configPath
                ? `点击用记事本打开（.json 不走系统默认程序）：${configPath}`
                : '点击用记事本打开 config.json'
            "
            @click.stop="onOpenConfig"
            @keydown.enter.prevent="onOpenConfig"
          >
            配置保存在 AppData（升级 .exe 不丢失）
          </span>
        </span>
      </div>
    </main>

    <SettingsDialog
      v-model="settingsVisible"
      :servers="servers"
      :log-path="logPath"
      :update-url="updateUrl"
      :locked="settingsLocked"
      @update:servers="onServersUpdate"
      @update:log-path="onLogPathUpdate"
      @update:update-url="onUpdateUrlUpdate"
      @saved="onSettingsSaved"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import SettingsDialog from './components/SettingsDialog.vue'

const settingsVisible = ref(false)
const servers = ref([])
const logPath = ref('')
const updateUrl = ref('')
const configPath = ref('')
const statsMap = reactive({})
const clientRxMap = reactive({})
const batchRunning = ref(false)
/** 一键发送或定时发码运行中：系统参数 / 设备管理只读，禁止改动删除 */
const settingsLocked = computed(
  () => batchRunning.value || servers.value.some((s) => !!s.timedSend)
)
const winMaximized = ref(false)
const winFullscreen = ref(false)
const winZoomed = computed(() => winMaximized.value || winFullscreen.value)
const winChromeTip = computed(() => (winZoomed.value ? '还原' : '最大化'))
const appVersion = __APP_VERSION__
const appBuildTime = __APP_BUILD_TIME__
let pollTimer = null

function applyWinChromeState(payload) {
  if (typeof payload?.maximized === 'boolean') winMaximized.value = payload.maximized
  if (typeof payload?.fullscreen === 'boolean') winFullscreen.value = payload.fullscreen
}

async function refreshWinChrome() {
  if (typeof window.api?.windowIsMaximized !== 'function') return
  const res = await window.api.windowIsMaximized()
  applyWinChromeState(res || {})
}

function onWinMinimize() {
  window.api?.windowMinimize?.()
}

async function onForceReload() {
  try {
    await ElMessageBox.confirm(
      '将从 AppData 重新加载配置并刷新界面，当前未保存的修改会丢失。',
      '强制刷新',
      { type: 'warning', confirmButtonText: '刷新', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  if (typeof window.api?.forceReload === 'function') {
    await window.api.forceReload()
  } else {
    window.location.reload()
  }
}

async function onWinMaximizeToggle() {
  if (typeof window.api?.windowMaximizeToggle !== 'function') return
  const res = await window.api.windowMaximizeToggle()
  if (res) applyWinChromeState(res)
  else await refreshWinChrome()
}

/** 标题栏双击：最大化 / 还原（与右侧按钮一致） */
async function onTitleBarDblClick(e) {
  e.preventDefault()
  await onWinMaximizeToggle()
}

async function onWinClose() {
  if (typeof window.api?.windowClose !== 'function') return
  try {
    await ElMessageBox.confirm('确定要退出 TCP 服务端数据模拟吗？', '关闭确认', {
      confirmButtonText: '退出',
      cancelButtonText: '取消',
      type: 'warning',
      autofocus: false,
      closeOnClickModal: false
    })
    window.api.windowClose()
  } catch {
    /* 取消 */
  }
}

const todayName = computed(() => {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}.txt`
})

/** 主界面只显示已开启的服务端 */
const activeServers = computed(() => servers.value.filter((s) => s.enabled))

/** 边框光晕：统一周期 + linear，每台错开起点 */
const DEVICE_BEAM_DURATION_S = 24

function deviceBeamStyle() {
  return {
    '--device-beam-duration': `${DEVICE_BEAM_DURATION_S}s`,
    '--device-beam-delay': '0s'
  }
}

function plain(value) {
  return JSON.parse(JSON.stringify(value ?? null))
}

function snapshotServers() {
  return plain(servers.value || [])
}

function normalizeServer(s) {
  return {
    enableLog: true,
    enableBatch: false,
    enableId: false,
    enableImport: false,
    timedSend: false,
    uidSeq: 1,
    uidHead: '',
    draftCode: '',
    ...s,
    timedSend: !!s.timedSend,
    enabled: !!s.enabled,
    enableBatch: !!s.enableBatch,
    enableId: !!s.enableId,
    enableImport: !!s.enableImport,
    uidSeq: Number.isFinite(Number(s.uidSeq)) ? Number(s.uidSeq) : 1,
    uidHead: typeof s.uidHead === 'string' ? s.uidHead : '',
    generateCount: Math.max(1, Number(s.generateCount) || 10)
  }
}

async function applyServerRuntime(row) {
  if (!row.enabled) {
    row.timedSend = false
    await safeInvoke(() => window.api.stopCycle(row.id), null)
    await safeInvoke(() => window.api.stopServer(row.id), null)
    return { ok: true }
  }
  const res = await safeInvoke(() => window.api.startServer(plain(row), logPath.value), null)
  if (!res?.ok) {
    row.enabled = false
    row.timedSend = false
    return res || { ok: false, msg: '开启失败' }
  }
  if (row.timedSend) {
    await safeInvoke(() => window.api.startCycle(plain(row), logPath.value), null)
  } else {
    await safeInvoke(() => window.api.stopCycle(row.id), null)
  }
  return { ok: true }
}

async function safeInvoke(fn, fallback) {
  try {
    return await fn()
  } catch (err) {
    console.warn(err)
    return fallback
  }
}

async function load() {
  const data = (await safeInvoke(() => window.api.loadData(), null)) || { servers: [], logPath: '' }
  configPath.value = data.configPath || ''
  if (!configPath.value && window.api.getConfigPath) {
    configPath.value = (await safeInvoke(() => window.api.getConfigPath(), '')) || ''
  }

  servers.value = (data.servers || data.clients || []).map(normalizeServer)
  logPath.value = data.logPath || ''
  updateUrl.value = data.updateUrl || ''

  // 启动不恢复定时发码；一键发码仅由顶栏「一键发送」启动
  for (const row of servers.value) {
    row.timedSend = false
  }

  // 已开启的服务端仅恢复 TCP 监听
  for (const row of servers.value) {
    if (!window.api.startServer) break
    const res = await applyServerRuntime(row)
    if (row.enabled === false && res?.msg) {
      ElMessage.warning(`${row.name} 自动开启失败: ${res.msg}`)
    }
  }

  await persist()
  await refreshStats()
}

async function persist(showTip = false) {
  const result = await safeInvoke(
    () =>
      window.api.saveData({
        logPath: logPath.value,
        updateUrl: updateUrl.value,
        servers: snapshotServers()
      }),
    null
  )
  if (result?.configPath) configPath.value = result.configPath
  if (showTip) {
    if (result?.ok !== false && result) ElMessage.success('配置已保存到本地')
    else ElMessage.error('保存失败，请重启应用后再试')
  }
  return result
}

function applyDraftUpdated(payload) {
  if (!payload?.id) return
  const row = servers.value.find((s) => s.id === payload.id)
  if (!row) return
  if (payload.draftCode != null) row.draftCode = String(payload.draftCode)
  if (payload.uidSeq != null) row.uidSeq = payload.uidSeq
  if (payload.uidHead != null) row.uidHead = payload.uidHead
}

async function refreshStats() {
  const map =
    (await safeInvoke(() => window.api.getStats?.(), null)) ||
    (await safeInvoke(async () => {
      const counts = await window.api.getCounts?.()
      if (!counts) return {}
      const out = {}
      for (const [id, sentCount] of Object.entries(counts)) {
        out[id] = { sentCount, listening: false, peers: 0 }
      }
      return out
    }, {}))
  Object.keys(statsMap).forEach((k) => delete statsMap[k])
  Object.assign(statsMap, map || {})
  for (const [id, st] of Object.entries(map || {})) {
    if (st && typeof st.clientRx === 'string') clientRxMap[id] = st.clientRx
  }

  const status = await safeInvoke(() => window.api.batchStatus?.(), null)
  if (status && typeof status.running === 'boolean') {
    const was = batchRunning.value
    batchRunning.value = status.running
  }
}

function onSendFinished(payload) {
  if (!payload?.reason) return
  if (payload.mode === 'timed' && payload.reason === 'plan-done') {
    const row = servers.value.find((s) => s.id === payload.id)
    if (row) row.timedSend = false
    ElMessage.success(
      `${payload.name || '服务端'} 定时发码完成：已发 ${payload.sentCount}/${payload.planCount} 条`
    )
  } else if (payload.mode === 'batch' && payload.reason === 'plan-done-device') {
    ElMessage.success(
      `${payload.name} 已达计划发码数（${payload.sentCount}/${payload.planCount}），一键发码继续进行`
    )
  } else if (payload.mode === 'batch' && payload.reason === 'plan-done-all') {
    batchRunning.value = false
    const list = payload.servers || []
    const detail = list.map((s) => `${s.name} ${s.sentCount}/${s.planCount || s.sentCount} 条`).join('；')
    ElMessage.success(detail ? `一键发码完成：${detail}` : '一键发码完成：已达计划发码数')
  }
  refreshStats()
}

function onServersUpdate(list) {
  servers.value = list
}

function onLogPathUpdate(p) {
  logPath.value = p
}

function onUpdateUrlUpdate(url) {
  updateUrl.value = url
}

async function onSettingsSaved(payload) {
  const prevIds = new Set(servers.value.map((s) => s.id))
  if (payload?.servers) servers.value = payload.servers.map(normalizeServer)
  if (payload?.logPath != null) logPath.value = payload.logPath
  if (payload?.updateUrl != null) updateUrl.value = payload.updateUrl

  // 同步开启/关闭监听（与定时发码无关）
  for (const row of servers.value) {
    const res = await applyServerRuntime(row)
    if (row.enabled && !res?.ok) {
      ElMessage.error(`${row.name}: ${res?.msg || '开启失败'}`)
    }
  }
  // 已删除的设备停止服务
  for (const id of prevIds) {
    if (!servers.value.some((s) => s.id === id)) {
      await safeInvoke(() => window.api.stopCycle(id), null)
      await safeInvoke(() => window.api.stopServer(id), null)
    }
  }

  await persist(true)
  await refreshStats()
}

function warnSettingsLocked() {
  ElMessage.warning('运行中不可改动系统参数或设备，请先停止一键发送/定时发码')
}

async function onPersistConfig() {
  if (settingsLocked.value) {
    warnSettingsLocked()
    return
  }
  await persist(true)
}

async function chooseLogPath() {
  if (settingsLocked.value) {
    warnSettingsLocked()
    return
  }
  const p = await window.api.selectLogPath()
  if (p) {
    logPath.value = p
    await persist()
  }
}

async function onOpenTodayLog() {
  if (!logPath.value) {
    ElMessage.warning('请先配置日志路径')
    return
  }
  if (typeof window.api.openTodayLog !== 'function') {
    ElMessage.error('请重新 build 并重启应用后使用（npm run build && npm run start）')
    return
  }
  const res = await window.api.openTodayLog(logPath.value)
  if (!res?.ok) {
    ElMessage.warning(res?.msg || `无法打开 ${todayName.value}`)
    return
  }
  ElMessage.success(`已打开：${res.filePath}`)
}

async function onOpenLogDir() {
  if (!logPath.value) {
    ElMessage.warning('请先配置日志路径')
    return
  }
  if (typeof window.api.openLogDir !== 'function') {
    ElMessage.error('请重新 build 并重启应用后使用（npm run build && npm run start）')
    return
  }
  const res = await window.api.openLogDir(logPath.value)
  if (!res?.ok) ElMessage.warning(res?.msg || '无法打开日志目录')
}

async function onOpenConfig() {
  try {
    if (typeof window.api.openConfigFile !== 'function') {
      ElMessage.warning('请重启应用后使用（preload 已更新）')
      return
    }
    const res = await window.api.openConfigFile()
    if (!res?.ok) {
      ElMessage.warning(res?.msg || '无法打开配置文件')
      return
    }
    ElMessage.success({
      message:
        res.mode === 'notepad'
          ? `已用记事本打开：${res.filePath || configPath.value || 'config.json'}`
          : `已打开：${res.filePath || configPath.value || 'config.json'}`,
      duration: 5000,
      showClose: true
    })
  } catch (err) {
    ElMessage.error(err?.message || String(err))
  }
}

async function onToggleTimed(row) {
  if (batchRunning.value && row.enableBatch) {
    ElMessage.info('该设备正在参与一键发送，请先停止一键发送后再开定时发码')
    return
  }
  if (!row.enabled) {
    ElMessage.warning('请先在设置中开启该服务端')
    return
  }
  row.timedSend = !row.timedSend
  await persist()
  if (row.timedSend) {
    await window.api.startCycle(plain(row), logPath.value)
    ElMessage.success(`${row.name} 已开始定时发码`)
  } else {
    await window.api.stopCycle(row.id)
    ElMessage.info(`${row.name} 已停止定时发码`)
  }
  await refreshStats()
}

async function onExportCodes(row) {
  if (typeof window.api.exportCodesFile !== 'function') {
    ElMessage.error('当前界面未包含生码功能，请 npm run build 后重启，或改用 npm run dev')
    return
  }
  if (!logPath.value) {
    ElMessage.warning('请先配置日志路径（生码文件保存在同目录）')
    return
  }
  const count = Math.max(1, Number(row.generateCount) || 10)
  if (!count) {
    ElMessage.warning('请先在设置里配置该设备的「生码数」')
    return
  }
  const res = await window.api.exportCodesFile(plain(row), logPath.value)
  if (!res?.ok) {
    ElMessage.warning(res?.msg || '生码失败')
    return
  }
  if (res.uidSeq != null) row.uidSeq = res.uidSeq
  if (res.uidHead != null) row.uidHead = res.uidHead
  await persist()
  const outPath = res.filePath || (logPath.value && res.fileName ? `${logPath.value}\\${res.fileName}` : res.fileName)
  ElMessage.success({
    message: `生码导出完成，共 ${res.count ?? count} 条。路径：${outPath || '-'}`,
    duration: 8000,
    showClose: true
  })
}

async function onGenerate(row) {
  const remainBefore = (await safeInvoke(() => window.api.packageRemain(row.id), 0)) || 0
  const result = await window.api.buildPayload(plain(row))
  const text = typeof result === 'string' ? result : result?.text
  row.draftCode = String(text || '').replace(/(?:\r\n|\n|\r)+$/g, '')
  if (result && typeof result === 'object') {
    if (result.uidSeq != null) row.uidSeq = result.uidSeq
    if (result.uidHead != null) row.uidHead = result.uidHead
  }
  await persist()
  await refreshStats()
  const fromPkg = result?.fromPackage || 0
  const remain = result?.packageRemain ?? 0
  if (result?.source === 'plc-prefix') {
    ElMessage.success('PLC：只发送前缀（结尾自动加回车换行）')
  } else if (result?.source === 'package+uid') {
    ElMessage.success(`码包取 ${fromPkg} 行，不足已按规则补齐（码包剩余 ${remain}）`)
  } else if (fromPkg > 0 || result?.source === 'package') {
    ElMessage.success(`已从码包取 ${fromPkg} 行（剩余 ${remain}）`)
  } else if (remainBefore > 0) {
    ElMessage.warning('码包读取异常，请重新导入后再生成')
  } else if (row.enableId) {
    ElMessage.success('已生成：码:01,码:02,码:03...')
  } else {
    ElMessage.success('已生成多个码（英文逗号分隔）')
  }
}

async function onImportCode(row) {
  const file = await window.api.selectCodeFile()
  if (!file) return
  if (file.error) {
    ElMessage.error(file.error)
    return
  }
  // 码包仅内存保存，单码一行；重启不保留
  const res = await window.api.importPackage(row.id, file.content || '')
  await refreshStats()
  ElMessage.success(`已导入码包 ${res?.count || 0} 条（单码一行，取用后删除，重启不保存）`)
}

async function onSendOne(row) {
  if (!row.enabled) {
    ElMessage.warning('服务端未开启')
    return
  }
  const content = row.draftCode
  const result = await window.api.sendOnce(plain(row), logPath.value, content)
  await refreshStats()
  if (result.ok) ElMessage.success(`发送成功（${result.peers || 0} 个连接）`)
  else ElMessage.warning(result.msg || '发送失败')
}

async function onSendAll() {
  if (batchRunning.value) {
    await window.api.stopBatch()
    batchRunning.value = false
    for (const row of servers.value) {
      if (!row.enableBatch || !row.timedSend) continue
      await window.api.stopCycle(row.id)
      row.timedSend = false
    }
    await persist()
    ElMessage.info('已停止一键发送')
    await refreshStats()
    return
  }

  const targets = servers.value.filter((s) => s.enabled && s.enableBatch)
  if (!targets.length) {
    ElMessage.warning('请开启服务端并在设置中勾选「一键发码」')
    return
  }

  const res = await window.api.startBatch(logPath.value)
  if (!res?.ok) {
    ElMessage.error(res?.msg || '启动一键发送失败')
    return
  }
  batchRunning.value = true
  for (const row of targets) {
    if (row.timedSend) await window.api.stopCycle(row.id)
    row.timedSend = false
  }
  await persist()
  ElMessage.success('一键发送：读码器先行；PLC 按周期等间隔发送，达计划数后停止')
  await refreshStats()
}

async function onClearOne(row) {
  await window.api.clearCount(row.id)
  await refreshStats()
}

async function onClearClientRx(row) {
  if (!row?.id) return
  await safeInvoke(() => window.api.clearClientRx?.(row.id), null)
  clientRxMap[row.id] = ''
}

function applyClientRx(payload) {
  if (!payload?.id) return
  if (payload.clientRx != null) clientRxMap[payload.id] = String(payload.clientRx)
}

async function onClearCounts() {
  await window.api.clearCount()
  await refreshStats()
  ElMessage.success('发码计数已清空')
}

let unsubClientRx = null
let unsubDraftUpdated = null
let unsubSendFinished = null
let unsubWinMaximized = null

onMounted(async () => {
  document.documentElement.classList.add('dark')
  await load()
  await refreshWinChrome()
  pollTimer = setInterval(refreshStats, 1000)
  if (window.api.onClientRx) {
    unsubClientRx = window.api.onClientRx((payload) => applyClientRx(payload))
  }
  if (window.api.onDraftUpdated) {
    unsubDraftUpdated = window.api.onDraftUpdated((payload) => applyDraftUpdated(payload))
  }
  if (window.api.onSendFinished) {
    unsubSendFinished = window.api.onSendFinished((payload) => onSendFinished(payload))
  }
  if (window.api.onWindowMaximizedChanged) {
    unsubWinMaximized = window.api.onWindowMaximizedChanged((p) => applyWinChromeState(p))
  }
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
  if (typeof unsubClientRx === 'function') unsubClientRx()
  if (typeof unsubDraftUpdated === 'function') unsubDraftUpdated()
  if (typeof unsubSendFinished === 'function') unsubSendFinished()
  if (typeof unsubWinMaximized === 'function') unsubWinMaximized()
})
</script>

<style scoped>
.app-shell {
  height: 100%;
  width: 100%;
  max-width: 100%;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.top-bar {
  min-width: 0;
  flex-shrink: 0;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding: 0 0 0 20px;
  gap: 12px;
  border-bottom: 1px solid var(--border);
  background: linear-gradient(180deg, rgba(36, 46, 56, 0.96) 0%, rgba(24, 30, 36, 0.96) 100%);
}

[data-drag-region] {
  cursor: move;
  user-select: none;
}

[data-no-drag] {
  cursor: default;
}

.title-wrap {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex-shrink: 0;
}

.title-text {
  min-width: 0;
  flex: 1 1 auto;
}

.top-drag-fill {
  flex: 1 1 auto;
  min-width: 16px;
  align-self: stretch;
}

.bar-trailing {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  flex-shrink: 0;
  height: 100%;
}

.window-controls {
  display: inline-flex;
  align-items: stretch;
  gap: 0;
  flex-shrink: 0;
  height: 56px;
  margin-left: 4px;
  border-left: 1px solid var(--border);
  padding-left: 2px;
}

.window-controls :deep(.el-tooltip__trigger) {
  display: inline-flex;
  height: 100%;
  align-items: center;
}

.win-ctrl {
  width: 44px;
  height: 100%;
  min-height: 40px;
  border: none;
  border-radius: 0;
  background: transparent;
  color: #9eb0c0;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease, color 0.15s ease;
}

.win-ctrl:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #e8eef3;
}

.win-ctrl--close:hover {
  background: #d64545;
  color: #fff;
}

.title {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.04em;
  line-height: 1.2;
}

.version-line {
  margin-top: 4px;
  font-size: 11px;
  color: #7a8794;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

.actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 10px;
  flex-shrink: 0;
}

.btn-icon {
  margin-right: 4px;
}

.brand {
  flex-shrink: 0;
  padding-right: 14px;
  margin-right: 4px;
  border-right: 1px solid var(--border);
  color: var(--brand);
  font-weight: 800;
  font-size: 18px;
  letter-spacing: 0.06em;
  line-height: 1.2;
}

.main-panel {
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  padding: 14px 16px 16px;
  gap: 12px;
}

.device-scroll {
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 4px 4px 8px;
}

.device-card {
  position: relative;
  border-radius: var(--radius);
  margin-bottom: 14px;
  isolation: isolate;
  border: 1px solid rgba(49, 64, 76, 0.42);
  box-shadow: var(--shadow);
  overflow: hidden;
  max-width: 100%;
}

.device-beam-orb {
  position: absolute;
  left: 0;
  top: 0;
  contain: layout style paint;
  width: 24px;
  height: 7px;
  border-radius: 999px;
  background: radial-gradient(
    ellipse 100% 100% at 50% 50%,
    rgba(184, 238, 238, 0.65) 0%,
    rgba(31, 138, 138, 0.28) 55%,
    transparent 100%
  );
  filter: blur(0.8px);
  opacity: 0.65;
  offset-path: inset(0 round var(--radius));
  offset-distance: 0%;
  offset-anchor: center;
  offset-rotate: auto;
  animation: device-beam-orbit var(--device-beam-duration, 24s) linear infinite;
  animation-delay: var(--device-beam-delay, 0s);
  pointer-events: none;
  z-index: 3;
}

.device-beam-orb--halo {
  width: 38px;
  height: 11px;
  filter: blur(3.5px);
  opacity: 0.38;
  background: radial-gradient(
    ellipse 100% 100% at 50% 50%,
    rgba(127, 232, 232, 0.45) 0%,
    rgba(31, 138, 138, 0.12) 60%,
    transparent 100%
  );
  z-index: 2;
}

@keyframes device-beam-orbit {
  to {
    offset-distance: 100%;
  }
}

.device-card-inner {
  position: relative;
  z-index: 1;
  border-radius: inherit;
  padding: 14px 16px 12px;
  background: linear-gradient(180deg, rgba(36, 44, 53, 0.96) 0%, rgba(26, 32, 39, 0.98) 100%);
}

.device-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.device-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
  align-items: center;
  min-height: 32px;
  color: #d5dee8;
  font-size: 13px;
}

.meta-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  line-height: 1.2;
}

.meta-item b {
  font-size: 15px;
}

.meta-item code {
  font-family: Consolas, 'Courier New', monospace;
  color: #9fd8d8;
}

.device-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.code-split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  align-items: stretch;
}

.code-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.code-pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.code-pane-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  letter-spacing: 0.02em;
}

.code-box :deep(.el-textarea__inner) {
  border-radius: 6px;
  min-height: 96px;
  font-family: Consolas, 'Courier New', monospace;
  box-shadow: none !important;
}

.code-box--send :deep(.el-textarea__inner) {
  background: #f7f8fa !important;
  color: #222 !important;
}

.code-box--rx :deep(.el-textarea__inner) {
  background: #eef6f6 !important;
  color: #1a3d3d !important;
  cursor: default;
}

@media (max-width: 900px) {
  .code-split {
    grid-template-columns: 1fr;
  }
}

.device-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  flex-wrap: wrap;
}

.empty-box {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  background: rgba(0, 0, 0, 0.15);
}

.log-bar {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 12px;
  min-width: 0;
  max-width: 100%;
  padding: 12px 14px;
  background: linear-gradient(180deg, rgba(36, 44, 53, 0.92) 0%, rgba(26, 32, 39, 0.95) 100%);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.22);
}

.log-label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  white-space: nowrap;
  font-size: 13px;
}

.log-path {
  flex: 0 1 auto;
  width: min(320px, 42vw);
  min-width: 120px;
  max-width: 38%;
}

.log-bar-grow {
  flex: 1 1 8px;
  min-width: 0;
}

.hint {
  flex: 0 0 auto;
  margin-left: auto;
  text-align: right;
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hint-config-link {
  position: relative;
  z-index: 2;
  cursor: pointer;
  border-radius: 4px;
  padding: 0 2px;
  text-decoration: underline dotted color-mix(in srgb, var(--muted) 55%, transparent);
  text-underline-offset: 3px;
  transition:
    color 0.18s ease,
    text-decoration-color 0.18s ease,
    background-color 0.18s ease;
}

.hint-config-link:hover {
  color: var(--el-color-primary);
  text-decoration-color: var(--el-color-primary);
  background-color: color-mix(in srgb, var(--el-color-primary) 14%, transparent);
}
</style>
