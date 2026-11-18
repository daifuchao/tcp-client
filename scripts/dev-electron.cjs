process.env.ELECTRON_USE_VITE = '1'
const { spawnSync } = require('child_process')
const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['electron', '.'], {
  stdio: 'inherit',
  shell: true,
  env: process.env,
  cwd: require('path').join(__dirname, '..')
})
process.exit(r.status ?? 1)