import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createAutomationTask, deleteAutomationTask, installAutomations, preserveCustomAutomations, saveAutomationRun, setAutomationEnabled, updateAutomationTask } from './automation-store'

const previousHome = process.env.TRADE_MASTER_HOME
afterEach(() => { if (previousHome == null) delete process.env.TRADE_MASTER_HOME; else process.env.TRADE_MASTER_HOME = previousHome })

describe('automation-store', () => {
  it('installs, toggles and audits tasks', async () => {
    const home = await mkdtemp(join(tmpdir(), 'jiucai-automation-'))
    process.env.TRADE_MASTER_HOME = home
    await mkdir(join(home, 'automation'), { recursive: true })
    await writeFile(join(home, 'automation/manifest.json'), JSON.stringify({ install_status: 'planned', tasks: [{ id: 'pre_market', mode: 'pre_market' }] }))
    await installAutomations()
    await setAutomationEnabled('pre_market', false)
    await saveAutomationRun({ taskId: 'pre_market', mode: 'pre_market', startedAt: '2026-07-20T08:00:00Z', finishedAt: '2026-07-20T08:01:00Z', status: 'success', summary: '完成' })
    const manifest = JSON.parse(await readFile(join(home, 'automation/manifest.json'), 'utf8'))
    expect(manifest).toMatchObject({ install_status: 'installed', tasks: [{ id: 'pre_market', enabled: false, last_status: 'success' }] })
  })

  it('creates, updates and deletes custom tasks while protecting system defaults', async () => {
    const home = await mkdtemp(join(tmpdir(), 'jiucai-automation-crud-'))
    process.env.TRADE_MASTER_HOME = home
    await mkdir(join(home, 'automation'), { recursive: true })
    await writeFile(join(home, 'automation/manifest.json'), JSON.stringify({ install_status: 'installed', tasks: [{ id: 'pre_market', mode: 'pre_market' }] }))

    const created = await createAutomationTask({
      title: '午间检查', description: '午休前检查持仓风险', prompt: '读取最新持仓，有重要风险时提醒；没有变化返回 NO_REPLY。', enabled: true,
      schedule: { kind: 'cron', times: ['11:25'] }
    })
    expect(created).toMatchObject({ mode: 'custom', system_default: false, title: '午间检查' })

    await updateAutomationTask(created.id, {
      title: '午间风险检查', description: '午休前检查持仓风险', prompt: '读取最新持仓和行情，有重要风险时提醒；没有变化返回 NO_REPLY。', enabled: false,
      schedule: { kind: 'market_window', interval_minutes: 15, windows: ['09:30-11:30'] }
    })
    let manifest = JSON.parse(await readFile(join(home, 'automation/manifest.json'), 'utf8'))
    expect(manifest.tasks.find((task: { id: string }) => task.id === created.id)).toMatchObject({ title: '午间风险检查', enabled: false, schedule: { kind: 'market_window', interval_minutes: 15 } })

    await expect(deleteAutomationTask('pre_market')).rejects.toThrow('系统默认任务不能删除')
    await deleteAutomationTask(created.id)
    manifest = JSON.parse(await readFile(join(home, 'automation/manifest.json'), 'utf8'))
    expect(manifest.tasks.map((task: { id: string }) => task.id)).toEqual(['pre_market'])
  })

  it('keeps custom tasks when restoring the default plan', async () => {
    const home = await mkdtemp(join(tmpdir(), 'jiucai-automation-restore-'))
    process.env.TRADE_MASTER_HOME = home
    const target = join(home, 'automation/manifest.json')
    await mkdir(join(home, 'automation'), { recursive: true })
    await writeFile(target, JSON.stringify({ tasks: [
      { id: 'pre_market', mode: 'pre_market' },
      { id: 'custom-lunch', mode: 'custom', system_default: false, title: '午间检查' }
    ] }))

    await preserveCustomAutomations(() => writeFile(target, JSON.stringify({ tasks: [{ id: 'intraday', mode: 'intraday' }] })))
    const manifest = JSON.parse(await readFile(target, 'utf8'))
    expect(manifest.tasks).toMatchObject([
      { id: 'intraday', system_default: true },
      { id: 'custom-lunch', title: '午间检查' }
    ])
  })
})
