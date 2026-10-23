// =============================================
// GASTROMANAGER - Service Worker
// Primero la red y, sin conexión, la última copia guardada.
// (Antes era cache-first: después de una actualización los celulares seguían con el JS viejo.)
// =============================================

const CACHE_NAME = 'gastromanager-v17';
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
  '/js/cobro.js',
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
  '/js/personal.js',
  '/js/fidelizacion.js',
  '/favicon.svg',
  '/manifest.json',
  // Íconos servidos por el propio sistema
  '/vendor/fontawesome/css/all.min.css',
  '/vendor/fontawesome/webfonts/fa-solid-900.woff2',
  '/vendor/fontawesome/webfonts/fa-regular-400.woff2',
  '/vendor/fontawesome/webfonts/fa-brands-400.woff2'
];

// Instalar: guardar los assets para usar sin conexión (uno que falte no frena la instalación)
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => Promise.all(STATIC_ASSETS.map((a) => cache.add(a).catch(() => {}))))
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

// Fetch: la API y Socket.IO van directo; el resto, primero la red
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/socket.io/') ||
    event.request.method !== 'GET'
  ) {
    return; // dejar que el browser lo maneje normalmente
  }

  event.respondWith(
    fetch(event.request).then((response) => {
      if (response && response.status === 200 && response.type === 'basic') {
        const toCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, toCache));
      }
      return response;
    }).catch(() =>
      // Sin conexión: la última copia; para la navegación, la página principal
      caches.match(event.request).then((cached) =>
        cached || (event.request.mode === 'navigate' ? caches.match('/index.html') : Response.error()))
    )
  );
});
