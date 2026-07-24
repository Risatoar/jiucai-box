import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConversationTurn } from '../components/ConversationHistoryRail'

interface ConversationScrollInput {
  sessionId: string | null
  messagesLength: number
  sending: boolean
  streamContent: string
  streamStatus: string
  turns: ConversationTurn[]
}

export function useConversationScroll({ sessionId, messagesLength, sending, streamContent, streamStatus, turns }: ConversationScrollInput) {
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const messageRefs = useRef(new Map<string, HTMLElement>())
  const scrollFrameRef = useRef(0)
  const autoScrollFrameRef = useRef(0)
  const nearBottomRef = useRef(true)

  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll || !nearBottomRef.current) return
    window.cancelAnimationFrame(autoScrollFrameRef.current)
    autoScrollFrameRef.current = window.requestAnimationFrame(() => {
      scroll.scrollTo({ top: scroll.scrollHeight, behavior: 'auto' })
      nearBottomRef.current = true
    })
  }, [messagesLength, sending, streamContent, streamStatus])

  useEffect(() => {
    nearBottomRef.current = true
    setActiveTurnId(turns.at(-1)?.id || null)
  }, [sessionId, turns.length])

  useEffect(() => () => {
    window.cancelAnimationFrame(scrollFrameRef.current)
    window.cancelAnimationFrame(autoScrollFrameRef.current)
  }, [])

  const registerMessageNode = useCallback((messageId: string, node: HTMLElement | null) => {
    if (node) messageRefs.current.set(messageId, node)
    else messageRefs.current.delete(messageId)
  }, [])

  const syncActiveTurn = useCallback(() => {
    const scroll = scrollRef.current
    if (!scroll || turns.length === 0) return
    const checkpoint = scroll.scrollTop + 110
    let low = 0
    let high = turns.length - 1
    let activeIndex = 0
    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      const node = messageRefs.current.get(turns[middle].targetMessageId)
      if (!node || node.offsetTop > checkpoint) high = middle - 1
      else { activeIndex = middle; low = middle + 1 }
    }
    const nextId = turns[activeIndex].id
    setActiveTurnId((current) => current === nextId ? current : nextId)
  }, [turns])

  const handleScroll = useCallback(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    nearBottomRef.current = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 120
    if (scrollFrameRef.current) return
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = 0
      syncActiveTurn()
    })
  }, [syncActiveTurn])

  const jumpToTurn = useCallback((turn: ConversationTurn) => {
    const scroll = scrollRef.current
    const target = messageRefs.current.get(turn.targetMessageId)
    if (!scroll || !target) return
    setActiveTurnId(turn.id)
    scroll.scrollTo({ top: Math.max(0, target.offsetTop - 24), behavior: 'smooth' })
  }, [])

  return { activeTurnId, scrollRef, registerMessageNode, handleScroll, jumpToTurn }
}
