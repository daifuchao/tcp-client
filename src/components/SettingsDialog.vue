<template>
  <el-dialog
    class="settings-dialog"
    :model-value="modelValue"
    title="设置PLC读码器（服务端）"
    width="96%"
    top="3vh"
    destroy-on-close
    :show-close="false"
    :close-on-click-modal="false"
    @close="emit('update:modelValue', false)"
  >
    <template #header="{ close, titleId, titleClass }">
      <div class="dlg-header">
        <div :id="titleId" :class="titleClass" class="dlg-title">
          <img class="dlg-title-logo" src="/icon.png" alt="" width="22" height="22" />
          设置PLC读码器（服务端）
        </div>
        <button type="button" class="dlg-close" aria-label="关闭" @click="close">
          <el-icon :size="16"><Close /></el-icon>
        </button>
      </div>
    </template>
    <el-alert
      v-if="locked"
      class="lock-alert"
      type="warning"
      :closable="false"
      show-icon
      title="运行中：一键发送或定时发码进行中，系统参数与设备管理不可改动、删除，请先停止后再修改"
    />

    <div class="toolbar">
      <div class="toolbar-left">
        <span class="field-label">日志路径</span>
        <el-input
          :model-value="logPath"
          class="path-input"
          placeholder="请选择日志保存目录"
          :disabled="locked"
          @update:model-value="emit('update:logPath', $event)"
        />
        <el-button type="primary" :disabled="locked" @click="pickPath">选择</el-button>
      </div>
      <el-button type="primary" :disabled="locked" @click="addRow">
        <el-icon class="btn-icon"><Plus /></el-icon>
        新增服务端
      </el-button>
    </div>

    <div class="toolbar update-toolbar">
      <div class="toolbar-left update-left">
        <span class="field-label">更新地址</span>
        <el-input
          :model-value="updateUrl"
          class="path-input update-url-input"
          placeholder="https://bnspic.oss-cn-guangzhou.aliyuncs.com/tcp-server-tool/"
          :disabled="locked"
          @update:model-value="emit('update:updateUrl', $event)"
        />
        <el-button type="primary" :disabled="locked" :loading="checking" @click="onCheckUpdate">检查更新</el-button>
        <el-button
          type="primary"
          plain
          :disabled="locked || updateState !== 'available'"
          :loading="downloading"
          @click="onDownloadUpdate"
        >
          下载更新
        </el-button>
        <el-button type="success" :disabled="locked || updateState !== 'downloaded'" @click="onInstallUpdate">
          安装并重启
        </el-button>
        <el-select
          v-model="rollbackVersion"
          class="rollback-select"
          placeholder="回退版本"
          clearable
          filterable
          allow-create
          default-first-option
          :disabled="locked"
          :loading="loadingVersions"
          @visible-change="onRollbackSelectVisible"
        >
          <el-option
            v-for="item in rollbackOptions"
            :key="item.version"
            :label="`v${item.version}`"
            :value="item.version"
          />
        </el-select>
        <el-button
          type="warning"
          plain
          :disabled="locked || !rollbackVersion"
          :loading="rollingBack"
          @click="onRollback"
        >
          回退并安装
        </el-button>
      </div>
      <div class="update-meta">
        <span>当前 v{{ currentVersion || '-' }}</span>
        <span v-if="updateProgress > 0 && updateState === 'downloading'">{{ updateProgress }}%</span>
        <span class="update-msg" :title="updateError || updateMessage">{{ updateMessage || '未检查' }}</span>
      </div>
    </div>

    <div class="table-shell">
      <el-table :data="localServers" border height="560" style="width: 100%" class="settings-table">
        <el-table-column label="开启" width="70" align="center">
          <template #default="{ row }">
            <el-switch v-model="row.enabled" :disabled="locked" />
          </template>
        </el-table-column>
        <el-table-column label="一键发码" width="90" align="center">
          <template #default="{ row }">
            <el-switch v-model="row.enableBatch" :disabled="locked" />
          </template>
        </el-table-column>
        <el-table-column label="启用ID" width="80" align="center">
          <template #default="{ row }">
            <el-switch v-model="row.enableId" :disabled="locked" />
          </template>
        </el-table-column>
        <el-table-column label="启用导入码" width="100" align="center">
          <template #default="{ row }">
            <el-switch v-model="row.enableImport" :disabled="locked" />
          </template>
        </el-table-column>
        <el-table-column label="输出日志" width="90" align="center">
          <template #default="{ row }">
            <el-switch v-model="row.enableLog" :disabled="locked" />
          </template>
        </el-table-column>
        <el-table-column label="类型" width="110" align="center">
          <template #default="{ row }">
            <el-select v-model="row.type" class="compact-input" :disabled="locked">
              <el-option label="PLC" value="PLC" />
              <el-option label="读码器" value="读码器" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="名称" min-width="120">
          <template #default="{ row }">
            <el-input v-model="row.name" class="compact-input" :disabled="locked" />
          </template>
        </el-table-column>
        <el-table-column label="监听IP" min-width="130">
          <template #default="{ row }">
            <el-input v-model="row.ip" class="compact-input" :disabled="locked" />
          </template>
        </el-table-column>
        <el-table-column label="端口" width="100" align="center">
          <template #default="{ row }">
            <el-input-number
              v-model="row.port"
              :controls="false"
              :min="1"
              :max="65535"
              class="compact-number"
              :disabled="locked"
            />
          </template>
        </el-table-column>
        <el-table-column label="前缀" min-width="120">
          <template #default="{ row }">
            <el-input v-model="row.prefix" class="compact-input" :disabled="locked" />
          </template>
        </el-table-column>
        <el-table-column label="后缀" min-width="100">
          <template #default="{ row }">
            <el-input v-model="row.suffix" class="compact-input" placeholder="ID前拼接" :disabled="locked" />
          </template>
        </el-table-column>
        <el-table-column label="码长度" width="90" align="center">
          <template #default="{ row }">
            <el-input-number
              v-model="row.codeLength"
              :controls="false"
              :min="1"
              class="compact-number"
              :disabled="locked"
            />
          </template>
        </el-table-column>
        <el-table-column label="单次发码个数" width="110" align="center">
          <template #default="{ row }">
            <el-input-number
              v-model="row.sendCount"
              :controls="false"
              :min="1"
              class="compact-number"
              :disabled="locked"
            />
          </template>
        </el-table-column>
        <el-table-column label="生码数" width="90" align="center">
          <template #default="{ row }">
            <el-input-number
              v-model="row.generateCount"
              :controls="false"
              :min="1"
              class="compact-number"
              :disabled="locked"
            />
          </template>
        </el-table-column>
        <el-table-column label="发码周期(ms)" width="110" align="center">
          <template #default="{ row }">
            <el-input-number
              v-model="row.cycleMs"
              :controls="false"
              :min="100"
              class="compact-number"
              :disabled="locked"
            />
          </template>
        </el-table-column>
        <el-table-column label="计划发码数" width="100" align="center">
          <template #default="{ row }">
            <el-input-number
              v-model="row.planCount"
              :controls="false"
              :min="0"
              class="compact-number"
              :disabled="locked"
            />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="108" align="center" fixed="right">
          <template #default="{ $index }">
            <div class="row-ops">
              <el-button type="primary" circle size="small" :disabled="locked" @click="addRow($index)">
                <el-icon><Plus /></el-icon>
              </el-button>
              <el-button type="danger" circle size="small" :disabled="locked" @click="removeRow($index)">
                <el-icon><Minus /></el-icon>
              </el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">{{ locked ? '关闭' : '取消' }}</el-button>
      <el-button type="primary" :disabled="locked" @click="onSave">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

