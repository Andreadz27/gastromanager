// Modo sin conexión: sin ARCA el cobro sigue y la factura queda en espera; al volver internet se emite sola,
// sin duplicar la que ARCA ya había emitido. Aviso de internet cortado. Íconos y QR sin servicios externos.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const { iniciarServidor, esperar } = require('./helpers');
const { iniciarArcaSimulado } = require('./afip-simulado');

let s, arca, prod, puertoInternet, internet = null;
const facturar = (body, token = s.tokenVendedor) => s.llamar('POST', '/api/integraciones/afip/facturar', body, token);
const pendientes = async () => (await s.llamar('GET', '/api/integraciones/afip/pendientes', null, s.tokenVendedor))[1];
const conexion = async () => (await s.llamar('GET', '/api/conexion', null, s.tokenVendedor))[1];
const esperarQue = async (cond, ms = 6000) => { for (let t = 0; t < ms && !(await cond()); t += 100) await esperar(100); assert.ok(await cond()); };

// "Internet" = un puerto que acepta conexiones. Cerrado: sin internet.
const prenderInternet = () => new Promise(ok => { internet = net.createServer(sk => sk.end()); internet.listen(puertoInternet, '127.0.0.1', ok); });
const apagarInternet = () => new Promise(ok => { if (!internet) return ok(); internet.close(ok); internet = null; });

async function pedidoCobrado() {
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: prod.id, cantidad: 1 }] }, s.tokenVendedor);
  assert.equal((await s.llamar('POST', `/api/pedidos/${p.id}/pagar`, { metodo: 'efectivo', monto: 1210 }, s.tokenVendedor))[0], 200);
  return p;
}

before(async () => {
  arca = await iniciarArcaSimulado();
  puertoInternet = await new Promise(ok => { const t = net.createServer().listen(0, '127.0.0.1', () => { const p = t.address().port; t.close(() => ok(p)); }); });
  s = await iniciarServidor({ GM_AFIP_API_URL: arca.url, GM_CONEXION_HOST: `127.0.0.1:${puertoInternet}`,
    GM_CONEXION_INTERVALO_MS: '300', GM_FACTURAS_REINTENTO_MS: '600000' });
  [prod] = await s.q('SELECT id FROM productos WHERE activo = 1 ORDER BY id LIMIT 1');
  await s.q('UPDATE productos SET precio_venta = 1210 WHERE id = ?', [prod.id]);
  await s.llamar('PUT', '/api/integraciones/config/afip', { cuit: '20-11111111-2', access_token: 'x', activa: true, pto_venta: 2 }, s.tokenAdmin);
});
after(async () => {
  await s.cerrar();
  await arca.cerrar();
  await apagarInternet();
});

test('se corta internet: se avisa en las pantallas', async () => {
  await esperarQue(async () => (await conexion()).internet === false);
  const c = await conexion();
  assert.ok(c.desde);
  assert.deepEqual(c.facturas, { pendientes: 0, con_error: 0 });
});

test('sin ARCA: el cobro sigue y la factura queda en espera; no se puede pedir dos veces', async () => {
  arca.caido = true;
  const p = await pedidoCobrado();
  const [st, r] = await facturar({ pedido_id: p.id, tipo_comprobante: 6 });
  assert.equal(st, 202, JSON.stringify(r));
  assert.equal(r.pendiente, true);
  assert.match(r.mensaje, /en espera/);
  assert.equal((await facturar({ pedido_id: p.id, tipo_comprobante: 6 }))[0], 409);

  // Cobro en un paso (cuenta con factura): también queda en espera y el cobro se hace
  const [, p2] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: prod.id, cantidad: 1 }] }, s.tokenVendedor);
  const [stC, c] = await s.llamar('POST', `/api/pedidos/${p2.id}/cobro`, { pagos: [{ metodo: 'efectivo', monto: 1210 }], factura: { tipo_comprobante: 6 } }, s.tokenVendedor);
  assert.equal(stC, 200, JSON.stringify(c));
  assert.equal(c.cerrado, true);
  assert.equal(c.factura.pendiente, true);

  const lista = await pendientes();
  assert.deepEqual(lista.map(f => [f.pedido_id, f.estado]), [[p.id, 'pendiente'], [p2.id, 'pendiente']]);
  assert.equal((await conexion()).facturas.pendientes, 2);
  // Reintentar a mano sigue sin conexión: no cambia nada ni marca error
  const [, rr] = await s.llamar('POST', '/api/integraciones/afip/pendientes/reintentar', {}, s.tokenVendedor);
  assert.deepEqual([rr.emitidas, rr.siguen], [0, 2]);
  assert.equal((await s.q("SELECT COUNT(*) n FROM comprobantes_afip"))[0].n, 0);
});

