'use strict';
// Configuración y clientes HTTP de Mercado Pago y Tienda Nube
const { run, get } = require('../db');

// Helper: leer/guardar config de integraciones
const getIntCfg = async (tipo) => {
  const row = await get('SELECT valor FROM integraciones_config WHERE clave = ?', [tipo]);
  try { return row ? JSON.parse(row.valor) : {}; } catch { return {}; }
};
const setIntCfg = (tipo, data) => run(
  `INSERT INTO integraciones_config (clave, valor, actualizado_en) VALUES (?, ?, CURRENT_TIMESTAMP)
   ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = excluded.actualizado_en`,
  [tipo, JSON.stringify(data)]
);

// URL pública del sistema (necesaria para webhooks de MP / Tienda Nube)
const urlPublica = () => (process.env.BASE_URL || '').replace(/\/$/, '');

// APIs externas. Las variables de entorno solo se usan en los tests (servidores simulados).
const API_MP = process.env.GM_MP_API_URL || 'https://api.mercadopago.com';
const API_TN = process.env.GM_TN_API_URL || 'https://api.tiendanube.com/v1';
// Pausa entre llamadas a Tienda Nube (su API permite 2 por segundo)
const PAUSA_TN_MS = process.env.GM_TN_PAUSA_MS !== undefined ? Number(process.env.GM_TN_PAUSA_MS) : 500;

// Cliente HTTP para Mercado Pago
async function mpRequest(cfg, method, ruta, body) {
  const token = cfg.modo === 'produccion' ? cfg.access_token : (cfg.access_token_test || cfg.access_token);
  const r = await fetch(`${API_MP}${ruta}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Mercado Pago ${r.status}: ${data.message || 'error'}`);
  return data;
}

// Cliente HTTP para Tienda Nube (respeta el límite de 2 req/s de su API)
const esperar = ms => new Promise(r => setTimeout(r, ms));
async function tnRequest(cfg, method, ruta, body, reintento = true) {
  const r = await fetch(`${API_TN}/${cfg.store_id}${ruta}`, {
    method,
    headers: {
      Authentication: `bearer ${cfg.access_token}`,
      'User-Agent': 'GastroManager/2.0',
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000)
  });
  if (r.status === 429 && reintento) {
    await esperar(2000);
    return tnRequest(cfg, method, ruta, body, false);
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(`Tienda Nube ${r.status}: ${data.description || data.message || 'error'}`);
    err.status = r.status;
    throw err;
  }
  return data;
}

module.exports = { getIntCfg, setIntCfg, urlPublica, mpRequest, esperar, tnRequest, PAUSA_TN_MS };
