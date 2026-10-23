// Facturación AFIP/ARCA de punta a punta contra un AfipSDK simulado (GM_AFIP_API_URL):
// facturas, notas de crédito que anulan y permiten refacturar, padrón y errores de ARCA
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor } = require('./helpers');

const { iniciarArcaSimulado } = require('./afip-simulado');

let arca;
let s, prod;
const ultimoCAE = () => arca.pedidos.filter(p => p.method === 'FECAESolicitar').pop();
const detalle = p => p.params.FeCAEReq.FeDetReq.FECAEDetRequest;

before(async () => {
  arca = await iniciarArcaSimulado();
  s = await iniciarServidor({ GM_AFIP_API_URL: arca.url });
  [prod] = await s.q('SELECT id FROM productos WHERE activo = 1 ORDER BY id LIMIT 1');
  await s.q('UPDATE productos SET precio_venta = 1210 WHERE id = ?', [prod.id]);
  const [st] = await s.llamar('PUT', '/api/integraciones/config/afip',
    { cuit: '20-11111111-2', access_token: 'x', activa: true, iva_tipo: 5, pto_venta: 3 }, s.tokenAdmin);
  assert.equal(st, 200);
});
after(async () => {
  await s.cerrar();
  await arca.cerrar();
});

// Pedido cobrado de $1210 (IVA 21% incluido)
async function pedidoCobrado() {
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: prod.id, cantidad: 1 }] }, s.tokenVendedor);
  assert.equal((await s.llamar('POST', `/api/pedidos/${p.id}/pagar`, { metodo: 'tarjeta', monto: 1210 }, s.tokenVendedor))[0], 200);
  return p;
}
const facturar = (body, token = s.tokenVendedor) => s.llamar('POST', '/api/integraciones/afip/facturar', body, token);
const notaCredito = (body, token = s.tokenVendedor) => s.llamar('POST', '/api/integraciones/afip/nota-credito', body, token);

test('Factura B: CAE, neto e IVA discriminados y numeración siguiente', async () => {
  const p = await pedidoCobrado();
  const [st, f] = await facturar({ pedido_id: p.id, tipo_comprobante: 6 });
  assert.equal(st, 200, JSON.stringify(f));
  assert.deepEqual([f.tipo_nombre, f.punto_venta, f.numero_comprobante], ['Factura B', 3, 1]);
  const d = detalle(ultimoCAE());
  assert.deepEqual([d.DocTipo, d.DocNro, d.CondicionIVAReceptorId, d.ImpTotal, d.ImpNeto, d.ImpIVA], [99, 0, 5, 1210, 1000, 210]);
  const [c] = await s.q('SELECT * FROM comprobantes_afip WHERE id = ?', [f.id]);
  assert.deepEqual([c.imp_neto, c.imp_iva, c.cae_vencimiento], [1000, 210, '2026-12-01']);
  assert.equal((await facturar({ pedido_id: p.id, tipo_comprobante: 6 }))[0], 409, 'no se factura dos veces');
});

test('padrón: razón social y condición de IVA; Factura A con la condición correcta', async () => {
  const [st, ri] = await s.llamar('GET', '/api/integraciones/afip/padron/30-71234567-1', null, s.tokenVendedor);
  assert.equal(st, 200);
  assert.deepEqual([ri.razon_social, ri.condicion_iva, ri.factura_sugerida], ['LA ESQUINA SRL', 1, 1]);
  assert.match(ri.domicilio, /CORRIENTES/);
  const [, mono] = await s.llamar('GET', '/api/integraciones/afip/padron/27301234568', null, s.tokenVendedor);
  assert.deepEqual([mono.razon_social, mono.condicion_iva, mono.factura_sugerida], ['GOMEZ ANA', 6, 1]);
  const [, cf] = await s.llamar('GET', '/api/integraciones/afip/padron/20400000000', null, s.tokenVendedor);
  assert.deepEqual([cf.condicion_iva, cf.factura_sugerida], [5, 6]);
  assert.equal((await s.llamar('GET', '/api/integraciones/afip/padron/20111111113', null, s.tokenVendedor))[0], 400, 'dígito verificador');
  assert.equal((await s.llamar('GET', '/api/integraciones/afip/padron/30712345671', null, s.tokenVendedor))[0], 200, 'desde la caché');

  // Factura A a un monotributista: condición 6 (antes siempre salía como Responsable Inscripto)
  const p = await pedidoCobrado();
  const [stA, a] = await facturar({ pedido_id: p.id, tipo_comprobante: 1, cuit_receptor: '27-30123456-8',
    condicion_iva_receptor: 6, razon_social: 'GOMEZ ANA' });
  assert.equal(stA, 200, JSON.stringify(a));
  const d = detalle(ultimoCAE());
  assert.deepEqual([d.DocTipo, d.DocNro, d.CondicionIVAReceptorId], [80, 27301234568, 6]);
  const [c] = await s.q('SELECT cuit_receptor, razon_social_receptor, condicion_iva_receptor FROM comprobantes_afip WHERE id = ?', [a.id]);
  assert.deepEqual([c.cuit_receptor, c.razon_social_receptor, c.condicion_iva_receptor], ['27301234568', 'GOMEZ ANA', 6]);
});

