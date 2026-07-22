import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const releaseDir = resolve(projectRoot, 'release')
const appPath = resolve(releaseDir, 'mac-arm64', '韭菜盒子.app')

function fail(message) {
  console.error(`\n正式 macOS 打包已终止：${message}`)
  console.error('配置说明：docs/macos-distribution.md\n')
  process.exit(1)
}

function run(command, args, options = {}) {
  console.log(`\n> ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: 'inherit',
    ...options
  })

  if (result.error) fail(`${command} 无法执行：${result.error.message}`)
  if (result.status !== 0) fail(`${command} 执行失败，退出码 ${result.status}`)
}

function capture(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (error) {
    return `${error.stdout ?? ''}${error.stderr ?? ''}`
  }
}

function hasCompleteCredentials(names) {
  return names.every((name) => Boolean(process.env[name]))
}

if (process.platform !== 'darwin') fail('正式 macOS 包必须在 macOS 上构建')

const nodeMajor = Number(process.versions.node.split('.')[0])
if (nodeMajor !== 20) fail(`当前 Node.js 为 ${process.versions.node}，请先执行 nvm use 20`)

const identities = capture('security', ['find-identity', '-v', '-p', 'codesigning'])
if (!identities.includes('Developer ID Application')) {
  fail('钥匙串中没有有效的 Developer ID Application 证书')
}

const appleIdCredentials = [
  'APPLE_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_TEAM_ID'
]
const apiKeyCredentials = ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']
const hasNotaryCredentials =
  hasCompleteCredentials(appleIdCredentials) ||
  hasCompleteCredentials(apiKeyCredentials) ||
  Boolean(process.env.APPLE_KEYCHAIN_PROFILE)

if (!hasNotaryCredentials) {
  fail(
    '缺少 Apple 公证凭据；请配置 Apple ID、App Store Connect API Key，或 APPLE_KEYCHAIN_PROFILE'
  )
}

run('xcrun', ['--find', 'notarytool'])
run('npm', ['run', 'build'])
run('npx', ['electron-builder', '--mac', 'dmg', 'zip', '--arm64'])

if (!existsSync(appPath)) fail(`没有找到应用：${appPath}`)

run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
run('spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath])
run('xcrun', ['stapler', 'validate', appPath])

const dmgs = existsSync(releaseDir)
  ? readdirSync(releaseDir)
      .filter((name) => name.endsWith('.dmg'))
      .map((name) => resolve(releaseDir, name))
  : []

if (dmgs.length === 0) fail('没有生成 DMG 文件')

for (const dmg of dmgs) {
  run('hdiutil', ['verify', dmg])
  run('shasum', ['-a', '256', dmg])
}

console.log('\n正式安装包已完成 Developer ID 签名、Apple 公证和本机验收。')
