const { spawn } = require('node:child_process')
const { access, mkdir, readFile, rename, rm, writeFile } = require('node:fs/promises')
const { join } = require('node:path')
const { createServer } = require('node:net')

const projectRoot = join(__dirname, '..')
const appName = '韭菜盒子'
const bundleId = 'com.jiucaibox.desktop.dev'
const sourceBundle = join(projectRoot, 'node_modules/electron/dist/Electron.app')
const runtimeRoot = join(projectRoot, '.electron-dev')
const runtimeBundle = join(runtimeRoot, `${appName}.app`)
const runtimeExecutable = join(runtimeBundle, 'Contents/MacOS', appName)
const runtimeMarker = join(runtimeRoot, 'runtime.json')
const electronVite = join(projectRoot, 'node_modules/electron-vite/bin/electron-vite.js')
const defaultPort = 5173

const exists = async (path) => {
  try { await access(path); return true } catch { return false }
}

const checkPort = (port) => new Promise((resolve) => {
  const server = createServer()
  server.unref()
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE') resolve(false)
    else resolve(true)
  })
  server.once('listening', () => {
    server.close(() => resolve(true))
  })
  server.listen(port, '127.0.0.1')
})

const detectPortConflict = async (command) => {
  if (command !== 'dev') return
  const port = Number(process.env.PORT) || defaultPort
  const available = await checkPort(port)
  if (available) return
  console.warn(`\u26A0\uFE0F  端口 ${port} 已被占用，electron-vite 将自动使用下一个可用端口。`)
  console.warn(`   如需指定端口，请使用：PORT=${port} npm run dev`)
}

const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: 'inherit', ...options })
  child.once('error', reject)
  child.once('exit', (code, signal) => {
    if (signal) reject(new Error(`${command} 被信号 ${signal} 中断`))
    else if (code === 0) resolve()
    else reject(new Error(`${command} 执行失败，退出码 ${code}`))
  })
})

const replacePlistValue = (plist, key, value) => run('/usr/bin/plutil', [
  '-replace', key, '-string', value, plist
])

const prepareMacRuntime = async () => {
  const electronPackage = JSON.parse(await readFile(join(projectRoot, 'node_modules/electron/package.json'), 'utf8'))
  const expectedMarker = JSON.stringify({ appName, electronVersion: electronPackage.version, format: 1 })
  if (await exists(runtimeMarker)) {
    const currentMarker = await readFile(runtimeMarker, 'utf8')
    if (currentMarker === expectedMarker && await exists(runtimeExecutable)) return runtimeExecutable
  }

  if (!await exists(sourceBundle)) throw new Error('未找到 Electron.app，请先执行 npm install')
  await rm(runtimeBundle, { recursive: true, force: true })
  await mkdir(runtimeRoot, { recursive: true })
  await run('/usr/bin/ditto', [sourceBundle, runtimeBundle])

  const plist = join(runtimeBundle, 'Contents/Info.plist')
  const originalExecutable = join(runtimeBundle, 'Contents/MacOS/Electron')
  await rename(originalExecutable, runtimeExecutable)
  await replacePlistValue(plist, 'CFBundleDisplayName', appName)
  await replacePlistValue(plist, 'CFBundleName', appName)
  await replacePlistValue(plist, 'CFBundleExecutable', appName)
  await replacePlistValue(plist, 'CFBundleIdentifier', bundleId)
  await replacePlistValue(plist, 'LSApplicationCategoryType', 'public.app-category.finance')
  await run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', runtimeBundle])
  await writeFile(runtimeMarker, expectedMarker)
  return runtimeExecutable
}

const launch = async () => {
  const command = process.argv[2] || 'dev'
  await detectPortConflict(command)
  if (process.platform !== 'darwin') {
    if (command === 'prepare') return
    await run(process.execPath, [electronVite, command, ...process.argv.slice(3)], { cwd: projectRoot, env: process.env })
    return
  }

  const executable = await prepareMacRuntime()
  if (command === 'prepare') {
    console.log(`macOS 开发运行时已准备：${runtimeBundle}`)
    return
  }
  await run(process.execPath, [electronVite, command, ...process.argv.slice(3)], {
    cwd: projectRoot,
    env: { ...process.env, ELECTRON_EXEC_PATH: executable }
  })
}

launch().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
