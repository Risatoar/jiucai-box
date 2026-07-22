import { useEffect, useState } from 'react'

const STORAGE_KEY = 'jiucai.onboarding.automations'
type PromptState = 'pending' | 'enabled' | 'dismissed' | null

interface AutomationOnboardingOptions {
  installStatus?: string
  onInstall: () => Promise<{ ok: boolean; error?: string }>
  onInstalled: () => Promise<void>
}

export const shouldShowAutomationOnboarding = (state: PromptState, installStatus?: string) => state === 'pending' && installStatus !== 'installed'

export function useAutomationOnboarding({ installStatus, onInstall, onInstalled }: AutomationOnboardingOptions) {
  const [open, setOpen] = useState(() => shouldShowAutomationOnboarding(localStorage.getItem(STORAGE_KEY) as PromptState, installStatus))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const state = localStorage.getItem(STORAGE_KEY) as PromptState
    if (installStatus === 'installed') {
      if (state === 'pending') localStorage.setItem(STORAGE_KEY, 'enabled')
      setOpen(false)
      return
    }
    if (state === 'pending') setOpen(true)
  }, [installStatus])

  const request = () => {
    if (installStatus === 'installed') { localStorage.setItem(STORAGE_KEY, 'enabled'); setOpen(false); return }
    localStorage.setItem(STORAGE_KEY, 'pending')
    setError('')
    setOpen(true)
  }
  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, 'dismissed')
    setError('')
    setOpen(false)
  }
  const enable = async () => {
    if (busy) return
    setBusy(true); setError('')
    const result = await onInstall().catch((reason) => ({ ok: false, error: reason instanceof Error ? reason.message : String(reason) }))
    if (!result.ok) { setError(result.error || '开启失败，请稍后重试'); setBusy(false); return }
    localStorage.setItem(STORAGE_KEY, 'enabled')
    setOpen(false); setBusy(false)
    await onInstalled()
  }

  return { open, busy, error, request, dismiss, enable }
}
