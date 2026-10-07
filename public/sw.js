// =============================================
// GASTROMANAGER - Service Worker
// Caché de assets estáticos para PWA offline
// =============================================

const CACHE_NAME = 'gastromanager-v11';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/cocina-display.html',
  '/css/styles.css',
  '/css/mobile.css',
  '/js/app.js',
  '/js/api.js',
  '/js/dashboard.js',
  '/js/pos.js',
  '/js/mesas.js',
  '/js/pedidos.js',
  '/js/cocina.js',
  '/js/delivery.js',
  '/js/productos.js',
  '/js/stock.js',
  '/js/proveedores.js',
  '/js/clientes.js',
  '/js/caja.js',
  '/js/reportes.js',
  '/js/contabilidad.js',
  '/js/usuarios.js',
  '/js/config.js',
  '/js/integraciones.js',
  '/favicon.svg',
  '/manifest.json'
];

// Instalar: cachear todos los assets estáticos
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
});

// Activar: limpiar cachés viejos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: network-first para API, cache-first para estáticos
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Siempre ir a la red para: API, Socket.IO, autenticación
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/socket.io/') ||
    event.request.method !== 'GET'
  ) {
    return; // dejar que el browser lo maneje normalmente
  }

  // Cache-first para assets estáticos conocidos
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      // No en caché: buscar en red y guardar
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        const toCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, toCache));
        return response;
      }).catch(() => {
        // Offline y sin caché: devolver página principal para rutas de navegación
        if (event.request.destination === 'document') {
          return caches.match('/index.html');
        }
      });
    })
  );
});
