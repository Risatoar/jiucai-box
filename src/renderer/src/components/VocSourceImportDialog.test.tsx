import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { VocSourceImportDialog } from './VocSourceImportDialog'

describe('VocSourceImportDialog', () => {
  it('renders an in-app JSON code editor instead of a file picker', () => {
    const html = renderToStaticMarkup(<VocSourceImportDialog onClose={() => undefined} onImport={async () => ({ ok: true })} />)
    expect(html).toContain('导入监控账号 JSON')
    expect(html).toContain('监控账号 JSON 代码编辑器')
    expect(html).toContain('格式化并校验')
    expect(html).toContain('校验并导入')
    expect(html).not.toContain('type="file"')
  })
})
