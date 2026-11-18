import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../store/useAuth'
import { Button } from './ui/button'
import { Input } from './ui/input'

type Prefs = {
  enabled: boolean; enable_messages: boolean; enable_file_events: boolean; enable_alerts: boolean
  min_alert_priority: string; mute_channel_ids: number[]; mute_folder_paths: string[]
  dnd_start: string; dnd_end: string; sound: boolean; desktop_toast: boolean; badges: boolean
}

const PRIOS = ['INFO', 'NORMAL', 'IMPORTANT', 'URGENT', 'CRITICAL']

export function NotificationSettings({ onClose }: { onClose: () => void }) {
  const [p, setP] = useState<Prefs | null>(null)
  const [channels, setChannels] = useState<{ id: number; name: string }[]>([])
  const [folders, setFolders] = useState<{ path: string }[]>([])

  useEffect(() => {
    api('/api/notifications/settings').then(setP).catch((e) => toast.error(e.message))
    api('/api/messages/channels').then(setChannels).catch(() => {})
    api('/api/files/folders').then(setFolders).catch(() => {})
  }, [])

  const save = async () => {
    if (!p) return
    try {
      const { enabled, enable_messages, enable_file_events, enable_alerts, min_alert_priority,
        mute_channel_ids, mute_folder_paths, dnd_start, dnd_end, sound, desktop_toast, badges } = p
      setP(await api('/api/notifications/settings', { method: 'PATCH', body: JSON.stringify({
        enabled, enable_messages, enable_file_events, enable_alerts, min_alert_priority,
        mute_channel_ids, mute_folder_paths, dnd_start, dnd_end, sound, desktop_toast, badges }) }))
      toast.success('Notification settings saved')
      window.dispatchEvent(new Event('nexus:prefs-changed'))
      onClose()
    } catch (e: any) { toast.error(e.message) }
  }

  const toggle = (k: keyof Prefs) => p && setP({ ...p, [k]: !p[k] })
  const Check = ({ k, label }: { k: keyof Prefs; label: string }) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={!!p?.[k]} onChange={() => toggle(k)} /> {label}
    </label>
  )

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-label="Notification settings"
        className="w-full max-w-md max-h-[85vh] overflow-auto rounded-2xl border border-[var(--border)] bg-[var(--bg)] p-5 space-y-3"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center">
          <h2 className="font-bold">Notifications</h2>
          <button onClick={onClose} className="ml-auto text-[var(--muted)]" aria-label="Close"><X size={16} /></button>
        </div>
        {!p ? <p className="text-sm text-[var(--muted)]">Loading…</p> : (
          <>
            <Check k="enabled" label="Notify me at all" />
            <div className={p.enabled ? 'space-y-2' : 'space-y-2 opacity-50 pointer-events-none'}>
              <Check k="enable_alerts" label="Alerts" />
              <label className="flex items-center gap-2 text-sm pl-6">
                at or above
                <select value={p.min_alert_priority} onChange={e => setP({ ...p, min_alert_priority: e.target.value })}
                  className="bg-[var(--card)] border border-[var(--border)] rounded px-2 py-1">
                  {PRIOS.map(x => <option key={x}>{x}</option>)}
                </select>
              </label>
              <Check k="enable_messages" label="Chat messages" />
              <Check k="enable_file_events" label="File comments, conflicts and sync alerts" />
              <Check k="desktop_toast" label="Show pop-up toasts" />
              <Check k="sound" label="Play a sound" />
              <Check k="badges" label="Show unread counts on Chat and Alerts" />
              <div className="text-sm">
                <div className="mb-1">Do not disturb (server time; CRITICAL alerts still come through, the rest is summarised afterwards)</div>
                <div className="flex items-center gap-2">
                  <Input type="time" value={p.dnd_start} onChange={e => setP({ ...p, dnd_start: e.target.value })} aria-label="DND start" />
                  to
                  <Input type="time" value={p.dnd_end} onChange={e => setP({ ...p, dnd_end: e.target.value })} aria-label="DND end" />
                </div>
              </div>
              {channels.length > 0 && (
                <div className="text-sm">
                  <div className="mb-1">Mute chats</div>
                  <div className="flex flex-wrap gap-2">
                    {channels.map(c => (
                      <label key={c.id} className="flex items-center gap-1 text-xs">
                        <input type="checkbox" checked={p.mute_channel_ids.includes(c.id)} onChange={() => setP({ ...p,
                          mute_channel_ids: p.mute_channel_ids.includes(c.id) ? p.mute_channel_ids.filter(x => x !== c.id) : [...p.mute_channel_ids, c.id] })} />
                        {c.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {folders.length > 0 && (
                <div className="text-sm">
                  <div className="mb-1">Mute folders</div>
                  <div className="flex flex-wrap gap-2">
                    {folders.map(f => (
                      <label key={f.path} className="flex items-center gap-1 text-xs">
                        <input type="checkbox" checked={p.mute_folder_paths.includes(f.path)} onChange={() => setP({ ...p,
                          mute_folder_paths: p.mute_folder_paths.includes(f.path) ? p.mute_folder_paths.filter(x => x !== f.path) : [...p.mute_folder_paths, f.path] })} />
                        {f.path}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <Button onClick={save} className="w-full">Save</Button>
          </>
        )}
      </div>
    </div>
  )
}
