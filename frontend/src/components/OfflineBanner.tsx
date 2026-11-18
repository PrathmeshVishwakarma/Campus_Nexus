import * as React from 'react'
import { WifiOff } from 'lucide-react'
import { useAuth } from '../store/useAuth'
import { useNexusEvents } from '../hooks/useNexusEvents'

/**
 * Thin banner that appears under the nav whenever the shared live socket is not
 * open. A short grace delay avoids a flash during the normal initial connect.
 */
export function OfflineBanner() {
  const { token } = useAuth()
  const { status } = useNexusEvents(undefined, token)
  const [show, setShow] = React.useState(false)

  React.useEffect(() => {
    if (status === 'open') {
      setShow(false)
      return
    }
    const t = setTimeout(() => setShow(true), 1200)
    return () => clearTimeout(t)
  }, [status])

  if (!token || !show) return null

  return (
    <div
      role="status"
      className="sticky top-14 z-30 flex items-center justify-center gap-2 border-b border-[var(--border)] bg-[var(--warning)]/15 px-4 py-1.5 text-xs font-medium text-[var(--warning)]"
    >
      <WifiOff size={13} className="animate-pulse" />
      {status === 'connecting' ? 'Reconnecting…' : 'Offline — trying to reconnect…'}
    </div>
  )
}
