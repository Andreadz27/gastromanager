const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const { iniciarServidor, esperar } = require('./helpers');

process.env.GM_IMPRESION_ESPERA_MS = '300'; // agrupar "agregados" rápido en los tests

// Impresora de red falsa: guarda cada trabajo recibido
function impresoraFalsa() {
  const trabajos = [];
  const server = net.createServer(socket => {
    const partes = [];
    socket.on('data', d => partes.push(d));
    socket.on('end', () => { trabajos.push(Buffer.concat(partes)); socket.end(); });
  });
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok({
    destino: `127.0.0.1:${server.address().port}`, trabajos,
    texto: i => trabajos[i].toString('latin1'),
    cerrar: () => new Promise(r => server.close(r))
  })));
}

async function esperarTrabajos(impresora, cantidad, ms = 8000) {
  for (let t = 0; t < ms && impresora.trabajos.length < cantidad; t += 50) await esperar(50);
  assert.equal(impresora.trabajos.length, cantidad, `se esperaban ${cantidad} trabajos en ${impresora.destino}`);
}

let s, cocina, barra, caja, idCocina, idBarra, idCaja, productos;
const CUT = Buffer.from([0x1d, 0x56]).toString('latin1');
const CAJON = Buffer.from([0x1b, 0x70, 0x00]).toString('latin1');

before(async () => {
  s = await iniciarServidor();
  [cocina, barra, caja] = await Promise.all([impresoraFalsa(), impresoraFalsa(), impresoraFalsa()]);
  productos = Object.fromEntries((await s.q('SELECT id, nombre FROM productos')).map(p => [p.nombre, p.id]));
});
after(async () => {
  await s.cerrar();
  await Promise.all([cocina, barra, caja].map(i => i.cerrar()));
});

const crearImpresora = body => s.llamar('POST', '/api/impresoras', body, s.tokenAdmin);

test('validaciones y permisos de impresoras', async () => {
  assert.equal((await s.llamar('POST', '/api/impresoras', { nombre: 'X', tipo: 'red', destino: cocina.destino }, s.tokenVendedor))[0], 403);
  assert.equal((await crearImpresora({ nombre: '', tipo: 'red', destino: cocina.destino }))[0], 400);
  assert.equal((await crearImpresora({ nombre: 'X', tipo: 'bluetooth', destino: 'a' }))[0], 400);
  assert.equal((await crearImpresora({ nombre: 'X', tipo: 'red', destino: '192.168.0.1; rm -rf' }))[0], 400);
  assert.equal((await crearImpresora({ nombre: 'X', tipo: 'red', destino: cocina.destino, ancho: 70 }))[0], 400);
  assert.equal((await crearImpresora({ nombre: 'X', tipo: 'red', destino: cocina.destino, imprime_comandas: false, imprime_tickets: false }))[0], 400);
});

test('configurar estaciones: cocina (platos), barra (bebidas, 58 mm) y caja (tickets)', async () => {
  const [cats] = [await s.q('SELECT id, nombre FROM categorias')];
  const cat = n => cats.find(c => c.nombre === n).id;
  let r = await crearImpresora({ nombre: 'Cocina', tipo: 'red', destino: cocina.destino, categorias: [cat('Entradas'), cat('Platos Principales')] });
  assert.equal(r[0], 201); idCocina = r[1].id;
  r = await crearImpresora({ nombre: 'Barra', tipo: 'red', destino: barra.destino, ancho: 58, categorias: [cat('Bebidas')] });
  assert.equal(r[0], 201); idBarra = r[1].id;
  r = await crearImpresora({ nombre: 'Caja', tipo: 'red', destino: caja.destino, imprime_comandas: false, imprime_tickets: true });
  assert.equal(r[0], 201); idCaja = r[1].id;
  const [, lista] = await s.llamar('GET', '/api/impresoras', undefined, s.tokenAdmin);
  assert.equal(lista.length, 3);
});

