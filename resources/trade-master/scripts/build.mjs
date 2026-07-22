import { chmod, copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsRoot = dirname(fileURLToPath(import.meta.url))
const sourceRoot = join(scriptsRoot, 'src')
const outputRoot = join(scriptsRoot, 'dist')

const sourceFiles = (await readdir(sourceRoot))
  .filter((name) => name.endsWith('.js'))
  .sort()

if (!sourceFiles.includes('cli.js')) {
  throw new Error('Trade Master 源码不完整：缺少 src/cli.js')
}

await rm(outputRoot, { recursive: true, force: true })
await mkdir(outputRoot, { recursive: true })

for (const file of sourceFiles) {
  await copyFile(join(sourceRoot, file), join(outputRoot, file))
}

await chmod(join(outputRoot, 'cli.js'), 0o755)
console.log(`Trade Master 运行时已生成：${sourceFiles.length} 个文件`)
