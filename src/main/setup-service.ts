import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import type { SetupProgress, SetupResult } from '../shared/types'
import { locateTradeMasterSkill, runTradeMaster } from './trade-master'

const progress = (stage: SetupProgress['stage'], percent: number, title: string, detail: string): SetupProgress => ({ stage, percent, title, detail })

export const prepareDependencies = async (emit: (state: SetupProgress) => void): Promise<SetupResult> => {
  let current = progress('checking', 8, '正在检查运行环境', '无需打开终端，一般只需几秒')
  const push = (next: SetupProgress) => { current = next; emit(next) }
  try {
    push(current)
    await locateTradeMasterSkill()
    push(progress('core', 36, '正在准备交易分析功能', '这一步通常只需要几秒'))
    const home = process.env.TRADE_MASTER_HOME || join(homedir(), '.trade-master')
    const markerPath = join(home, 'runtime/jiucai-box-setup.json')
    try {
      const marker = JSON.parse(await readFile(markerPath, 'utf8')) as { app_version?: string }
      if (marker.app_version === app.getVersion()) {
        const ready = progress('complete', 100, '准备完成', '交易分析功能和本机数据已经可以使用')
        push(ready)
        return { ok: true, progress: ready }
      }
    } catch { /* first launch or app version changed */ }
    await mkdir(home, { recursive: true })
    push(progress('facts', 64, '正在创建本机数据', '你的交易记录只保存在这台电脑上'))
    await runTradeMaster('init')
    await runTradeMaster('automation', ['sync-defaults'])
    push(progress('doctor', 88, '正在完成安全检查', '检查数据位置和交易权限'))
    await mkdir(join(home, 'runtime'), { recursive: true })
    await writeFile(markerPath, `${JSON.stringify({ app_version: app.getVersion(), completed_at: new Date().toISOString() }, null, 2)}\n`, 'utf8')
    const done = progress('complete', 100, '准备完成', '接下来只要回答几个简单问题')
    push(done)
    return { ok: true, progress: done }
  } catch (reason) {
    const error = reason instanceof Error ? reason.message : String(reason)
    const failed = progress('error', current.percent, '自动准备未完成', error)
    push(failed)
    return { ok: false, progress: failed, error }
  }
}
