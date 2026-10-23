// Personal: fichar entrada y salida, fichadas del equipo y correcciones, turnos con llegadas tarde
// y reparto de propinas (por horas o partes iguales) con su pago desde la caja y su asiento contable.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciarServidor } = require('./helpers');
const { offsetZonaMin, fechaLocal } = require('../src/tiempo');

let s, mozo, mozoId, cocinero, cocineroId, prod;
const hoy = fechaLocal();
// Las fichadas de prueba van ayer: con horarios de hoy, los tests fallarían según la hora a la que se corren
const ayer = fechaLocal(1);
// Hora del negocio "AAAA-MM-DD HH:MM" → como la guarda la base (UTC)
const utc = (fecha, hora) => {
  const comoUtc = new Date(`${fecha}T${hora}:00Z`);
  return new Date(comoUtc.getTime() - offsetZonaMin(comoUtc) * 60000).toISOString().slice(0, 19).replace('T', ' ');
};

async function nuevoUsuario(nombre, email, rol) {
  const hash = require('bcryptjs').hashSync('clave1234', 4);
  await s.q('INSERT INTO usuarios (nombre, email, password, rol, debe_cambiar_password) VALUES (?, ?, ?, ?, 0)', [nombre, email, hash, rol]);
  const [{ id }] = await s.q('SELECT id FROM usuarios WHERE email = ?', [email]);
  return [s.token(id), id];
}

before(async () => {
  s = await iniciarServidor();
  [mozo, mozoId] = await nuevoUsuario('Lucas Mozo', 'lucas-p@test.com', 'mozo');
  [cocinero, cocineroId] = await nuevoUsuario('Vale Cocina', 'vale-p@test.com', 'cocina');
  [prod] = await s.q('SELECT id FROM productos WHERE activo = 1 ORDER BY id LIMIT 1');
  await s.q('UPDATE productos SET precio_venta = 1000 WHERE id = ?', [prod.id]);
});
after(() => s.cerrar());

test('fichar: entrada, doble toque sin efecto y salida', async () => {
  let [st, f] = await s.llamar('POST', '/api/personal/fichar', {}, mozo);
  assert.equal(st, 200);
  assert.equal(f.adentro, true);
  // Doble toque: sigue adentro
  [, f] = await s.llamar('POST', '/api/personal/fichar', {}, mozo);
  assert.deepEqual([f.adentro, f.repetido], [true, true]);
  // Cinco minutos después ficha la salida
  await s.q("UPDATE fichajes SET entrada = datetime('now', '-5 minutes') WHERE usuario_id = ?", [mozoId]);
  [, f] = await s.llamar('POST', '/api/personal/fichar', {}, mozo);
  assert.equal(f.adentro, false);
  assert.ok(f.horas_hoy >= 0 && f.horas_hoy < 0.2, `horas: ${f.horas_hoy}`);
  const [, mias] = await s.llamar('GET', '/api/personal/mis-fichajes', null, mozo);
  assert.equal(mias.length, 1);
  assert.equal((await s.q('SELECT COUNT(*) n FROM fichajes WHERE usuario_id = ? AND salida IS NULL', [mozoId]))[0].n, 0);
});

test('permisos: cada uno ficha lo suyo; el equipo lo ve el encargado o el administrador', async () => {
  assert.equal((await s.llamar('GET', '/api/personal/fichajes', null, mozo))[0], 403);
  assert.equal((await s.llamar('GET', '/api/personal/mi-fichaje', null, cocinero))[0], 200, 'cocina también ficha');
  assert.equal((await s.llamar('POST', '/api/personal/turnos', { usuario_id: mozoId, fecha: hoy, inicio: '10:00', fin: '18:00' }, mozo))[0], 403);
  assert.equal((await s.llamar('GET', '/api/personal/propinas', null, s.tokenVendedor))[0], 403, 'el cajero tampoco');
  const [, roles] = await s.llamar('GET', '/api/roles', null, s.tokenAdmin);
  const permisos = rol => roles.find(r => r.id === rol).permisos.map(p => p.id);
  assert.ok(permisos('encargado').includes('personal'));
  assert.ok(!permisos('mozo').includes('personal'));
});

