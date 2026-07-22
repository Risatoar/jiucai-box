import { execFile } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { access, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline as streamPipeline } from 'node:stream/promises'
import ffmpegStatic from 'ffmpeg-static'

interface TimedChunk { timestamp?: [number, number]; text?: string }
interface TranscriptOutput { text?: string; chunks?: TimedChunk[] }
export interface VocMediaEvidence {
  transcript?: string
  transcriptSegments?: TimedChunk[]
  transcriptQuality?: 'usable' | 'needs_review' | 'rejected'
  asrModel?: string
  screenText?: string
  status: 'complete' | 'partial' | 'failed'
  error?: string
}
const asrModel = process.env.VOC_ASR_MODEL || 'onnx-community/whisper-large-v3-turbo'
const asrDtype = process.env.VOC_ASR_DTYPE || 'q4'
const modelCacheRoot = () => join(process.env.TRADE_MASTER_HOME || join(homedir(), '.trade-master'), 'voc', 'models')
const browserUserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36'

const run = (binary: string, args: string[], timeoutMs = 180_000) => new Promise<string>((resolve, reject) => {
  execFile(binary, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) reject(new Error(String(stderr || error.message).trim().slice(0, 800)))
    else resolve(stdout.trim())
  })
})

const executableFfmpeg = () => {
  if (!ffmpegStatic) throw new Error('FFmpeg 运行时不可用')
  return ffmpegStatic.replace('app.asar/', 'app.asar.unpacked/')
}

const ocrCandidates = () => [
  join(process.resourcesPath || '', 'voc-runtime', 'vision-ocr'),
  join(process.cwd(), 'resources', 'voc-runtime', 'vision-ocr')
]
const resolveOcr = async () => {
  for (const candidate of ocrCandidates()) {
    try { await access(candidate); return candidate }
    catch { /* try next */ }
  }
  return null
}

const download = async (url: string, path: string, referer?: string) => {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 45_000)
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Referer: referer || new URL(url).origin,
          'User-Agent': browserUserAgent
        }
      })
      if (!response.ok) throw new Error(`视频下载失败：${response.status}`)
      const declared = Number(response.headers.get('content-length') || 0)
      const limit = 60 * 1024 * 1024
      if (declared > limit) throw new Error('视频超过 60MB，已跳过本地识别')
      if (!response.body) throw new Error('视频响应为空')
      let received = 0
      const limiter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          received += chunk.length
          callback(received > limit ? new Error('视频超过 60MB，已停止下载') : null, received > limit ? undefined : chunk)
        }
      })
      await streamPipeline(Readable.fromWeb(response.body as unknown as import('node:stream/web').ReadableStream<Uint8Array>), limiter, createWriteStream(path))
      return
    } catch (error) {
      lastError = error
      await rm(path, { force: true })
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)))
    } finally { clearTimeout(timeout) }
  }
  const curl = process.platform === 'win32' ? 'curl.exe' : '/usr/bin/curl'
  try {
    await access(curl)
    await run(curl, [
      '--location', '--fail', '--silent', '--show-error', '--retry', '2', '--retry-all-errors',
      '--connect-timeout', '20', '--max-time', '120', '--max-filesize', String(60 * 1024 * 1024),
      '--user-agent', browserUserAgent, '--referer', referer || new URL(url).origin, '--output', path, url
    ], 150_000)
    if ((await stat(path)).size > 60 * 1024 * 1024) throw new Error('视频超过 60MB，已停止下载')
    return
  } catch (error) {
    await rm(path, { force: true })
    const fallback = error instanceof Error ? error.message : String(error)
    const primary = lastError instanceof Error ? lastError.message : String(lastError)
    throw new Error(`视频下载失败：${primary}；兼容通道：${fallback}`)
  }
}

export const cleanupVocMediaTemp = async () => {
  const entries = await readdir(tmpdir(), { withFileTypes: true }).catch(() => [])
  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('jiucai-voc-media-'))
    .map((entry) => rm(join(tmpdir(), entry.name), { recursive: true, force: true })))
  const cleanupModelTemps = async (directory: string): Promise<void> => {
    const children = await readdir(directory, { withFileTypes: true }).catch(() => [])
    await Promise.all(children.map(async (entry) => {
      const entryPath = join(directory, entry.name)
      if (entry.isDirectory()) return cleanupModelTemps(entryPath)
      if (entry.name.includes('.tmp.')) await rm(entryPath, { force: true })
    }))
  }
  await cleanupModelTemps(modelCacheRoot())
}

