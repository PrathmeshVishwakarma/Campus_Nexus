// Minimal service worker: lets mobile browsers show system notifications
// (Chrome on Android does not support `new Notification()` from a page) and
// focuses/opens the Alerts page when one is clicked.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let payload = {}
  try { payload = event.data ? event.data.json() : {} } catch { /* ignore */ }
  const title = payload.title || 'Campus Nexus alert'
  const options = {
    body: payload.body || 'Open Campus Nexus to view this alert.',
    tag: payload.id || 'campus-nexus-alert',
    data: { url: payload.url || '/alerts' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/alerts'
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if ('navigate' in client) {
        try { await client.navigate(url) } catch { /* ignore */ }
      }
      if ('focus' in client) return client.focus()
    }
    if (self.clients.openWindow) return self.clients.openWindow(url)
  })())
})