test('Factura A: CUIT inválido o cliente consumidor final se rechazan antes de llamar a ARCA', async () => {
  const p = await pedidoCobrado();
  const antes = arca.pedidos.length;
  assert.match((await facturar({ pedido_id: p.id, tipo_comprobante: 1, cuit_receptor: '20111111113' }))[1].error, /no es válido/);
  assert.match((await facturar({ pedido_id: p.id, tipo_comprobante: 1, cuit_receptor: '20400000000', condicion_iva_receptor: 5 }))[1].error, /Factura B/);
  assert.equal(arca.pedidos.length, antes);
});

test('nota de crédito: anula la factura, la asocia y permite volver a facturar', async () => {
  const p = await pedidoCobrado();
  const [, b] = await facturar({ pedido_id: p.id, tipo_comprobante: 6 });
  assert.equal((await notaCredito({ comprobante_id: b.id }))[0], 400, 'el motivo es obligatorio');

  const [st, nc] = await notaCredito({ comprobante_id: b.id, motivo: 'Era Factura A' });
  assert.equal(st, 200, JSON.stringify(nc));
  assert.equal(nc.tipo_nombre, 'Nota Crédito B');
  const d = detalle(ultimoCAE());
  assert.equal(ultimoCAE().params.FeCAEReq.FeCabReq.CbteTipo, 8);
  assert.deepEqual([d.ImpTotal, d.ImpNeto, d.ImpIVA], [1210, 1000, 210]);
  const asoc = d.CbtesAsoc.CbteAsoc[0];
  assert.deepEqual([asoc.Tipo, asoc.PtoVta, asoc.Nro, asoc.Cuit], [6, 3, b.numero_comprobante, 20111111112]);
  assert.ok(asoc.CbteFch > 20260000);

  assert.equal((await notaCredito({ comprobante_id: b.id, motivo: 'otra vez' }))[0], 409, 'no se anula dos veces');
  assert.equal((await notaCredito({ comprobante_id: nc.id, motivo: 'x' }))[0], 400, 'una nota de crédito no se anula así');

  // Ahora se emite la factura correcta
  const [stA, a] = await facturar({ pedido_id: p.id, tipo_comprobante: 1, cuit_receptor: '30712345671', condicion_iva_receptor: 1 });
  assert.equal(stA, 200, JSON.stringify(a));
  const [, ped] = await s.llamar('GET', `/api/pedidos/${p.id}`, null, s.tokenVendedor);
  assert.deepEqual(ped.comprobantes.map(c => c.tipo_comprobante_nombre), ['Factura B', 'Nota Crédito B', 'Factura A']);
  assert.equal(ped.comprobantes[1].comprobante_asociado_id, b.id);
  assert.equal(ped.comprobantes[1].motivo, 'Era Factura A');
  const [aud] = await s.q("SELECT detalle FROM auditoria WHERE accion = 'nota_credito' ORDER BY id DESC LIMIT 1");
  assert.match(aud.detalle, /Era Factura A/);
});

