import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') process.exit(0)
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(projectRoot, 'resources/voc-runtime/VisionOCR.m')
const output = resolve(projectRoot, 'resources/voc-runtime/vision-ocr')
const moduleCache = resolve(tmpdir(), 'jiucai-voc-clang-cache')
mkdirSync(dirname(output), { recursive: true })
mkdirSync(moduleCache, { recursive: true })
execFileSync('xcrun', ['clang', '-fobjc-arc', `-fmodules-cache-path=${moduleCache}`, source, '-framework', 'Foundation', '-framework', 'Vision', '-framework', 'AppKit', '-O2', '-o', output], { stdio: 'inherit' })
chmodSync(output, 0o755)
console.log(`VOC OCR runtime ready: ${output}`)
