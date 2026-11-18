import { useCallback, useEffect, useRef, useState } from 'react'
import { api, useAuth } from '../store/useAuth'
import { useNexusEvents } from './useNexusEvents'

export type Badges = { chat: number; alerts: number; alert_priority: string | null; enabled: boolean }
const EMPTY: Badges = { chat: 0, alerts: 0, alert_priority: null, enabled: false }

/**
 * Nav badge counts. The server applies the user's preferences (muted chats,
 * minimum alert priority, badges on/off); we refetch on relevant live events.
 */
export function useBadges() {
  const { token } = useAuth()
  const [badges, setBadges] = useState<Badges>(EMPTY)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(() => {
    if (!useAuth.getState().token) { setBadges(EMPTY); return }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      api('/api/notifications/badges').then(setBadges).catch(() => {})
    }, 200)
  }, [])

  useEffect(() => { refresh() }, [token, refresh])
  // preferences changed in the settings panel
  useEffect(() => {
    window.addEventListener('nexus:prefs-changed', refresh)
    return () => window.removeEventListener('nexus:prefs-changed', refresh)
  }, [refresh])

  const { connected } = useNexusEvents((e) => {
    if (['MESSAGE_SENT', 'MESSAGE_READ', 'ALERT_CREATED', 'ALERT_ACKNOWLEDGED'].includes(e.event)) refresh()
  }, token)
  // re-sync after a reconnect (events may have been missed)
  useEffect(() => { if (connected) refresh() }, [connected, refresh])

  return badges
}
