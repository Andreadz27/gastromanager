'use strict';
// Morfi Nube: manda a la nube las ventas cerradas y el estado del local, para el panel del dueño (todos sus
// locales desde el celular) y para soporte. Se activa con NUBE_URL y NUBE_TOKEN en el .env (el token lo da
// `node nube/alta.js local ...`). Sin internet no pasa nada: lo que falta se manda en la próxima vuelta.
// De las ventas no se mandan datos de los clientes (nombre, teléfono, CUIT): solo números de pedido, productos e importes.
// También publica la carta online y trae los pedidos que entran por ella (ver más abajo).
const { get, all, run } = require('../db');
const { LOCAL } = require('../tiempo');
const { listarBackups } = require('./backups');
const { estadoNube } = require('./copia-nube');
const { crearPedidoOnline } = require('./pedido-online');
const VERSION = require('../../package.json').version;

const TANDA = 200;
const configurada = (env = process.env) => !!(env.NUBE_URL && env.NUBE_TOKEN);

async function enviar(ruta, cuerpo, metodo = 'POST') {
  const r = await fetch(process.env.NUBE_URL.replace(/\/$/, '') + ruta, {
    method: metodo, body: cuerpo == null ? undefined : JSON.stringify(cuerpo), signal: AbortSignal.timeout(30000),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.NUBE_TOKEN }
  });
  if (!r.ok) {
    let detalle = '';
    try { detalle = (await r.json()).error || ''; } catch (e) {}
    throw Object.assign(new Error(`La nube respondió ${r.status} ${detalle}`.trim()), { status: r.status });
  }
  return r.json();
}

// Pedidos cerrados que la nube todavía no tiene (o que cambiaron de estado desde que se mandaron)
const PENDIENTES = `FROM pedidos WHERE estado IN ('pagado', 'cancelado') AND COALESCE(sincronizado_nube, '') <> estado`;

async function tandaDeVentas() {
  const pedidos = await all(`SELECT id, numero_pedido, estado, tipo, metodo_pago, total, propina, descuento,
      date(COALESCE(cerrado_en, creado_en), ${LOCAL()}) AS fecha, strftime('%H:%M', COALESCE(cerrado_en, creado_en), ${LOCAL()}) AS hora
    ${PENDIENTES} ORDER BY id LIMIT ${TANDA}`);
  if (!pedidos.length) return [];
  const items = await all(`SELECT pedido_id, nombre_producto, SUM(cantidad) AS cantidad, SUM(subtotal) AS subtotal FROM pedido_items
    WHERE pedido_id IN (${pedidos.map(() => '?').join(',')}) GROUP BY pedido_id, nombre_producto`, pedidos.map(p => p.id));
  return pedidos.map(p => ({
    pedido_id: p.id, numero: p.numero_pedido, fecha: p.fecha, hora: p.hora, estado: p.estado, tipo: p.tipo,
    metodo: p.metodo_pago, total: p.total, propina: p.propina, descuento: p.descuento,
    items: items.filter(i => i.pedido_id === p.id).map(i => ({ producto: i.nombre_producto, cantidad: i.cantidad, subtotal: i.subtotal }))
  }));
}

async function estadoLocal() {
  const f = await get(`SELECT SUM(estado = 'pendiente') AS pendientes, SUM(estado = 'error') AS con_error FROM facturas_pendientes`);
  const caja = await get("SELECT id FROM caja WHERE estado = 'abierta' LIMIT 1");
  const sinEnviar = await get(`SELECT COUNT(*) AS n ${PENDIENTES}`);
  const ultima = listarBackups()[0];
  return {
    version: VERSION, ultima_copia: ultima ? ultima.fecha : null, copia_en_nube: !!estadoNube.activa,
    facturas_en_espera: Number(f && f.pendientes) || 0, facturas_con_error: Number(f && f.con_error) || 0,
    caja_abierta: !!caja, ventas_sin_enviar: sinEnviar.n
  };
}

// Una vuelta: ventas pendientes (hasta 10 tandas) y después el estado. Devuelve cuántas ventas se mandaron.
let enCurso = null;
function sincronizar() {
  if (!enCurso) enCurso = vuelta().finally(() => { enCurso = null; });
  return enCurso;
}
async function vuelta() {
  let enviadas = 0;
  for (let i = 0; i < 10; i++) {
    const ventas = await tandaDeVentas();
    if (!ventas.length) break;
    await enviar('/api/sync/ventas', { ventas });
    // Se marca con el estado que se mandó: si el pedido cambió mientras tanto, la próxima vuelta lo manda de nuevo
    for (const v of ventas) await run('UPDATE pedidos SET sincronizado_nube = ? WHERE id = ? AND estado = ?', [v.estado, v.pedido_id, v.estado]);
    enviadas += ventas.length;
    if (ventas.length < TANDA) break;
  }
  await enviar('/api/sync/estado', await estadoLocal());
  return { enviadas };
}