const props = defineProps({
  modelValue: Boolean,
  servers: { type: Array, default: () => [] },
  logPath: { type: String, default: '' },
  updateUrl: { type: String, default: '' },
  /** 一键发送 / 定时发码运行中：系统参数与设备表只读 */
  locked: { type: Boolean, default: false }
})

const emit = defineEmits([
  'update:modelValue',
  'update:servers',
  'update:logPath',
  'update:updateUrl',
  'saved'
])

const localServers = ref([])
const localIp = ref('192.168.0.1')
const checking = ref(false)
const downloading = ref(false)
const rollingBack = ref(false)
const loadingVersions = ref(false)
const rollbackVersion = ref('')
const rollbackOptions = ref([])
const currentVersion = ref('')
const updateState = ref('idle')
const updateMessage = ref('')
const updateError = ref('')
const updateProgress = ref(0)
let offUpdateStatus = null
let versionsLoaded = false

function applyUpdateStatus(status) {
  if (!status) return
  if (status.currentVersion) currentVersion.value = status.currentVersion
  if (status.state) updateState.value = status.state
  if (typeof status.message === 'string') updateMessage.value = status.message
  if (typeof status.error === 'string') updateError.value = status.error
  if (typeof status.progress === 'number') updateProgress.value = status.progress
  downloading.value = status.state === 'downloading'
}