test('impresión de prueba con acentos en PC850', async () => {
  const [, r] = await s.llamar('POST', `/api/impresoras/${idCocina}/prueba`, undefined, s.tokenAdmin);
  assert.equal(r.ok, true);
  await esperarTrabajos(cocina, 1);
  const t = cocina.texto(0);
  assert.ok(t.startsWith('\x1b@\x1bt\x02'), 'inicializa e indica la página PC850');
  assert.ok(t.includes('PRUEBA'));
  assert.ok(t.includes('Acentos: \xa0\x82\xa1\xa2\xa3'), 'áéíóú en PC850');
  assert.ok(t.includes(CUT), 'corta el papel');
  cocina.trabajos.length = 0;
});

test('una impresora apagada da un error claro y queda registrado', async () => {
  const cerrada = await impresoraFalsa();
  await cerrada.cerrar(); // puerto sin nadie escuchando
  const [, imp] = await crearImpresora({ nombre: 'Apagada', tipo: 'red', destino: cerrada.destino, activa: false });
  const [, r] = await s.llamar('POST', `/api/impresoras/${imp.id}/prueba`, undefined, s.tokenAdmin);
  assert.equal(r.ok, false);
  assert.match(r.message, /No se pudo conectar/);
  const [fila] = await s.q('SELECT estado, error FROM impresiones WHERE impresora_id = ? ORDER BY id DESC LIMIT 1', [imp.id]);
  assert.equal(fila.estado, 'error');
});

let pedidoId;
test('la comanda sale en cada estación solo con sus productos', async () => {
  const [st, p] = await s.llamar('POST', '/api/pedidos', {
    tipo: 'salon', mesa_id: 1, notas: 'Sin sal',
    items: [
      { producto_id: productos['Milanesa con papas'], cantidad: 2, notas: 'Una sin papas' },
      { producto_id: productos['Café Expresso'], cantidad: 1 }
    ]
  }, s.tokenVendedor);
  assert.equal(st, 201);
  assert.equal(p.impresion_comanda, true, 'el POS no necesita imprimir por el navegador');
  pedidoId = p.id;
  await esperarTrabajos(cocina, 1);
  await esperarTrabajos(barra, 1);

  const tc = cocina.texto(0);
  assert.ok(tc.includes('COMANDA') && tc.includes('MESA 1'));
  assert.ok(tc.includes('2 x Milanesa con papas') && tc.includes('>> Una sin papas'));
  assert.ok(!tc.includes('Caf'), 'el café no va a cocina');
  assert.ok(tc.includes('NOTA: Sin sal'));

  const tb = barra.texto(0);
  assert.ok(tb.includes('1 x Caf\x82 Expresso'), 'el café va a barra (é en PC850)');
  assert.ok(!tb.includes('Milanesa'));
  assert.ok(tb.includes('-'.repeat(32) + '\n') && !tb.includes('-'.repeat(33)), 'barra usa 32 columnas (58 mm)');
  assert.equal(caja.trabajos.length, 0, 'la caja no imprime comandas');
});

test('los ítems agregados seguidos salen en un solo "AGREGADO"', async () => {
  await s.llamar('POST', `/api/pedidos/${pedidoId}/items`, { producto_id: productos['Ensalada César'], cantidad: 1 }, s.tokenVendedor);
  await s.llamar('POST', `/api/pedidos/${pedidoId}/items`, { producto_id: productos['Bondiola de cerdo'], cantidad: 1, notas: 'Jugosa' }, s.tokenVendedor);
  await esperarTrabajos(cocina, 2);
  const t = cocina.texto(1);
  assert.ok(t.includes('AGREGADO'));
  assert.ok(t.includes('1 x Ensalada C\x82sar') && t.includes('1 x Bondiola de cerdo'));
  assert.ok(!t.includes('Milanesa'), 'solo lo agregado');
  await esperar(500);
  assert.equal(barra.trabajos.length, 1, 'barra no recibe nada (no hay bebidas nuevas)');
});