test('se cortó justo después de emitir: al reintentar recupera esa factura y no emite otra', async () => {
  arca.caido = false;
  arca.cortarDespuesDeEmitir = true;
  // Se procesan primero las dos de antes: la primera se emite pero la respuesta no llega
  const [, r] = await s.llamar('POST', '/api/integraciones/afip/pendientes/reintentar', {}, s.tokenVendedor);
  assert.deepEqual([r.emitidas, r.siguen], [0, 2]);
  const [primera] = await s.q("SELECT * FROM facturas_pendientes WHERE estado = 'pendiente' ORDER BY id LIMIT 1");
  assert.equal(primera.numero_intentado, 1, 'quedó anotado el número que se pidió');
  assert.equal(arca.ultimo[6], 1, 'ARCA sí la emitió');
});

test('vuelve internet: las facturas en espera se emiten solas, en orden, sin duplicar', async () => {
  const solicitudesAntes = arca.pedidos.filter(p => p.method === 'FECAESolicitar').length;
  await prenderInternet();
  await esperarQue(async () => (await conexion()).internet === true);
  await esperarQue(async () => (await conexion()).facturas.pendientes === 0);
  const comps = await s.q('SELECT pedido_id, numero_comprobante, cae FROM comprobantes_afip ORDER BY numero_comprobante');
  assert.deepEqual(comps.map(c => c.numero_comprobante), [1, 2], 'la 1 recuperada y la 2 nueva: ninguna repetida');
  assert.equal(arca.pedidos.filter(p => p.method === 'FECAESolicitar').length - solicitudesAntes, 1, 'solo se pidió un CAE nuevo');
  assert.equal(comps[0].cae, arca.emitidos['6-1'].CodAutorizacion);
  const estados = (await s.q('SELECT estado, comprobante_id FROM facturas_pendientes ORDER BY id')).map(f => f.estado);
  assert.deepEqual(estados, ['emitida', 'emitida']);
});

test('si ARCA rechaza al reintentar: queda con error para revisar (no se reintenta)', async () => {
  await apagarInternet();
  arca.caido = true;
  const p = await pedidoCobrado();
  assert.equal((await facturar({ pedido_id: p.id, tipo_comprobante: 6 }))[0], 202);
  arca.caido = false;
  arca.rechazar = 'El campo ImpTotal es invalido';
  try {
    await s.llamar('POST', '/api/integraciones/afip/pendientes/reintentar', {}, s.tokenVendedor);
  } finally { arca.rechazar = null; }
  const [f] = (await pendientes()).filter(x => x.pedido_id === p.id);
  assert.equal(f.estado, 'error');
  assert.match(f.ultimo_error, /ImpTotal/);
  assert.equal((await conexion()).facturas.con_error, 1);
  const [alerta] = await s.q("SELECT detalle FROM auditoria WHERE accion = 'alerta_afip' ORDER BY id DESC LIMIT 1");
  assert.match(alerta.detalle, /no se pudo emitir/);
  // El administrador la descarta (por ejemplo, la facturó a mano)
  assert.equal((await s.llamar('POST', `/api/integraciones/afip/pendientes/${f.id}/descartar`, {}, s.tokenVendedor))[0], 403);
  assert.equal((await s.llamar('POST', `/api/integraciones/afip/pendientes/${f.id}/descartar`, {}, s.tokenAdmin))[0], 200);
  assert.equal((await conexion()).facturas.con_error, 0);
});

test('un error que no es de conexión no queda en espera', async () => {
  const p = await pedidoCobrado();
  arca.rechazar = 'El campo DocNro es invalido';
  try {
    const [st] = await facturar({ pedido_id: p.id, tipo_comprobante: 6 });
    assert.equal(st, 500);
  } finally { arca.rechazar = null; }
  assert.equal((await s.q('SELECT COUNT(*) n FROM facturas_pendientes WHERE pedido_id = ?', [p.id]))[0].n, 0);
});

test('íconos y QR salen del propio sistema (sin cdnjs ni api.qrserver.com)', async () => {
  const css = await fetch(s.base + '/vendor/fontawesome/css/all.min.css');
  assert.equal(css.status, 200);
  assert.match(await css.text(), /webfonts\/fa-solid-900\.woff2/);
  assert.equal((await fetch(s.base + '/vendor/fontawesome/webfonts/fa-solid-900.woff2')).status, 200);
  assert.equal((await fetch(s.base + '/vendor/fontawesome/package.json')).status, 404, 'solo se publican estilos y fuentes');
  const qr = await fetch(s.base + '/api/publico/qr.svg?d=' + encodeURIComponent('https://local.test/menu.html'));
  assert.equal(qr.status, 200);
  assert.match(qr.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(await qr.text(), /^<svg/);
  assert.equal((await fetch(s.base + '/api/publico/qr.svg?d=' + 'x'.repeat(1001))).status, 400);
  const html = await (await fetch(s.base + '/')).text();
  assert.doesNotMatch(html, /cdnjs|qrserver/);
  const csp = (await fetch(s.base + '/')).headers.get('content-security-policy');
  assert.doesNotMatch(csp, /cdnjs|qrserver/);
});
