'use strict';
// Demo pública (GM_DEMO=1): el sistema queda abierto en internet con usuarios y claves conocidos.
// Se bloquean las acciones que permitirían dejar afuera a otros visitantes (usuarios y contraseñas)
// o usar el servidor para conectarse a otras direcciones (impresoras de red, integraciones, webhooks).
// Todo lo demás se puede probar: los datos se regeneran cada pocas horas (scripts/demo/demo-publica.js).

const ES_DEMO = process.env.GM_DEMO === '1';
const CLAVE_DEMO = 'demo1234';
const REINICIO_HORAS = Number(process.env.GM_DEMO_REINICIO_HORAS) || 6;

const USUARIOS_DEMO = [
  { email: 'admin@labuenamesa.com', rol: 'Administrador' },
  { email: 'encargado@labuenamesa.com', rol: 'Encargado' },
  { email: 'caja@labuenamesa.com', rol: 'Cajero' },
  { email: 'lucas@labuenamesa.com', rol: 'Mozo' },
  { email: 'cocina@labuenamesa.com', rol: 'Cocina' }
];

// [ruta, métodos bloqueados]
const BLOQUEADAS = [
  [/^\/api\/usuarios(\/|$)/, ['POST', 'PUT', 'DELETE']],
  [/^\/api\/auth\/password$/, ['PUT']],
  [/^\/api\/impresoras(\/|$)/, ['POST', 'PUT', 'DELETE']],
  [/^\/api\/impresion\/config$/, ['PUT']],
  [/^\/api\/integraciones\//, ['POST', 'PUT', 'DELETE']],
  [/^\/api\/delivery\/plataformas\/[^/]+\/integracion/, ['POST', 'PUT']],
  [/^\/api\/backups$/, ['POST']],
  [/^\/api\/backups\/.+/, ['GET']],
  [/^\/api\/(mp\/notificacion|tiendanube\/webhook)$/, ['POST']],
  // WhatsApp manda mensajes a teléfonos reales: en la demo no se envía nada
  [/^\/api\/whatsapp\//, ['POST']],
  // El asistente IA gasta saldo de la cuenta de Claude: en la demo no se prueba
  [/^\/api\/asistente\//, ['POST']]
];

function bloqueoDemo(req, res, next) {
  // Express no distingue mayúsculas en las rutas: /API/Usuarios llega a /api/usuarios
  const ruta = req.path.toLowerCase();
  if (ES_DEMO && BLOQUEADAS.some(([patron, metodos]) => patron.test(ruta) && metodos.includes(req.method))) {
    return res.status(403).json({ error: 'En la demo pública esta acción está deshabilitada', demo: true });
  }
  next();
}

// Datos para la pantalla de ingreso de la demo (sin sesión)
function rutasDemo(app) {
  if (!ES_DEMO) return;
  app.get('/api/demo', (req, res) => res.json({ demo: true, clave: CLAVE_DEMO, reinicio_horas: REINICIO_HORAS, usuarios: USUARIOS_DEMO }));
}

module.exports = { ES_DEMO, BLOQUEADAS, bloqueoDemo, rutasDemo };