watch(
  () => props.modelValue,
  async (open) => {
    if (open) {
      localIp.value = (await window.api.getLocalIp()) || '192.168.0.1'
      localServers.value = props.servers.map((s) => ({
        draftCode: '',
        generateCount: 10,
        ...s,
        generateCount: Math.max(1, Number(s.generateCount) || 10)
      }))
      const status = await window.api.updateStatus?.()
      applyUpdateStatus(status)
      versionsLoaded = false
      rollbackVersion.value = ''
      rollbackOptions.value = []
      // 预拉列表，避免下拉时才发现 OSS 无 versions.json
      loadRollbackVersions(true)
    }
  }
)

onMounted(() => {
  offUpdateStatus = window.api.onUpdateStatus?.((payload) => applyUpdateStatus(payload)) || null
})

onUnmounted(() => {
  if (typeof offUpdateStatus === 'function') offUpdateStatus()
})

function uid() {
  return `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
}

function createRow() {
  return {
    id: uid(),
    enabled: false,
    enableBatch: false,
    timedSend: false,
    enableId: false,
    enableImport: false,
    enableLog: true,
    type: '读码器',
    name: `服务端${localServers.value.length + 1}`,
    ip: localIp.value,
    port: 2000,
    prefix: '',
    suffix: '',
    codeLength: 20,
    sendCount: 1,
    generateCount: 10,
    cycleMs: 1000,
    planCount: 0,
    uidSeq: 1,
    uidHead: '',
    draftCode: ''
  }
}

function warnLocked() {
  ElMessage.warning('运行中不可改动系统参数或设备，请先停止一键发送/定时发码')
}

/** 在当前行下方插入；无 index 时追加到末尾 */
function addRow(afterIndex) {
  if (props.locked) {
    warnLocked()
    return
  }
  const row = createRow()
  if (Number.isInteger(afterIndex) && afterIndex >= 0) {
    localServers.value.splice(afterIndex + 1, 0, row)
  } else {
    localServers.value.push(row)
  }
}

function removeRow(index) {
  if (props.locked) {
    warnLocked()
    return
  }
  if (localServers.value.length <= 1) {
    ElMessage.warning('至少保留一条配置')
    return
  }
  localServers.value.splice(index, 1)
}

async function pickPath() {
  if (props.locked) {
    warnLocked()
    return
  }
  const p = await window.api.selectLogPath()
  if (p) emit('update:logPath', p)
}

async function onCheckUpdate() {
  if (props.locked) {
    warnLocked()
    return
  }
  checking.value = true
  try {
    const res = await window.api.checkUpdate(props.updateUrl)
    if (!res?.ok) {
      ElMessage.warning(res?.msg || '检查更新失败')
      return
    }
    if (res.status) applyUpdateStatus(res.status)
    else ElMessage.success('已发起检查')
  } finally {
    checking.value = false
  }
}

async function onDownloadUpdate() {
  if (props.locked) {
    warnLocked()
    return
  }
  downloading.value = true
  try {
    const res = await window.api.downloadUpdate()
    if (!res?.ok) ElMessage.warning(res?.msg || '下载失败')
  } finally {
    downloading.value = false
  }
}

async function onInstallUpdate() {
  if (props.locked) {
    warnLocked()
    return
  }
  try {
    await ElMessageBox.confirm('将安装新版本并重启应用，是否继续？', '安装更新', {
      type: 'warning',
      confirmButtonText: '安装并重启',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }
  const res = await window.api.installUpdate()
  if (!res?.ok) ElMessage.warning(res?.msg || '安装失败')
}

async function loadRollbackVersions(force = false) {
  if (loadingVersions.value) return
  if (versionsLoaded && !force) return
  loadingVersions.value = true
  try {
    const res = await window.api.listUpdateVersions?.(props.updateUrl)
    if (!res?.ok) {
      if (force) ElMessage.warning(res?.msg || '读取可回退版本失败')
      return
    }
    rollbackOptions.value = Array.isArray(res.rollbackVersions) ? res.rollbackVersions : []
    versionsLoaded = true
    if (!force) return
    if (rollbackOptions.value.length === 0) {
      ElMessage.info(res.hint || '暂无可回退版本，也可手动输入 x.y.z')
    } else {
      ElMessage.success(`可回退 ${rollbackOptions.value.length} 个版本`)
    }
  } finally {
    loadingVersions.value = false
  }
}

function onRollbackSelectVisible(open) {
  if (open) loadRollbackVersions(true)
}

async function onRollback() {
  if (props.locked) {
    warnLocked()
    return
  }
  const version = String(rollbackVersion.value || '').trim()
  if (!version) {
    ElMessage.warning('请先选择或输入要回退的版本')
    return
  }
  try {
    await ElMessageBox.confirm(
      `将下载并安装 v${version}（低于当前 v${currentVersion.value || '-'}），应用会退出并由安装程序接管，是否继续？`,
      '版本回退',
      {
        type: 'warning',
        confirmButtonText: '回退并安装',
        cancelButtonText: '取消'
      }
    )
  } catch {
    return
  }

  rollingBack.value = true
  try {
    const res = await window.api.rollbackUpdate?.(props.updateUrl, version)
    if (!res?.ok) ElMessage.warning(res?.msg || '回退失败')
  } finally {
    rollingBack.value = false
  }
}

async function onSave() {
  if (props.locked) {
    warnLocked()
    return
  }
  const next = localServers.value.map((s) => ({ ...s }))
  // 设置里点保存时，先由主界面写入本地配置文件
  emit('update:servers', next)
  emit('saved', {
    servers: next,
    logPath: props.logPath,
    updateUrl: props.updateUrl
  })
  emit('update:modelValue', false)
}
</script>

<style scoped>
.dlg-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}

.dlg-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  color: var(--text);
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.03em;
}

.dlg-title-logo {
  width: 22px;
  height: 22px;
  border-radius: 5px;
  object-fit: contain;
  flex-shrink: 0;
}

.dlg-close {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: #a8b8c8;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease, transform 0.18s ease;
}

.dlg-close:hover {
  background: rgba(214, 69, 69, 0.2);
  border-color: rgba(214, 69, 69, 0.5);
  color: #ff9a9a;
  transform: scale(1.05);
}

.dlg-close:active {
  transform: scale(0.96);
  background: rgba(214, 69, 69, 0.3);
}

.lock-alert {
  margin-bottom: 12px;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  padding: 12px 14px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: linear-gradient(180deg, rgba(42, 52, 62, 0.7) 0%, rgba(28, 35, 42, 0.8) 100%);
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.field-label {
  color: var(--muted);
  white-space: nowrap;
  font-size: 13px;
}

.path-input {
  width: min(460px, 48vw);
}

.update-toolbar {
  margin-top: -6px;
  flex-wrap: wrap;
}

.update-left {
  flex-wrap: wrap;
}

.update-url-input {
  width: min(520px, 52vw);
}

.rollback-select {
  width: 140px;
}

.update-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
}

.update-msg {
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.btn-icon {
  margin-right: 4px;
}

.table-shell {
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: rgba(16, 20, 24, 0.35);
}

.row-ops {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
</style>
