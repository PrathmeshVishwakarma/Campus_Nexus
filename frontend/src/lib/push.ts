import { api } from '../store/useAuth'

/**
 * Web Push: the service worker shows system notifications for alerts even when
 * the site is closed. Needs a secure context (HTTPS or localhost) and the
 * user's permission; everything here silently no-ops otherwise.
 */

export function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* insecure context (plain http on LAN) */ })
  }
}

function urlB64ToBytes(key: string) {
  const padded = (key + '='.repeat((4 - (key.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}

export async function subscribePush() {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
  try {
    const reg = await navigator.serviceWorker.ready
    const { key } = await api('/api/push/public-key')
    if (!key) return
    const appKey = urlB64ToBytes(key)
    let sub = await reg.pushManager.getSubscription()
    // drop a subscription made with an older server key
    const current = sub?.options?.applicationServerKey
    if (sub && current) {
      const bytes = new Uint8Array(current)
      const same = bytes.length === appKey.length && bytes.every((v, i) => v === appKey[i])
      if (!same) { try { await sub.unsubscribe() } catch { /* ignore */ } sub = null }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey })
    await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify(sub.toJSON()) })
  } catch { /* unsupported or insecure context */ }
}

/** Remove this browser's push subscription (on logout, so the next user of the device doesn't get our alerts). */
export async function unsubscribePush() {
  try {
    if (!('serviceWorker' in navigator)) return
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    if (!sub) return
    await api(`/api/push/subscribe?endpoint=${encodeURIComponent(sub.endpoint)}`, { method: 'DELETE' }).catch(() => {})
    await sub.unsubscribe()
  } catch { /* ignore */ }
}

/** Show an OS-level notification (service worker first: required on Android Chrome). */
export async function systemNotify(title: string, body: string, tag: string, url: string) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined
    if (reg) { await reg.showNotification(title, { body, tag, data: { url } }); return true }
    new Notification(title, { body, tag })
    return true
  } catch { return false }
}