test('nota de crédito A de una factura vieja sin CUIT guardado: lo pide', async () => {
  const p = await pedidoCobrado();
  const [, a] = await facturar({ pedido_id: p.id, tipo_comprobante: 1, cuit_receptor: '30712345671' });
  await s.q("UPDATE comprobantes_afip SET cuit_receptor = '', condicion_iva_receptor = NULL, imp_neto = NULL, imp_iva = NULL WHERE id = ?", [a.id]);
  assert.match((await notaCredito({ comprobante_id: a.id, motivo: 'Error' }))[1].error, /CUIT/);
  const [st, nc] = await notaCredito({ comprobante_id: a.id, motivo: 'Error', cuit_receptor: '30-71234567-1' });
  assert.equal(st, 200, JSON.stringify(nc));
  const d = detalle(ultimoCAE());
  assert.deepEqual([nc.tipo_nombre, d.DocNro, d.CondicionIVAReceptorId, d.ImpNeto, d.ImpIVA], ['Nota Crédito A', 30712345671, 1, 1000, 210]);
});

test('si ARCA rechaza, no queda nada guardado y se muestra el motivo', async () => {
  const p = await pedidoCobrado();
  arca.rechazar = 'El campo DocNro es invalido';
  try {
    const [st, r] = await facturar({ pedido_id: p.id, tipo_comprobante: 6 });
    assert.equal(st, 500);
    assert.match(r.error, /DocNro es invalido/);
  } finally { arca.rechazar = null; }
  assert.equal((await s.q('SELECT COUNT(*) c FROM comprobantes_afip WHERE pedido_id = ?', [p.id]))[0].c, 0);
  assert.equal((await facturar({ pedido_id: p.id, tipo_comprobante: 6 }))[0], 200, 'se reintenta sin problema');
});

test('permisos: el mozo no anula facturas ni consulta el padrón sin cobro en la mesa', async () => {
  const hash = require('bcryptjs').hashSync('mozo1234', 4);
  await s.q("INSERT INTO usuarios (nombre, email, password, rol, debe_cambiar_password) VALUES ('Mozo', 'mozo-afip@test.com', ?, 'mozo', 0)", [hash]);
  const tokenMozo = s.token((await s.q("SELECT id FROM usuarios WHERE email = 'mozo-afip@test.com'"))[0].id);
  const [{ id }] = await s.q('SELECT id FROM comprobantes_afip ORDER BY id LIMIT 1');
  assert.equal((await notaCredito({ comprobante_id: id, motivo: 'x' }, tokenMozo))[0], 403);
  assert.equal((await s.llamar('GET', '/api/integraciones/afip/padron/30712345671', null, tokenMozo))[0], 403);
  await s.llamar('PUT', '/api/config', { mozo_cobra_mesa: 1 }, s.tokenAdmin);
  assert.equal((await s.llamar('GET', '/api/integraciones/afip/padron/30712345671', null, tokenMozo))[0], 200);
  assert.equal((await notaCredito({ comprobante_id: id, motivo: 'x' }, tokenMozo))[0], 403, 'anular sigue siendo de la caja');
});


// La fecha de la factura era la del servidor: en Render (UTC) las de después de las 21 h de Argentina salían
// con la fecha de mañana. Con servidores en UTC+14 y UTC-12, al menos uno tiene otra fecha que Argentina.
test('la factura lleva la fecha del negocio aunque el servidor esté en otra zona', async () => {
  for (const TZ of ['Pacific/Kiritimati', 'Etc/GMT+12']) {
    const srv = await iniciarServidor({ TZ, GM_AFIP_API_URL: arca.url });
    try {
      await srv.llamar('PUT', '/api/integraciones/config/afip', { cuit: '20-11111111-2', access_token: 'x', activa: true }, srv.tokenAdmin);
      const [{ id: prodId }] = await srv.q('SELECT id FROM productos WHERE activo = 1 LIMIT 1');
      const [, p] = await srv.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: prodId, cantidad: 1 }] }, srv.tokenVendedor);
      const [{ total }] = await srv.q('SELECT total FROM pedidos WHERE id = ?', [p.id]);
      await srv.llamar('POST', `/api/pedidos/${p.id}/pagar`, { metodo: 'efectivo', monto: total }, srv.tokenVendedor);
      const [st] = await srv.llamar('POST', '/api/integraciones/afip/facturar', { pedido_id: p.id, tipo_comprobante: 6 }, srv.tokenVendedor);
      assert.equal(st, 200);
      const hoyArg = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date()).replace(/-/g, '');
      assert.equal(String(detalle(ultimoCAE()).CbteFch), hoyArg, TZ);
    } finally { await srv.cerrar(); }
  }
});

