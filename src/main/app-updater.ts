import { app, autoUpdater } from 'electron'
import type { AppUpdateStatus } from '../shared/types'

let status: AppUpdateStatus = { state: 'idle', currentVersion: app.getVersion(), message: '尚未检查更新' }
let configured = false
const listeners = new Set<(value: AppUpdateStatus) => void>()

const publish = (next: AppUpdateStatus) => {
  status = next
  listeners.forEach((listener) => listener(status))
}

const configure = () => {
  if (configured) return
  configured = true
  autoUpdater.on('checking-for-update', () => publish({ ...status, state: 'checking', message: '正在检查更新…' }))
  autoUpdater.on('update-available', () => publish({ ...status, state: 'available', message: '发现新版本，正在后台下载' }))
  autoUpdater.on('update-not-available', () => publish({ ...status, state: 'up-to-date', message: '已是最新版本' }))
  autoUpdater.on('update-downloaded', (_event, notes, version) => publish({ ...status, state: 'downloaded', availableVersion: version, message: `版本 ${version} 已就绪，重启后完成更新` }))
  autoUpdater.on('error', (error) => publish({ ...status, state: 'error', message: `更新检查失败：${error.message}` }))
}

export const getUpdateStatus = (): AppUpdateStatus => status

export const onUpdateStatus = (listener: (value: AppUpdateStatus) => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const checkForAppUpdates = async (): Promise<AppUpdateStatus> => {
  configure()
  const updateUrl = process.env.JIUCAI_UPDATE_URL
  if (!app.isPackaged || !updateUrl) {
    publish({ ...status, state: 'disabled', message: app.isPackaged ? '尚未配置正式更新地址' : '开发版本不执行自动更新' })
    return status
  }
  autoUpdater.setFeedURL({ url: updateUrl })
  await autoUpdater.checkForUpdates()
  return status
}

export const restartToUpdate = () => {
  if (status.state !== 'downloaded') throw new Error('尚无已下载的更新')
  autoUpdater.quitAndInstall()
}
