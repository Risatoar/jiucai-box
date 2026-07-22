export type PaneSide = 'left' | 'right'

export const PANE_LIMITS = {
  left: { min: 196, max: 360 },
  right: { min: 320, max: 620 },
  mainMin: 520
} as const

export const defaultPaneWidth = (side: PaneSide, viewportWidth: number) => {
  if (side === 'left') return viewportWidth <= 1180 ? 214 : 236
  return viewportWidth <= 1180 ? 320 : 360
}

export const clampPaneWidth = (side: PaneSide, requested: number, viewportWidth: number, oppositeWidth: number) => {
  const limits = PANE_LIMITS[side]
  const availableMaximum = Math.max(limits.min, viewportWidth - oppositeWidth - PANE_LIMITS.mainMin)
  return Math.round(Math.min(Math.max(requested, limits.min), Math.min(limits.max, availableMaximum)))
}

export const paneWidthFromPointer = (side: PaneSide, pointerX: number, viewportWidth: number, oppositeWidth: number) => {
  const requested = side === 'left' ? pointerX : viewportWidth - pointerX
  return clampPaneWidth(side, requested, viewportWidth, oppositeWidth)
}