test('ticket: precuenta a pedido y ticket al cobrar con cajón', async () => {
  const [, pre] = await s.llamar('POST', `/api/pedidos/${pedidoId}/imprimir/ticket`, undefined, s.tokenVendedor);
  assert.equal(pre.ok, true);
  await esperarTrabajos(caja, 1);
  assert.ok(caja.texto(0).includes('PRECUENTA') && caja.texto(0).includes('TOTAL'));

  await s.q("UPDATE configuracion SET nombre_negocio = 'La Buena Mesa', cuit = '20-12345678-9' WHERE id = 1");
  await s.llamar('PUT', '/api/impresion/config', { ticket_al_cobrar: true, abrir_cajon: true, pie: 'Volvé pronto' }, s.tokenAdmin);
  const [, ped] = await s.llamar('GET', `/api/pedidos/${pedidoId}`, undefined, s.tokenVendedor);
  const [st, cobro] = await s.llamar('POST', `/api/pedidos/${pedidoId}/pagar`, { metodo: 'efectivo', monto: ped.total + 1000 }, s.tokenVendedor);
  assert.equal(st, 200);
  assert.equal(cobro.impresion_ticket, true);
  await esperarTrabajos(caja, 2);
  const t = caja.texto(1);
  assert.ok(t.includes('La Buena Mesa') && t.includes('CUIT: 20-12345678-9'));
  assert.ok(t.includes('2 x Milanesa con papas') && t.includes('TOTAL'));
  assert.ok(t.includes('Pago Efectivo') && t.includes('Vuelto'));
  assert.ok(t.includes('Volv\x82 pronto') && t.includes('no v\xa0lido como factura'));
  assert.ok(!t.includes('PRECUENTA'));
  assert.ok(t.includes(CAJON), 'abre el cajón al cobrar en efectivo');
});

test('cancelar un pedido imprime "ANULADO" en las estaciones', async () => {
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: productos['Café Expresso'], cantidad: 2 }] }, s.tokenVendedor);
  await esperarTrabajos(barra, 2);
  await s.llamar('PUT', `/api/pedidos/${p.id}/cancelar`, {}, s.tokenVendedor);
  await esperarTrabajos(barra, 3);
  assert.ok(barra.texto(2).includes('ANULADO') && barra.texto(2).includes('2 x Caf\x82 Expresso'));
});

test('reimprimir comanda y sin impresión automática si está desactivada', async () => {
  const previos = cocina.trabajos.length + barra.trabajos.length;
  const [, r] = await s.llamar('POST', `/api/pedidos/${pedidoId}/imprimir/comanda`, undefined, s.tokenVendedor);
  assert.deepEqual(r.resultados.map(x => x.impresora).sort(), ['Barra', 'Cocina']);
  for (let t = 0; t < 3000 && cocina.trabajos.length + barra.trabajos.length < previos + 2; t += 50) await esperar(50);
  assert.equal(cocina.trabajos.length + barra.trabajos.length, previos + 2, 'reimpresión en las dos estaciones');

  await s.q('UPDATE configuracion SET activar_impresion = 0');
  const antes = cocina.trabajos.length + barra.trabajos.length;
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: productos['Milanesa con papas'], cantidad: 1 }] }, s.tokenVendedor);
  assert.equal(p.impresion_comanda, false);
  await esperar(800);
  assert.equal(cocina.trabajos.length + barra.trabajos.length, antes, 'con la impresión automática desactivada no sale nada');
  await s.q('UPDATE configuracion SET activar_impresion = 1');
});

test('USB en Windows: error claro si la impresora no está instalada', { skip: process.platform !== 'win32' }, async () => {
  const [, imp] = await crearImpresora({ nombre: 'USB inexistente', tipo: 'usb', destino: 'Impresora Que No Existe 123', activa: false });
  const [, r] = await s.llamar('POST', `/api/impresoras/${imp.id}/prueba`, undefined, s.tokenAdmin);
  assert.equal(r.ok, false);
  assert.match(r.message, /No se encontró la impresora 'Impresora Que No Existe 123'/);
});