let transcriberPromise: Promise<unknown> | null = null
const getTranscriber = async () => {
  if (!transcriberPromise) transcriberPromise = (async () => {
    const { env, pipeline } = await import('@huggingface/transformers')
    env.cacheDir = modelCacheRoot()
    return pipeline('automatic-speech-recognition', asrModel, { dtype: asrDtype as 'q4' })
  })()
  return transcriberPromise as Promise<(audio: Float32Array, options: Record<string, unknown>) => Promise<TranscriptOutput>>
}

export const assessVocTranscript = (value?: string): NonNullable<VocMediaEvidence['transcriptQuality']> => {
  const text = value?.replace(/\s+/g, '') || ''
  if (text.length < 2 || text.includes('\uFFFD')) return 'rejected'
  if (/(.{1,6})\1{5,}/u.test(text)) return 'needs_review'
  const chunks = text.match(/.{1,4}/g) || []
  const repeated = chunks.length ? 1 - new Set(chunks).size / chunks.length : 0
  return repeated >= 0.45 ? 'needs_review' : 'usable'
}

const transcribe = async (audioPath: string) => {
  const buffer = await readFile(audioPath)
  const view = new Float32Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.byteLength / 4))
  const samples = Float32Array.from(view)
  const transcriber = await getTranscriber()
  return transcriber(samples, { language: 'chinese', task: 'transcribe', return_timestamps: true, chunk_length_s: 30, stride_length_s: 5 })
}

const readFrames = async (directory: string) => {
  const binary = await resolveOcr()
  if (!binary) return ''
  const frames = (await readdir(directory)).filter((name) => name.endsWith('.jpg')).sort()
  const lines: string[] = []
  for (const frame of frames) {
    const output = await run(binary, [join(directory, frame)], 30_000)
    const results = JSON.parse(output) as Array<{ text?: string; confidence?: number }>
    for (const result of results) if ((result.confidence || 0) >= 0.45 && result.text?.trim()) lines.push(result.text.trim())
  }
  return [...new Set(lines)].join('\n')
}

export const readVocMediaEvidence = async (url: string, referer?: string): Promise<VocMediaEvidence> => {
  const directory = await mkdtemp(join(tmpdir(), 'jiucai-voc-media-'))
  const video = join(directory, 'source.mp4')
  const audio = join(directory, 'audio.f32le')
  try {
    await download(url, video, referer)
    const ffmpeg = executableFfmpeg()
    const errors: string[] = []
    let transcript: string | undefined
    let transcriptSegments: TimedChunk[] | undefined
    let transcriptQuality: VocMediaEvidence['transcriptQuality']
    let screenText = ''
    let hasAudio = false
    let hasFrames = false
    try {
      await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-vn', '-ar', '16000', '-ac', '1', '-f', 'f32le', '-c:a', 'pcm_f32le', audio])
      hasAudio = true
    } catch (error) { errors.push(`音频抽取：${error instanceof Error ? error.message : String(error)}`) }
    try {
      await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-vf', 'fps=1/3,scale=1280:-2', '-frames:v', '12', join(directory, 'frame-%03d.jpg')])
      hasFrames = true
    } catch (error) { errors.push(`画面抽取：${error instanceof Error ? error.message : String(error)}`) }
    await rm(video, { force: true })
    if (hasAudio) {
      try {
        const speech = await transcribe(audio)
        transcript = speech.text?.trim()
        transcriptSegments = speech.chunks
        transcriptQuality = assessVocTranscript(transcript)
        if (transcriptQuality === 'rejected') {
          transcript = undefined
          transcriptSegments = undefined
          errors.push('语音识别结果未通过质量检查，已拒绝进入分析')
        }
      } catch (error) { errors.push(`语音识别：${error instanceof Error ? error.message : String(error)}`) }
      finally { await rm(audio, { force: true }) }
    }
    if (hasFrames) {
      try { screenText = await readFrames(directory) }
      catch (error) { errors.push(`画面识别：${error instanceof Error ? error.message : String(error)}`) }
    }
    if (!transcript && !screenText) throw new Error(errors.join('；') || '没有识别到语音或画面文字')
    return {
      transcript, transcriptSegments, transcriptQuality, asrModel, screenText,
      status: transcript && screenText ? 'complete' : 'partial',
      error: errors.length ? errors.join('；') : undefined
    }
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
  } finally { await rm(directory, { recursive: true, force: true }) }
}
