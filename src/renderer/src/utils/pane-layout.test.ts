import { describe, expect, it } from 'vitest'
import { clampPaneWidth, defaultPaneWidth, paneWidthFromPointer } from './pane-layout'

describe('pane layout', () => {
  it('converts both dividers into pane widths', () => {
    expect(paneWidthFromPointer('left', 280, 1440, 360)).toBe(280)
    expect(paneWidthFromPointer('right', 1040, 1440, 236)).toBe(400)
  })

  it('keeps the center pane readable while clamping side panes', () => {
    expect(clampPaneWidth('left', 80, 1100, 320)).toBe(196)
    expect(clampPaneWidth('right', 800, 1100, 236)).toBe(344)
  })

  it('uses compact defaults at the minimum desktop width', () => {
    expect(defaultPaneWidth('left', 1100)).toBe(214)
    expect(defaultPaneWidth('right', 1100)).toBe(320)
  })
})
