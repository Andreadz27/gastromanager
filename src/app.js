'use strict';
// Aplicación Express: middlewares, rutas y página 404
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const http = require('http');
const path = require('path');
const { origenPermitido } = require('./config');
const { apiLimiter } = require('./limites');

const app = express();
const server = http.createServer(app);

// ------ Middlewares de seguridad ------
app.use(helmet({
  crossOriginResourcePolicy:  { policy: 'cross-origin' },
  crossOriginOpenerPolicy:    false, // requiere HTTPS, causa warnings en red local
  originAgentCluster:         false, // idem
  // CSP: solo recursos propios + Font Awesome (cdnjs) + imágenes QR (api.qrserver.com).
  // 'unsafe-inline' en scripts sigue siendo necesario por los onclick="" del HTML;
  // igual bloquea scripts de otros dominios, plugins, <base> y embeber la app en otros sitios.
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'", "'unsafe-inline'"],
      scriptSrcAttr:  ["'unsafe-inline'"],
      styleSrc:       ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
      fontSrc:        ["'self'", 'data:', 'https://cdnjs.cloudflare.com'],
      imgSrc:         ["'self'", 'data:', 'blob:', 'https://api.qrserver.com'],
      connectSrc:     ["'self'"],
      workerSrc:      ["'self'"],
      manifestSrc:    ["'self'"],
      objectSrc:      ["'none'"],
      baseUri:        ["'self'"],
      formAction:     ["'self'"],
      frameAncestors: ["'self'"]
      // Sin upgrade-insecure-requests: en la red local el sistema se usa por HTTP
    }
  }
}));
app.use(cors({
  origin: (origin, cb) => {
    if (origenPermitido(origin)) return cb(null, true);
    return cb(new Error('Origen no permitido por CORS'));
  }
}));
// Detrás de un proxy/túnel (nginx, cloudflared) la IP real llega en X-Forwarded-For.
// Por defecto solo se confía en un proxy en la misma máquina.
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');
app.use(express.json({ limit: '2mb' }));
// JSON mal formado: 400 en lugar de un error sin manejar
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Petición demasiado grande' });
  next(err);
});

app.use(express.static(path.join(__dirname, '..', 'public')));

// Apply API rate limiter to all /api routes
app.use('/api/', apiLimiter);

// Rutas de la API (una por módulo)
for (const modulo of ["auth","publico","configuracion","usuarios","catalogo","mesas","promociones","pedidos","delivery","caja","contabilidad","proveedores","stock","clientes","reportes","integraciones","backups","impresion"]) {
  require('./rutas/' + modulo)(app);
}

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint no encontrado' });
  }
  res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html'));
});

module.exports = { app, server };