test('la propina no se factura: la factura es por el consumo', async () => {
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: prod.id, cantidad: 1 }] }, s.tokenVendedor);
  const [st, r] = await s.llamar('POST', `/api/pedidos/${p.id}/cobro`,
    { propina: 121, pagos: [{ metodo: 'tarjeta', monto: 1331 }], factura: { tipo_comprobante: 6 } }, s.tokenVendedor);
  assert.equal(st, 200, JSON.stringify(r));
  assert.equal(r.factura.ok !== false, true, JSON.stringify(r.factura));
  const d = detalle(ultimoCAE());
  assert.deepEqual([d.ImpTotal, d.ImpNeto, d.ImpIVA], [1210, 1000, 210]);
});

// Dos cajas facturando a la vez pedían el mismo número a ARCA y una factura se rechazaba
test('dos facturas al mismo tiempo salen con números seguidos', async () => {
  const [p1, p2] = [await pedidoCobrado(), await pedidoCobrado()];
  const r = await Promise.all([facturar({ pedido_id: p1.id, tipo_comprobante: 6 }), facturar({ pedido_id: p2.id, tipo_comprobante: 6 })]);
  assert.deepEqual(r.map(x => x[0]), [200, 200], JSON.stringify(r));
  assert.equal(Math.abs(r[0][1].numero_comprobante - r[1][1].numero_comprobante), 1);
});

// El ticket solo decía tipo, número y CAE: le faltaban los datos del emisor, el QR de ARCA y el IVA contenido
test('ticket fiscal: emisor, receptor, IVA contenido (B), IVA discriminado (A), QR de ARCA y marca de prueba', async () => {
  await s.llamar('PUT', '/api/integraciones/config/afip', { cuit: '20-11111111-2', access_token: 'x', activa: true, iva_tipo: 5, pto_venta: 3,
    razon_social: 'LA BUENA MESA SA', domicilio: 'Av. Siempre Viva 742', iibb: '901-123456-7', inicio_actividades: '2020-03-01', condicion_iva: 'ri' }, s.tokenAdmin);

  const p = await pedidoCobrado();
  const [, f] = await facturar({ pedido_id: p.id, tipo_comprobante: 6 });
  const [, ped] = await s.llamar('GET', `/api/pedidos/${p.id}`, null, s.tokenVendedor);
  const fis = ped.fiscal;
  assert.deepEqual([fis.letra, fis.codigo, fis.numero], ['B', '006', `00003-${String(f.numero_comprobante).padStart(8, '0')}`]);
  assert.deepEqual([fis.emisor.razon_social, fis.emisor.cuit, fis.emisor.condicion, fis.emisor.inicio_actividades],
    ['LA BUENA MESA SA', '20-11111111-2', 'IVA Responsable Inscripto', '01/03/2020']);
  assert.equal(fis.receptor, null, 'consumidor final');
  assert.deepEqual([fis.iva_contenido, fis.discriminado, fis.cae_vencimiento, fis.prueba], [210, null, '01/12/2026', true]);
  assert.match(fis.qr_svg, /^<svg/);
  const qr = JSON.parse(Buffer.from(fis.qr.split('?p=')[1], 'base64').toString());
  assert.deepEqual([qr.ver, qr.cuit, qr.ptoVta, qr.tipoCmp, qr.nroCmp, qr.importe, qr.tipoDocRec, qr.tipoCodAut, qr.codAut],
    [1, 20111111112, 3, 6, f.numero_comprobante, 1210, 99, 'E', Number(f.cae)]);
  assert.match(qr.fecha, /^\d{4}-\d{2}-\d{2}$/);

  const pa = await pedidoCobrado();
  await facturar({ pedido_id: pa.id, tipo_comprobante: 1, cuit_receptor: '30-71234567-1', condicion_iva_receptor: 1, razon_social: 'LA ESQUINA SRL' });
  const [, a] = await s.llamar('GET', `/api/pedidos/${pa.id}`, null, s.tokenVendedor);
  assert.deepEqual(a.fiscal.discriminado, { neto: 1000, iva: 210, alicuota: 21 });
  assert.equal(a.fiscal.iva_contenido, null);
  assert.deepEqual([a.fiscal.receptor.cuit, a.fiscal.receptor.razon_social], ['30-71234567-1', 'LA ESQUINA SRL']);
  const qrA = JSON.parse(Buffer.from(a.fiscal.qr.split('?p=')[1], 'base64').toString());
  assert.deepEqual([qrA.tipoDocRec, qrA.nroDocRec], [80, 30712345671]);

  // Sin factura: no hay datos fiscales
  const sin = await pedidoCobrado();
  assert.equal((await s.llamar('GET', `/api/pedidos/${sin.id}`, null, s.tokenVendedor))[1].fiscal, null);
});

