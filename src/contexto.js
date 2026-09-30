'use strict';
// Todo lo que comparten los módulos de rutas (src/rutas/*.js)
module.exports = {
  crypto: require('crypto'),
  fs: require('fs'),
  path: require('path'),
  bcrypt: require('bcryptjs'),
  jwt: require('jsonwebtoken'),
  rateLimit: require('express-rate-limit'),
  Afip: require('@afipsdk/afip.js'),
  ...require('./config'),
  ...require('./db'),
  ...require('./tiempo'),
  ...require('./util'),
  ...require('./auth'),
  ...require('./limites'),
  ...require('./realtime'),
  ...require('./servicios/pedidos'),
  ...require('./servicios/integraciones'),
  ...require('./servicios/backups'),
  ...require('./servicios/impresion'),
};
