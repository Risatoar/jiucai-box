import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { confirmNormalDiscipline } from './discipline-store'

let root = ''

afterEach(async () => {
  delete process.env.TRADE_MASTER_HOME
  if (root) await rm(root, { recursive: true, force: true })
})

describe('confirmNormalDiscipline', () => {
  it('recovers to NORMAL and archives the previous discipline document', async () => {
    root = await mkdtemp(join(tmpdir(), 'discipline-store-'))
    process.env.TRADE_MASTER_HOME = root
    await writeFile(join(root, 'discipline.json'), JSON.stringify({
      schema_version: 1,
      state: 'CAUTION',
      reasons: ['历史警戒原因'],
      latest_recovery_review: { remaining_blockers: ['待复核'], operating_limits: { minimum_cash_buffer: 3060 } }
    }))

    const saved = await confirmNormalDiscipline('用户已复核')

    expect(saved).toMatchObject({
      state: 'NORMAL',
      previous_state: 'CAUTION',
      reasons: ['用户已复核'],
      latest_recovery_review: {
        result: 'recover_to_normal',
        remaining_blockers: [],
        operating_limits: { minimum_cash_buffer: 3060 }
      }
    })
    const history = JSON.parse(await readFile(join(root, String(saved.history_ref)), 'utf8'))
    expect(history).toMatchObject({ state: 'CAUTION', reasons: ['历史警戒原因'] })
  })

  it('does not rewrite an already normal state', async () => {
    root = await mkdtemp(join(tmpdir(), 'discipline-store-'))
    process.env.TRADE_MASTER_HOME = root
    await writeFile(join(root, 'discipline.json'), JSON.stringify({ state: 'NORMAL', updated_at: 'existing' }))

    expect(await confirmNormalDiscipline()).toEqual({ state: 'NORMAL', updated_at: 'existing' })
  })
})
