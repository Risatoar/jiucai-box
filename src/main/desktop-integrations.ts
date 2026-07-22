import { app, Notification } from 'electron'
import { access, chmod, copyFile, mkdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { DesktopIntegrationStatus } from '../shared/types'

const pluginPath = () => join(homedir(), 'Library/Application Support/SwiftBar/Plugins/韭菜盒子.5m.js')
export const getDesktopStatus = async (): Promise<DesktopIntegrationStatus> => {
  let swiftBarInstalled = false
  try { await access(pluginPath(), constants.X_OK); swiftBarInstalled = true } catch { /* missing */ }
  return { trayAvailable: true, notificationsAvailable: Notification.isSupported(), swiftBarInstalled, swiftBarPluginPath: pluginPath() }
}
export const installSwiftBar = async (): Promise<string> => {
  if (process.platform !== 'darwin') throw new Error('SwiftBar 仅支持 macOS')
  const source = join(app.getAppPath(), 'swiftbar/韭菜盒子.5m.js')
  await mkdir(dirname(pluginPath()), { recursive: true })
  await copyFile(source, pluginPath())
  await chmod(pluginPath(), 0o755)
  return pluginPath()
}
