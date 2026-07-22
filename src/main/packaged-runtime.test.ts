import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('packaged Trade Master runtime', () => {
  it('runs as an isolated ESM resource without inheriting the app package.json', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'jiucai-packaged-runtime-'))
    const runtime = join(fixture, 'trade-master')
    const home = join(fixture, 'facts')
    await cp(resolve('resources/trade-master'), runtime, { recursive: true })
    await rm(join(runtime, 'scripts/dist'), { recursive: true, force: true })

    const build = spawnSync(process.execPath, [join(runtime, 'scripts/build.mjs')], {
      cwd: runtime,
      encoding: 'utf8'
    })
    expect(build.status, build.stderr).toBe(0)

    const result = spawnSync(process.execPath, [join(runtime, 'scripts/dist/cli.js'), 'init'], {
      cwd: tmpdir(),
      env: { ...process.env, TRADE_MASTER_HOME: home },
      encoding: 'utf8'
    })

    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ root: home })
  })
})
