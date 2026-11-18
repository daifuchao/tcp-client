import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import { copyFileSync, mkdirSync, readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'))
const iconSrc = path.resolve(__dirname, 'build/icon.png')

/** 打包时间（东八区），写入界面版本信息 */
function formatBuildTime() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })
}

/** 以 build/icon.png 为唯一源，同步到 public 供页面 favicon / UI 使用 */
function syncAppIcon() {
  return {
    name: 'sync-app-icon',
    buildStart() {
      const destDir = path.resolve(__dirname, 'public')
      mkdirSync(destDir, { recursive: true })
      copyFileSync(iconSrc, path.join(destDir, 'icon.png'))
    }
  }
}

export default defineConfig({
  plugins: [vue(), syncAppIcon()],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD_TIME__: JSON.stringify(formatBuildTime())
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: 'dist'
  }
})
