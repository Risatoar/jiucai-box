import { FileText, Image as ImageIcon, X } from 'lucide-react'
import type { ChatAttachment } from '../../../shared/types'

interface AttachmentStripProps { attachments: ChatAttachment[]; onRemove?: (id: string) => void }
const assetUrl = (storageKey: string) => `jiucai-asset://local/${storageKey.split('/').map(encodeURIComponent).join('/')}`
const sizeLabel = (size: number) => size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`

export function AttachmentStrip({ attachments, onRemove }: AttachmentStripProps) {
  if (!attachments.length) return null
  return <div className={onRemove ? 'attachment-strip draft' : 'attachment-strip'}>{attachments.map((attachment) => <div className="attachment-item" key={attachment.id} title={attachment.name}>
    {attachment.kind === 'image' ? <img src={assetUrl(attachment.storageKey)} alt={attachment.name} /> : <span className="attachment-file-icon"><FileText size={16} /></span>}
    <div><strong>{attachment.name}</strong><small>{attachment.kind === 'image' ? <><ImageIcon size={10} />图片</> : '文件'} · {sizeLabel(attachment.size)}</small></div>
    {onRemove && <button title="移除附件" onClick={() => onRemove(attachment.id)} type="button"><X size={13} /></button>}
  </div>)}</div>
}