test('el encargado corrige una fichada con motivo y carga una que se olvidaron', async () => {
  const [, d] = await s.llamar('GET', `/api/personal/fichajes?desde=${ayer}&hasta=${hoy}`, null, s.tokenAdmin);
  const f = d.fichajes.find(x => x.usuario_id === mozoId);
  assert.equal((await s.llamar('PUT', `/api/personal/fichajes/${f.id}`, { entrada: `${ayer}T09:00`, salida: `${ayer}T15:00` }, s.tokenAdmin))[0], 400, 'sin motivo');
  assert.equal((await s.llamar('PUT', `/api/personal/fichajes/${f.id}`, { entrada: `${ayer}T15:00`, salida: `${ayer}T09:00`, motivo: 'x' }, s.tokenAdmin))[0], 400, 'salida antes');
  const [st, c] = await s.llamar('PUT', `/api/personal/fichajes/${f.id}`, { entrada: `${ayer}T09:00`, salida: `${ayer}T15:00`, motivo: 'Fichó tarde la salida' }, s.tokenAdmin);
  assert.equal(st, 200, JSON.stringify(c));
  assert.deepEqual([c.horas, c.entrada, c.motivo_correccion], [6, utc(ayer, '09:00'), 'Fichó tarde la salida']);
  assert.equal(c.entrada_local.slice(11, 16), '09:00');
  const [cargada] = (await s.llamar('POST', '/api/personal/fichajes',
    { usuario_id: cocineroId, entrada: `${ayer}T08:00`, salida: `${ayer}T10:00`, motivo: 'Se olvidó de fichar' }, s.tokenAdmin)).slice(1);
  assert.equal(cargada.horas, 2);
  assert.equal((await s.llamar('POST', '/api/personal/fichajes',
    { usuario_id: cocineroId, entrada: `${ayer}T08:00`, salida: `${ayer}T10:00` }, s.tokenAdmin))[0], 400, 'sin motivo');
  // Una salida a futuro dejaba al empleado sin poder fichar hasta esa hora (el doble toque la tomaba como reciente)
  const manana = fechaLocal(-1);
  assert.equal((await s.llamar('POST', '/api/personal/fichajes',
    { usuario_id: cocineroId, entrada: `${manana}T08:00`, salida: `${manana}T10:00`, motivo: 'x' }, s.tokenAdmin))[0], 400, 'horario futuro');
  const audit = await s.q("SELECT accion FROM auditoria WHERE accion IN ('fichaje_corregido', 'fichaje_cargado')");
  assert.equal(audit.length, 2);
  const [, d2] = await s.llamar('GET', `/api/personal/fichajes?desde=${ayer}&hasta=${hoy}`, null, s.tokenAdmin);
  assert.deepEqual(d2.horas.map(h => [h.nombre, h.horas]), [['Lucas Mozo', 6], ['Vale Cocina', 2]]);
});

test('turnos: carga, horario que pasa la medianoche, llegada tarde y copiar la semana', async () => {
  assert.equal((await s.llamar('POST', '/api/personal/turnos', { usuario_id: mozoId, fecha: hoy, inicio: '25:00', fin: '18:00' }, s.tokenAdmin))[0], 400);
  const [st, t] = await s.llamar('POST', '/api/personal/turnos', { usuario_id: mozoId, fecha: ayer, inicio: '08:40', fin: '15:00', puesto: 'Salón' }, s.tokenAdmin);
  assert.equal(st, 201, JSON.stringify(t));
  await s.llamar('POST', '/api/personal/turnos', { usuario_id: cocineroId, fecha: ayer, inicio: '20:00', fin: '02:00' }, s.tokenAdmin);
  const [, lista] = await s.llamar('GET', `/api/personal/turnos?desde=${ayer}&hasta=${hoy}`, null, s.tokenAdmin);
  const deMozo = lista.find(x => x.usuario_id === mozoId);
  assert.deepEqual([deMozo.llegada, deMozo.minutos_tarde], ['09:00', 20], 'fichó 09:00 para un turno de 08:40');
  assert.equal(lista.find(x => x.usuario_id === cocineroId).horas, 6, 'de 20 a 2 son 6 horas');
  // Cada uno ve los suyos
  const [, mios] = await s.llamar('GET', `/api/personal/mis-turnos?desde=${ayer}`, null, mozo);
  assert.deepEqual(mios.map(x => x.usuario_id), [mozoId]);
  // Copiar la semana a la siguiente (una sola vez)
  const [, c] = await s.llamar('POST', '/api/personal/turnos/copiar-semana', { desde: ayer }, s.tokenAdmin);
  assert.equal(c.copiados, 2);
  assert.equal((await s.llamar('POST', '/api/personal/turnos/copiar-semana', { desde: ayer }, s.tokenAdmin))[0], 409);
  assert.equal((await s.llamar('DELETE', `/api/personal/turnos/${t.id}`, null, s.tokenAdmin))[0], 200);
});

