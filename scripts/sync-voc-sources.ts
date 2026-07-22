import { ensureVocSources } from '../src/main/voc-store'

const sources = await ensureVocSources()
console.log(JSON.stringify({ synced: sources.map(({ id, displayName, profileUrl, status }) => ({ id, displayName, profileUrl, status })) }, null, 2))
