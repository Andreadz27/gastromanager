'use strict';
const rateLimit = require('express-rate-limit');

// Rate limiting: protege login y endpoints sensibles de fuerza bruta
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10,                  // intentos fallidos por IP
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' }
});
// Límite general por IP (cada terminal del local tiene la suya). 500 cada 15 min se quedaba
// corto en hora pico: cada pedido refresca dashboard, cocina y mesas en todas las pantallas.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.GM_API_LIMITE) || 3000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones. Intenta más tarde.' }
});

module.exports = { loginLimiter, apiLimiter };
