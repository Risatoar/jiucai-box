import type { StrategyDefinition } from '../../../shared/types'

export interface StrategyTransferPayload {
  schemaVersion: 1
  kind: 'jiucai-box-strategy'
  exportedAt: string
  strategy: StrategyDefinition & { gates: string[]; rollback: boolean }
}

export const buildStrategyTransferPayload = (strategy: StrategyDefinition, exportedAt = new Date().toISOString()): StrategyTransferPayload => ({
  schemaVersion: 1,
  kind: 'jiucai-box-strategy',
  exportedAt,
  strategy: { ...strategy, gates: ['data', 'account', 'discipline', 'cost', 'strategy'], rollback: true }
})

export const buildStrategyTransferJson = (strategy: StrategyDefinition, exportedAt?: string): string => JSON.stringify(buildStrategyTransferPayload(strategy, exportedAt), null, 2)

export const strategyExportFilename = (strategy: StrategyDefinition): string => {
  const safeId = strategy.id.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '') || 'strategy'
  return `${safeId}-v${strategy.version.replace(/[^a-zA-Z0-9._-]+/g, '-')}.json`
}