test('ticket térmico de una factura: datos fiscales, IVA contenido y QR nativo de la impresora', async () => {
  const net = require('net');
  const trabajos = [];
  const srv = net.createServer(sock => { const b = []; sock.on('data', d => b.push(d)); sock.on('end', () => { trabajos.push(Buffer.concat(b)); sock.end(); }); });
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  try {
    const [st] = await s.llamar('POST', '/api/impresoras', { nombre: 'Caja AFIP', tipo: 'red', destino: `127.0.0.1:${srv.address().port}`,
      imprime_comandas: false, imprime_tickets: true }, s.tokenAdmin);
    assert.equal(st, 201);
    const p = await pedidoCobrado();
    await facturar({ pedido_id: p.id, tipo_comprobante: 6 });
    const antes = trabajos.length;
    assert.equal((await s.llamar('POST', `/api/pedidos/${p.id}/imprimir/ticket`, null, s.tokenVendedor))[0], 200);
    for (let t = 0; t < 5000 && trabajos.length === antes; t += 50) await new Promise(r => setTimeout(r, 50));
    const txt = trabajos[trabajos.length - 1].toString('latin1');
    for (const esperado of ['FACTURA B', 'IVA contenido', 'Ley 27.743', 'CUIT: 20-11111111-2', 'A consumidor final', 'SIN VALIDEZ FISCAL', 'CAE: 74'])
      assert.ok(txt.includes(esperado), `falta "${esperado}"`);
    assert.ok(txt.includes('https://www.afip.gob.ar/fe/qr/?p='), 'QR con la URL de ARCA');
    assert.ok(txt.includes(Buffer.from([0x1d, 0x28, 0x6b]).toString('latin1')), 'comando QR (GS ( k)');
    assert.ok(!txt.includes('Documento no válido como factura'));
  } finally {
    await s.q("DELETE FROM impresoras WHERE nombre = 'Caja AFIP'");
    await new Promise(ok => srv.close(ok));
  }
});

test('una factura de prueba no impide la real en producción, ni se anula desde producción', async () => {
  const p = await pedidoCobrado();
  const [, prueba] = await facturar({ pedido_id: p.id, tipo_comprobante: 6 });
  const [{ modo }] = await s.q('SELECT modo FROM comprobantes_afip WHERE id = ?', [prueba.id]);
  assert.equal(modo, 'homologacion');
  await s.llamar('PUT', '/api/integraciones/config/afip', { cuit: '20-11111111-2', access_token: 'x', activa: true, pto_venta: 3, modo: 'produccion' }, s.tokenAdmin);
  try {
    const [st, nc] = await notaCredito({ comprobante_id: prueba.id, motivo: 'x' }, s.tokenAdmin);
    assert.equal(st, 400);
    assert.match(nc.error, /prueba/);
    const [stReal, real] = await facturar({ pedido_id: p.id, tipo_comprobante: 6 });
    assert.equal(stReal, 200, JSON.stringify(real));
    assert.equal((await s.q('SELECT modo FROM comprobantes_afip WHERE id = ?', [real.id]))[0].modo, 'produccion');
    assert.equal((await facturar({ pedido_id: p.id, tipo_comprobante: 6 }))[0], 409, 'la real sí bloquea otra');
  } finally {
    await s.llamar('PUT', '/api/integraciones/config/afip', { cuit: '20-11111111-2', access_token: 'x', activa: true, iva_tipo: 5, pto_venta: 3 }, s.tokenAdmin);
  }
});
