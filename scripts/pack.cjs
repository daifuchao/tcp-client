/**
 * Full pack flow with Windows file-lock handling for win-unpacked.
 */
const { execSync, spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const exeName = 'TCP服务端数据模拟.exe'

function sleep(ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    /* sync wait */
  }
}

function run(cmd, opts = {}) {
  console.log(`\n> ${cmd}`)
  const r = spawnSync(cmd, {
    cwd: root,
    shell: true,
    stdio: 'inherit',
    env: { ...process.env, ...opts.env }
  })
  if (r.status !== 0) {
    process.exit(r.status || 1)
  }
}

function taskkill(image) {
  try {
    execSync(`taskkill /F /IM "${image}" /T`, {
      stdio: ['ignore', 'ignore', 'ignore'],
      windowsHide: true
    })
    return true
  } catch {
    return false
  }
}

function killLockers(unpackedDir) {
  const killed = []
  if (taskkill(exeName)) killed.push(exeName)
  try {
    const out = execSync(
      'wmic process where "name=\'electron.exe\'" get ProcessId,ExecutablePath /FORMAT:CSV',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }
    )
    const marker = path.normalize(unpackedDir).toLowerCase()
    for (const line of out.split(/\r?\n/)) {
      const parts = line.split(',').map((s) => s.trim())
      if (parts.length < 3) continue
      const exePath = parts[1] || ''
      const pid = Number(parts[2])
      if (pid && exePath.toLowerCase().includes(marker)) {
        try {
          process.kill(pid)
          killed.push(`electron:${pid}`)
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
  return killed
}

function tryCleanUnpacked(outDir) {
  const unpacked = path.join(outDir, 'win-unpacked')
  if (!fs.existsSync(unpacked)) return true

  killLockers(unpacked)
  sleep(500)

  for (let i = 1; i <= 5; i++) {
    try {
      fs.rmSync(unpacked, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
      return true
    } catch {
      killLockers(unpacked)
      sleep(400 * i)
    }
  }

  // Last resort: rename aside (sometimes works when unlink fails)
  try {
    const aside = `${unpacked}.stale.${Date.now()}`
    fs.renameSync(unpacked, aside)
    console.warn(`prepare: 无法删除 win-unpacked，已改名为 ${path.basename(aside)}`)
    setTimeout(() => {
      try {
        fs.rmSync(aside, { recursive: true, force: true })
      } catch {
        // leave stale folder for manual cleanup
      }
    }, 0)
    return true
  } catch {
    return false
  }
}

function packOutputDirName() {
  const d = new Date()
  const ymd = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0')
  ].join('')
  let base = `release-pack-${ymd}`
  let dirName = base
  let n = 2
  while (fs.existsSync(path.join(root, dirName))) {
    dirName = `${base}-${n}`
    n += 1
  }
  return dirName
}

function ensureOutputDir() {
  const stamped = path.join(root, packOutputDirName())
  fs.mkdirSync(stamped, { recursive: true })

  // 若旧 release / release-pack 未上锁，顺带尝试清 win-unpacked，减少残留进程占用
  for (const dirName of ['release', 'release-pack']) {
    const d = path.join(root, dirName)
    if (fs.existsSync(d)) tryCleanUnpacked(d)
  }

  return stamped
}

function main() {
  const outDir = ensureOutputDir()
  const relOut = path.relative(root, outDir).replace(/\\/g, '/')
  console.log(`pack output: ${relOut}/`)

  run('npm version patch --no-git-tag-version')
  run('vite build')
  // nsis = 离线完整安装包；nsis-web = 在线差量更新
  run(
    `electron-builder --win nsis nsis-web --x64 --config.directories.output=${JSON.stringify(relOut)}`
  )
  promoteWebUpdateArtifacts(outDir)
  run(`node scripts/update-versions-json.cjs ${JSON.stringify(relOut)}`)

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const latestYml = path.join(outDir, 'latest.yml')
  if (fs.existsSync(latestYml) && /packages:/m.test(fs.readFileSync(latestYml, 'utf8'))) {
    console.log('latest.yml 已切换为 nsis-web 差量清单（含 packages）')
  } else {
    console.warn('警告: latest.yml 缺少 packages，在线差量可能不可用')
  }
  console.log(`\n打包完成 v${pkg.version} → ${relOut}/`)
  console.log('离线分发: *-Setup-*.exe')
  console.log('在线更新上传: latest.yml + *-WebSetup-*.exe + *.nsis.7z (+ versions.json / 旧 Setup、旧 7z)')
}

/** Copy nsis-web feed files to output root so OSS can keep a flat update URL. */
function promoteWebUpdateArtifacts(outDir) {
  const webDir = path.join(outDir, 'nsis-web')
  if (!fs.existsSync(webDir)) {
    console.warn('prepare: 未找到 nsis-web 产物目录')
    return
  }
  for (const name of fs.readdirSync(webDir)) {
    if (name.startsWith('__')) continue
    fs.copyFileSync(path.join(webDir, name), path.join(outDir, name))
  }
  console.log('已将 nsis-web 的 latest.yml / WebSetup / .7z 提升到输出根目录')
}

main()
