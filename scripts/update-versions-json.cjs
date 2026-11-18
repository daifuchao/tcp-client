/**
 * After pack: merge Setup-*.exe in the output dir into versions.json for client rollback lists.
 * Also merges any existing versions.json found in sibling pack dirs (release / release-pack).
 */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const releaseDir = path.resolve(root, process.argv[2] || 'release')
const outFile = path.join(releaseDir, 'versions.json')
const re = /^(.+)-Setup-(\d+\.\d+\.\d+)\.exe$/i

function loadVersionsFile(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    return Array.isArray(raw?.versions) ? raw.versions : []
  } catch {
    return []
  }
}

function compareVersion(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d
  }
  return 0
}

/** 本地时区 ISO（如 2026-11-18T00:27:20+08:00），避免 UTC 日期少一天 */
function formatLocalReleaseDate(date) {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  const z = (n) => String(n).padStart(2, '0')
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const oh = z(Math.floor(Math.abs(off) / 60))
  const om = z(Math.abs(off) % 60)
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}${sign}${oh}:${om}`
}

/** release-pack-20261118 → Date(本地 0点) */
function parsePackDirDate(dirName) {
  const m = String(dirName).match(/(?:^release-pack|^release)-(\d{4})(\d{2})(\d{2})(?:-\d+)?$/)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function releaseDateForSetup(dirName, stat) {
  const mtime = stat.mtime
  const packDay = parsePackDirDate(dirName)
  if (packDay) {
    const local = new Date(
      packDay.getFullYear(),
      packDay.getMonth(),
      packDay.getDate(),
      mtime.getHours(),
      mtime.getMinutes(),
      mtime.getSeconds(),
      mtime.getMilliseconds()
    )
    return formatLocalReleaseDate(local)
  }
  return formatLocalReleaseDate(mtime)
}

function packDirSortKey(dirName) {
  const m = String(dirName).match(/(?:^release-pack|^release)-(\d{8})/)
  return m ? Number(m[1]) : 0
}

function normalizeReleaseDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return formatLocalReleaseDate(d)
}

function shouldReplaceVersionEntry(prev, next) {
  if (!prev) return true
  const ta = Date.parse(prev.releaseDate || '') || 0
  const tb = Date.parse(next.releaseDate || '') || 0
  if (tb !== ta) return tb > ta
  return (next.size || 0) >= (prev.size || 0)
}

function mergeVersionEntry(prev, next) {
  if (shouldReplaceVersionEntry(prev, next)) return { ...next, releaseDate: normalizeReleaseDate(next.releaseDate) }
  return { ...prev, releaseDate: normalizeReleaseDate(prev.releaseDate) }
}

function main() {
  if (!fs.existsSync(releaseDir)) {
    console.error(`${path.relative(root, releaseDir)} not found`)
    process.exit(1)
  }

  const byVersion = new Map()
  const packDirs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter(
      (d) =>
        d.isDirectory() &&
        /^(release|release-pack)(-\d{8}(-\d+)?|-\d+)?$/.test(d.name)
    )
    .map((d) => d.name)
    .sort((a, b) => packDirSortKey(b) - packDirSortKey(a))

  for (const dirName of packDirs) {
    const dir = path.join(root, dirName)
    for (const item of loadVersionsFile(path.join(dir, 'versions.json'))) {
      if (!item?.version || !item?.path) continue
      const prev = byVersion.get(item.version)
      byVersion.set(item.version, mergeVersionEntry(prev, item))
    }
    try {
      for (const name of fs.readdirSync(dir)) {
        const m = name.match(re)
        if (!m) continue
        const version = m[2]
        const full = path.join(dir, name)
        const stat = fs.statSync(full)
        const next = {
          version,
          path: name,
          size: stat.size,
          releaseDate: releaseDateForSetup(dirName, stat)
        }
        const prev = byVersion.get(version)
        byVersion.set(version, mergeVersionEntry(prev, next))
      }
    } catch {
      // ignore unreadable dirs
    }
  }

  const versions = [...byVersion.values()].sort((a, b) => compareVersion(b.version, a.version))
  fs.writeFileSync(outFile, JSON.stringify({ versions }, null, 2) + '\n', 'utf8')
  console.log(
    `versions.json updated in ${path.relative(root, releaseDir)} (${versions.length}): ${versions
      .map((v) => v.version)
      .join(', ')}`
  )
}

main()
