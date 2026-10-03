// Catchin' Up staff app service worker: makes the app installable. It does not cache pages, so staff always get the latest version.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
