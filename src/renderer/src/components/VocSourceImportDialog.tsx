import { Braces, Check, Eraser, WandSparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { parseVocSourceTransferJson } from '../../../shared/voc-source-transfer'

interface VocSourceImportDialogProps {
  onClose: () => void
  onImport: (raw: string) => Promise<{ ok: boolean; imported?: number; added?: number; error?: string }>
}

export function VocSourceImportDialog({ onClose, onImport }: VocSourceImportDialogProps) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    editorRef.current?.focus()
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [onClose, saving])
  const validate = () => {
    try { const sources = parseVocSourceTransferJson(value); setError(''); return sources.length }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return 0 }
  }
  const format = () => {
    if (!validate()) return
    try { setValue(JSON.stringify(JSON.parse(value), null, 2)) }
    catch { /* validation already reports syntax errors */ }
  }
  const submit = async () => {
    if (saving || !validate()) return
    setSaving(true)
    const result = await onImport(value).catch((reason) => ({ ok: false, error: reason instanceof Error ? reason.message : String(reason) }))
    setSaving(false)
    if (!result.ok) { setError(result.error || '导入失败'); return }
    onClose()
  }
  return <div className="voc-import-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose() }} role="presentation">
    <section aria-labelledby="voc-import-title" aria-modal="true" className="voc-import-dialog" role="dialog">
      <header><span className="voc-import-icon"><Braces size={19} /></span><div><h2 id="voc-import-title">导入监控账号 JSON</h2><p>把账号配置粘贴到下面，确认无误后再导入。</p></div><button aria-label="关闭" className="icon-button ghost" disabled={saving} onClick={onClose} type="button"><X size={16} /></button></header>
      <div className="voc-import-body">
        <div className="voc-editor-toolbar"><span><Braces size={13} />JSON</span><div><button disabled={!value || saving} onClick={format} type="button"><WandSparkles size={13} />格式化并校验</button><button disabled={!value || saving} onClick={() => { setValue(''); setError(''); editorRef.current?.focus() }} type="button"><Eraser size={13} />清空</button></div></div>
        <textarea aria-label="监控账号 JSON 代码编辑器" onChange={(event) => { setValue(event.target.value); if (error) setError('') }} placeholder={'粘贴 JSON，例如：\n{\n  "schemaVersion": 1,\n  "sources": [ ... ]\n}'} ref={editorRef} spellCheck={false} value={value} />
        <div className="voc-editor-status"><span>{value ? `${value.split('\n').length} 行 · ${value.length} 字符` : '等待粘贴 JSON'}</span>{error && <strong role="alert">{error}</strong>}</div>
      </div>
      <footer><span>导入会更新同 ID 账号并新增账号，不会删除未包含的账号。</span><div><button className="secondary-button" disabled={saving} onClick={onClose} type="button">取消</button><button className="primary-button" disabled={!value.trim() || saving} onClick={() => void submit()} type="button"><Check size={14} />{saving ? '正在导入…' : '校验并导入'}</button></div></footer>
    </section>
  </div>
}
