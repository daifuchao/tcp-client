/**
 * 生码规则
 *
 * 类型 PLC：只发「前缀」，发送时由主进程统一加 \r\n
 *
 * 类型 读码器：
 *   完整码 = 前缀 + 码体 + [后缀] + [:01/:02...]
 *   后缀：有填则拼在码体后、启用 ID 的 :01 前
 *   码体（码长度读配置）：
 *     - 总长度 > 5：前段(0-9a-zA-Z, 长度-5)固定 + 尾部5位自增
 *     - 总长度 ≤ 5：整段随机，不变尾数
 *   码包优先；启用ID 时拼 :01,:02,:03...
 */

const UID_CHARS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

function clampCodeLength(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.floor(n)
}

function normalizeSeq(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return 1
  return Math.floor(n) % 100000
}

function randomChars(len) {
  const n = Math.max(0, Number(len) || 0)
  let out = ''
  for (let i = 0; i < n; i++) {
    out += UID_CHARS[(Math.random() * UID_CHARS.length) | 0]
  }
  return out
}

/** 仅当码长度 > 5 时需要固定前段 */
function ensureUidHead(head, codeLength) {
  const len = clampCodeLength(codeLength)
  if (len <= 5) return ''
  const need = len - 5
  const cleaned = String(head || '').replace(/[^0-9a-zA-Z]/g, '')
  if (cleaned.length === need) return cleaned
  if (cleaned.length > need) return cleaned.slice(0, need)
  return (cleaned + randomChars(need - cleaned.length)).slice(0, need)
}

function nextSeq(seq) {
  return seq >= 99999 ? 0 : seq + 1
}

function formatTail(seq) {
  return String(normalizeSeq(seq)).padStart(5, '0')
}

function withPrefix(code, prefix) {
  const p = String(prefix || '')
  const c = String(code || '').trim()
  if (!c) return ''
  if (!p) return c
  if (c.startsWith(p)) return c
  return `${p}${c}`
}

function applyPrefix(codes, prefix) {
  return codes.map((c) => withPrefix(c, prefix)).filter(Boolean)
}

function applyCodeSuffix(codes, suffix) {
  const s = String(suffix || '')
  if (!s) return codes
  return codes.map((c) => `${String(c || '').trim()}${s}`)
}

function finalizeCodes(prefixed, { enableId, suffix }) {
  let codes = applyCodeSuffix(prefixed, suffix)
  if (enableId) codes = withIdSuffix(codes)
  return codes
}

/**
 * 码长度 > 5：前段固定 + 尾部5位自增
 * 码长度 ≤ 5：整段随机，不变尾数
 */
function buildUidBodies(serverCfg, count) {
  const codeLength = clampCodeLength(serverCfg.codeLength)
  const n = Math.max(0, Number(count) || 0)
  let seq = normalizeSeq(serverCfg.uidSeq == null ? 1 : serverCfg.uidSeq)
  const bodies = []

  if (codeLength <= 5) {
    for (let i = 0; i < n; i++) {
      bodies.push(randomChars(codeLength))
    }
    return { bodies, uidSeq: seq, uidHead: '' }
  }

  const uidHead = ensureUidHead(serverCfg.uidHead, codeLength)
  for (let i = 0; i < n; i++) {
    bodies.push(`${uidHead}${formatTail(seq)}`)
    seq = nextSeq(seq)
  }

  return { bodies, uidSeq: seq, uidHead }
}

function withIdSuffix(codes) {
  return codes.map((code, i) => `${String(code || '').trim()}:${String(i + 1).padStart(2, '0')}`)
}

function expandSameCode(baseCode, count) {
  const n = Math.max(1, Number(count) || 1)
  const base = String(baseCode || '').trim()
  const list = []
  for (let i = 1; i <= n; i++) {
    list.push(`${base}:${String(i).padStart(2, '0')}`)
  }
  return list
}