// ============ CARTA Y PEDIDOS ONLINE (etapa 2) ============
// La carta online vive en la nube (/l/<cliente>): link fijo, sin túnel. Se manda cuando cambia.
// Los pedidos quedan en la nube y se traen cada 10 s; si el local no viene a buscar, la nube deja de tomarlos.
let cartaEnviada = '';
let urlCarta = null; // link fijo en la nube (lo contesta la nube al recibir la carta)
const urlCartaNube = () => (configurada() ? urlCarta : null);
async function cartaLocal() {
  const categorias = await all(`SELECT c.id, c.nombre FROM categorias c
    WHERE c.activo = 1 AND EXISTS (SELECT 1 FROM productos p WHERE p.categoria_id = c.id AND p.activo = 1) ORDER BY c.orden, c.nombre`);
  const productos = await all(`SELECT id, nombre, descripcion, precio_venta, categoria_id, tracking_stock, stock_actual, es_plato
    FROM productos WHERE activo = 1 ORDER BY nombre`);
  const c = await get('SELECT nombre_negocio, direccion, telefono, email FROM configuracion WHERE id = 1') || {};
  return { info: { nombre: c.nombre_negocio, direccion: c.direccion, telefono: c.telefono, email: c.email }, categorias, productos };
}
async function enviarCarta() {
  const carta = JSON.stringify(await cartaLocal());
  if (carta === cartaEnviada) return false;
  const r = await enviar('/api/sync/carta', JSON.parse(carta));
  if (r && /^https?:\/\//.test(r.url || '')) urlCarta = r.url;
  cartaEnviada = carta;
  return true;
}

// Trae los pedidos nuevos y los carga como cualquier pedido online (precios del local, comanda, aviso en pantalla)
let trayendo = null;
function traerPedidos() {
  if (!trayendo) trayendo = traer().finally(() => { trayendo = null; });
  return trayendo;
}
async function traer() {
  const lista = await enviar('/api/sync/pedidos', null, 'GET');
  let traidos = 0;
  for (const { id, ...datos } of lista) {
    let r;
    try { r = await crearPedidoOnline(datos, { nubeId: id }); } catch (e) {
      // El local no lo puede tomar (ej. un producto que ya no está): se le avisa al cliente. Otro error: se reintenta.
      if (e.status >= 400 && e.status < 500) { await enviar(`/api/sync/pedidos/${id}/rechazado`, { error: e.message }); continue; }
      throw e;
    }
    // Si esto falla, la próxima vuelta lo trae de nuevo: no se duplica (nube_pedido_id) y se vuelve a avisar
    await enviar(`/api/sync/pedidos/${id}/recibido`, { numero: r.numero, total: r.total });
    if (!r.repetido) traidos++;
  }
  return traidos;
}

// Se avisa una vez por tipo de error (sin internet se repite cada vuelta y llenaría el log)
const ultimoError = {};
const seguro = (nombre, fn) => async () => {
  try { await fn(); ultimoError[nombre] = ''; } catch (e) {
    if (e.message !== ultimoError[nombre]) console.error(`[nube] No se pudo ${nombre}:`, e.message);
    ultimoError[nombre] = e.message;
  }
};

function iniciarSyncNube() {
  if (!configurada()) return;
  // NUBE_SEGUNDOS y NUBE_PEDIDOS_SEGUNDOS solo para tests; en producción cada 2 minutos y cada 10 segundos
  const ms = Number(process.env.NUBE_SEGUNDOS) * 1000 || 2 * 60000;
  const msPedidos = Number(process.env.NUBE_PEDIDOS_SEGUNDOS) * 1000 || 10000;
  const vuelta = seguro('sincronizar', async () => { await enviarCarta(); await sincronizar(); });
  const pedidos = seguro('traer pedidos online', traerPedidos);
  vuelta();
  pedidos();
  setInterval(vuelta, ms).unref();
  setInterval(pedidos, msPedidos).unref();
  console.log(`[nube] Sincronizando con ${process.env.NUBE_URL} cada ${Math.round(ms / 1000)} s; pedidos online cada ${Math.round(msPedidos / 1000)} s`);
}

module.exports = { iniciarSyncNube, sincronizar, traerPedidos, enviarCarta, estadoLocal, configurada, urlCartaNube };