test('reparto de propinas por horas: el servidor calcula, la suma da exacto y no se reparte dos veces', async () => {
  // Dos cobros con propina: $300 y $100,01
  for (const propina of [300, 100.01]) {
    const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: prod.id, cantidad: 1 }] }, s.tokenVendedor);
    const [st] = await s.llamar('POST', `/api/pedidos/${p.id}/cobro`, { propina, pagos: [{ metodo: 'efectivo', monto: 1000 + propina }] }, s.tokenVendedor);
    assert.equal(st, 200);
  }
  const [, prop] = await s.llamar('GET', `/api/personal/propinas?desde=${ayer}&hasta=${hoy}`, null, s.tokenAdmin);
  assert.equal(prop.total, 400.01);

  const [, calc] = await s.llamar('POST', '/api/personal/propinas/calcular', { desde: ayer, hasta: hoy, metodo: 'horas' }, s.tokenAdmin);
  assert.deepEqual(calc.participantes.map(p => [p.nombre, p.horas, p.monto]), [['Lucas Mozo', 6, 300.01], ['Vale Cocina', 2, 100]]);
  const [, iguales] = await s.llamar('POST', '/api/personal/propinas/calcular', { desde: ayer, hasta: hoy, metodo: 'iguales', usuarios: [mozoId, cocineroId, s.vendedorId] }, s.tokenAdmin);
  assert.equal(iguales.participantes.length, 3);
  assert.equal(Math.round(iguales.participantes.reduce((t, p) => t + p.monto, 0) * 100), 40001, 'los centavos no se pierden');

  // Los montos que mande el navegador no cuentan
  const [st, r] = await s.llamar('POST', '/api/personal/propinas/repartos', { desde: ayer, hasta: hoy, metodo: 'horas', total: 999999,
    participantes: [{ usuario_id: mozoId, monto: 999999 }] }, s.tokenAdmin);
  assert.equal(st, 201, JSON.stringify(r));
  assert.equal(r.total, 400.01);
  assert.deepEqual(r.detalle.map(p => p.monto), [300.01, 100]);
  assert.equal((await s.llamar('POST', '/api/personal/propinas/repartos', { desde: ayer, hasta: hoy, metodo: 'horas' }, s.tokenAdmin))[0], 409, 'período ya repartido');
});

test('pagar el reparto en efectivo sale de la caja y en contabilidad cancela la deuda (no es gasto)', async () => {
  const [, { repartos: [r] }] = await s.llamar('GET', `/api/personal/propinas?desde=${ayer}&hasta=${hoy}`, null, s.tokenAdmin);
  const [st, e] = await s.llamar('POST', `/api/personal/propinas/repartos/${r.id}/pagar`, { medio: 'efectivo' }, s.tokenAdmin);
  assert.equal(st, 400, 'sin caja abierta');
  assert.match(e.error, /caja abierta/);
  assert.equal((await s.llamar('POST', '/api/caja/abrir', { monto_inicial: 5000 }, s.tokenAdmin))[0], 201);
  const [stP, pagado] = await s.llamar('POST', `/api/personal/propinas/repartos/${r.id}/pagar`, { medio: 'efectivo' }, s.tokenAdmin);
  assert.equal(stP, 200, JSON.stringify(pagado));
  assert.deepEqual([pagado.estado, pagado.medio_pago, pagado.pagado_en], ['pagado', 'efectivo', hoy]);
  const [mov] = await s.q('SELECT tipo, monto, concepto FROM movimientos_caja WHERE id = ?', [pagado.caja_movimiento_id]);
  assert.deepEqual([mov.tipo, mov.monto], ['egreso', 400.01]);
  assert.match(mov.concepto, /Pago de propinas/);
  assert.equal((await s.llamar('POST', `/api/personal/propinas/repartos/${r.id}/pagar`, { medio: 'efectivo' }, s.tokenAdmin))[0], 409, 'no se paga dos veces');
  assert.equal((await s.llamar('POST', `/api/personal/propinas/repartos/${r.id}/anular`, {}, s.tokenAdmin))[0], 409, 'pagado no se anula');

  const [, libro] = await s.llamar('GET', `/api/contabilidad/libro-diario?desde=${ayer}&hasta=${hoy}`, null, s.tokenAdmin);
  const pago = libro.asientos.find(a => /Pago de propinas/.test(a.concepto));
  assert.deepEqual(pago.lineas.map(l => [l.codigo, l.debe, l.haber]), [['2.1.03', 400.01, 0], ['1.1.01', 0, 400.01]]);
  assert.ok(!libro.asientos.some(a => /Caja: Pago de propinas/.test(a.concepto)), 'no se asienta además como gasto menor');
  const propinas = libro.balance.find(c => c.codigo === '2.1.03');
  assert.equal(propinas.saldo, 0, 'la deuda con el personal queda en cero');
  assert.equal(libro.total_debe, libro.total_haber);
  const [, res] = await s.llamar('GET', `/api/contabilidad/resultados?desde=${ayer}&hasta=${hoy}`, null, s.tokenAdmin);
  assert.doesNotMatch(JSON.stringify(res), /400\.01/, 'el pago de propinas no es gasto del local');
});