function generateCodes(serverCfg, deps = {}) {
  const need = Math.max(1, Number(serverCfg.sendCount) || 1)
  const enableId = serverCfg.enableId === true || serverCfg.enableId === 1 || serverCfg.enableId === 'true'
  const prefix = String(serverCfg.prefix || '')
  const suffix = String(serverCfg.suffix || '')
  const codeLength = clampCodeLength(serverCfg.codeLength)
  const type = String(serverCfg.type || '').trim()
  const getRemain = deps.getPackageRemain || (() => 0)
  const takePkg = deps.takeFromPackage || (() => ({ taken: [], remain: 0 }))

  let uidSeq = normalizeSeq(serverCfg.uidSeq == null ? 1 : serverCfg.uidSeq)
  let uidHead = ensureUidHead(serverCfg.uidHead, codeLength)
  let fromPackage = 0
  let packageRemain = 0
  let source = 'uid'
  let bodies = []
  const cfg = { ...serverCfg, codeLength, uidSeq, uidHead }

  // PLC：只发前缀（发送时再加 \r\n）
  if (type === 'PLC') {
    const text = prefix
    return {
      text,
      codes: text ? [text] : [''],
      uidSeq,
      uidHead,
      fromPackage: 0,
      packageRemain: getRemain(serverCfg.id),
      source: 'plc-prefix'
    }
  }

  const remainBefore = getRemain(serverCfg.id)

  if (remainBefore > 0) {
    const { taken, remain } = takePkg(serverCfg.id, need)
    const lines = taken.map((c) => String(c || '').trim()).filter(Boolean)
    fromPackage = lines.length
    packageRemain = remain
    bodies = lines.slice()

    const lack = need - bodies.length
    if (lack > 0) {
      const built = buildUidBodies(cfg, lack)
      bodies = bodies.concat(built.bodies)
      uidSeq = built.uidSeq
      uidHead = built.uidHead
      source = 'package+uid'
    } else {
      source = 'package'
    }

    const prefixed = applyPrefix(bodies, prefix)
    const codes = finalizeCodes(prefixed, { enableId, suffix })
    return {
      text: codes.join(','),
      codes,
      uidSeq,
      uidHead,
      fromPackage,
      packageRemain,
      source
    }
  }

  if (enableId) {
    const built = buildUidBodies(cfg, need)
    uidSeq = built.uidSeq
    uidHead = built.uidHead
    const prefixed = applyPrefix(built.bodies, prefix)
    const codes = finalizeCodes(prefixed, { enableId: true, suffix })
    return {
      text: codes.join(','),
      codes,
      uidSeq,
      uidHead,
      fromPackage: 0,
      packageRemain: 0,
      source: 'uid'
    }
  }

  const built = buildUidBodies(cfg, need)
  uidSeq = built.uidSeq
  uidHead = built.uidHead
  const codes = finalizeCodes(applyPrefix(built.bodies, prefix), { enableId: false, suffix })
  return {
    text: codes.join(','),
    codes,
    uidSeq,
    uidHead,
    fromPackage: 0,
    packageRemain: 0,
    source: 'uid'
  }
}

/**
 * 批量生码写文件：不消耗码包，按 generateCount 条，一行一条。
 * 导出文件不含 :01/:02（与发送时 enableId 无关），仍带前缀/后缀。
 */
function generateBulkCodes(serverCfg, count) {
  const n = Math.max(1, Math.floor(Number(count) || 1))
  const prefix = String(serverCfg.prefix || '')
  const suffix = String(serverCfg.suffix || '')
  const codeLength = clampCodeLength(serverCfg.codeLength)
  const type = String(serverCfg.type || '').trim()
  let uidSeq = normalizeSeq(serverCfg.uidSeq == null ? 1 : serverCfg.uidSeq)
  const cfg = { ...serverCfg, codeLength, uidSeq, uidHead: ensureUidHead(serverCfg.uidHead, codeLength) }

  if (type === 'PLC') {
    const text = prefix
    const codes = text ? Array.from({ length: n }, () => text) : []
    return { codes, uidSeq, uidHead: cfg.uidHead, source: 'plc-prefix' }
  }

  const built = buildUidBodies(cfg, n)
  uidSeq = built.uidSeq
  const codes = finalizeCodes(applyPrefix(built.bodies, prefix), { enableId: false, suffix })
  return { codes, uidSeq, uidHead: built.uidHead, source: 'uid' }
}

module.exports = {
  UID_CHARS,
  clampCodeLength,
  normalizeSeq,
  ensureUidHead,
  withPrefix,
  applyPrefix,
  buildUidBodies,
  withIdSuffix,
  expandSameCode,
  generateCodes,
  generateBulkCodes
}
