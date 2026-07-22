import type { AppView } from '../../../shared/types'

export const shouldLoadMarketBars = (bridgeAvailable: boolean, selectedCode: string | undefined, view: AppView) => (
  bridgeAvailable && Boolean(selectedCode) && view !== 'settings'
)
