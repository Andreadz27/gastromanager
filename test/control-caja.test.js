// Control de caja: PIN de autorización de encargados y arqueo ciego
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { iniciarServidor } = require('./helpers');

let s, prod, tokenEncargado, tokenMozo, encargadoId;
const conPin = pin => ({ 'X-Autorizacion-Pin': pin });
const config = datos => s.llamar('PUT', '/api/config', datos, s.tokenAdmin);
const pedido = async (extra = {}) => {
  const [st, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: prod.id, cantidad: 2 }], ...extra }, s.tokenVendedor);
  assert.equal(st, 201, JSON.stringify(p));
  return p;
};

before(async () => {
  s = await iniciarServidor();
  [prod] = await s.q('SELECT id FROM productos WHERE activo = 1 ORDER BY id LIMIT 1');
  await s.q('UPDATE productos SET precio_venta = 1000 WHERE id = ?', [prod.id]);
  const hash = bcrypt.hashSync('clave1234', 4);
  for (const [nombre, email, rol] of [['Encargada Eva', 'encargada@test.com', 'encargado'], ['Mozo Mario', 'mozo-pin@test.com', 'mozo']])
    await s.q('INSERT INTO usuarios (nombre, email, password, rol, debe_cambiar_password) VALUES (?, ?, ?, ?, 0)', [nombre, email, hash, rol]);
  encargadoId = (await s.q("SELECT id FROM usuarios WHERE email = 'encargada@test.com'"))[0].id;
  tokenEncargado = s.token(encargadoId);
  tokenMozo = s.token((await s.q("SELECT id FROM usuarios WHERE email = 'mozo-pin@test.com'"))[0].id);
});
after(async () => { await s.cerrar(); });

test('PIN: solo encargados y administradores, con su contraseña, de 4 a 6 números y sin repetir', async () => {
  const definir = (token, body) => s.llamar('PUT', '/api/auth/pin', body, token);
  assert.equal((await definir(s.tokenVendedor, { password: 'vendedor123', pin: '1234' }))[0], 403, 'el cajero no tiene PIN');
  assert.match((await definir(tokenEncargado, { password: 'otra', pin: '1234' }))[1].error, /contraseña/);
  assert.match((await definir(tokenEncargado, { password: 'clave1234', pin: '12' }))[1].error, /4 a 6/);
  assert.match((await definir(tokenEncargado, { password: 'clave1234', pin: '12a4' }))[1].error, /4 a 6/);
  assert.equal((await definir(tokenEncargado, { password: 'clave1234', pin: '4321' }))[0], 200);
  await s.q('UPDATE usuarios SET pin_hash = ? WHERE rol = ?', [bcrypt.hashSync('9999', 4), 'admin']);
  assert.match((await definir(tokenEncargado, { password: 'clave1234', pin: '9999' }))[1].error, /otra persona/);
  const [, me] = await s.llamar('GET', '/api/auth/me', null, tokenEncargado);
  assert.equal(me.tiene_pin, true);
  assert.equal((await s.q('SELECT pin_hash FROM usuarios WHERE id = ?', [encargadoId]))[0].pin_hash.startsWith('$2'), true, 'guardado con hash');
});

test('apagado (por defecto): todo funciona como antes, sin pedir PIN', async () => {
  const p = await pedido();
  assert.equal((await s.llamar('PUT', `/api/pedidos/${p.id}/descuento`, { descuento: 100 }, s.tokenVendedor))[0], 200);
  assert.equal((await s.llamar('PUT', `/api/pedidos/${p.id}/cancelar`, {}, s.tokenVendedor))[0], 200);
  assert.equal((await s.llamar('PUT', `/api/pedidos/${(await pedido()).id}/descuento`, { descuento: 100 }, tokenMozo))[0], 403, 'el mozo sigue sin descuentos');
});

test('activado: el cajero necesita el PIN de un encargado para descuentos y cancelaciones', async () => {
  await config({ pin_autorizacion: 1 });
  const p = await pedido();
  const descuento = headers => s.llamar('PUT', `/api/pedidos/${p.id}/descuento`, { descuento: 300 }, s.tokenVendedor, headers);
  let [st, r] = await descuento();
  assert.deepEqual([st, r.requiere_pin], [403, true]);
  [st, r] = await descuento(conPin('0000'));
  assert.deepEqual([st, r.error], [403, 'PIN incorrecto']);
  [st, r] = await descuento(conPin('4321'));
  assert.equal(st, 200, JSON.stringify(r));
  assert.equal(r.total, 1700);
  const [aud] = await s.q("SELECT detalle FROM auditoria WHERE accion = 'autorizacion_pin' ORDER BY id DESC LIMIT 1");
  assert.match(aud.detalle, /Descuento: Vendedor Test autorizado por Encargada Eva/);

  // Descuento al crear el pedido desde el POS
  assert.equal((await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', descuento: 100, items: [{ producto_id: prod.id, cantidad: 1 }] }, s.tokenVendedor))[1].requiere_pin, true);
  assert.equal((await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', descuento: 100, items: [{ producto_id: prod.id, cantidad: 1 }] }, s.tokenVendedor, conPin('9999')))[0], 201, 'también vale el PIN del admin');

  assert.equal((await s.llamar('PUT', `/api/pedidos/${p.id}/cancelar`, {}, s.tokenVendedor))[1].requiere_pin, true);
  assert.equal((await s.llamar('PUT', `/api/pedidos/${p.id}/cancelar`, {}, s.tokenVendedor, conPin('4321')))[0], 200);
});

test('activado: el encargado no necesita PIN y el mozo puede con autorización', async () => {
  const p = await pedido();
  assert.equal((await s.llamar('PUT', `/api/pedidos/${p.id}/descuento`, { descuento: 50 }, tokenEncargado))[0], 200);
  assert.equal((await s.llamar('PUT', `/api/pedidos/${p.id}/descuento`, { descuento: 50 }, tokenMozo))[1].requiere_pin, true);
  assert.equal((await s.llamar('PUT', `/api/pedidos/${p.id}/descuento`, { descuento: 80 }, tokenMozo, conPin('4321')))[0], 200);
});

test('egreso de caja con PIN (el ingreso no lo pide) y anular factura también lo pide', async () => {
  const mov = (tipo, headers) => s.llamar('POST', '/api/caja/movimiento', { tipo, monto: 500, concepto: 'Prueba' }, s.tokenVendedor, headers);
  assert.equal((await s.llamar('POST', '/api/caja/abrir', { monto_inicial: 1000 }, s.tokenVendedor))[0], 201);
  assert.equal((await mov('ingreso'))[0], 201);
  assert.equal((await mov('egreso'))[1].requiere_pin, true);
  assert.equal((await mov('egreso', conPin('4321')))[0], 201);
  const [st, r] = await s.llamar('POST', '/api/integraciones/afip/nota-credito', { comprobante_id: 1, motivo: 'x' }, s.tokenVendedor);
  assert.deepEqual([st, r.requiere_pin], [403, true]);
});

test('5 PIN incorrectos seguidos bloquean al usuario unos minutos, aunque después ponga el correcto', async () => {
  const p = await pedido();
  const intentar = pin => s.llamar('PUT', `/api/pedidos/${p.id}/descuento`, { descuento: 10 }, tokenMozo, conPin(pin));
  for (let i = 0; i < 5; i++) assert.equal((await intentar('1111'))[0], 403);
  const [st, r] = await intentar('4321');
  assert.equal(st, 429);
  assert.match(r.error, /Demasiados/);
  // A los demás usuarios no los bloquea
  assert.equal((await s.llamar('PUT', `/api/pedidos/${p.id}/descuento`, { descuento: 10 }, s.tokenVendedor, conPin('4321')))[0], 200);
});

test('PIN: muchos intentos en paralelo no se saltean el bloqueo, y elegir PIN no sirve para adivinar el de otro', async () => {
  const hash = bcrypt.hashSync('clave1234', 4);
  await s.q("INSERT INTO usuarios (nombre, email, password, rol, debe_cambiar_password) VALUES ('Mozo Rafaga', 'rafaga@test.com', ?, 'mozo', 0)", [hash]);
  const tokenRafaga = s.token((await s.q("SELECT id FROM usuarios WHERE email = 'rafaga@test.com'"))[0].id);
  const p = await pedido();
  const intentos = Array.from({ length: 40 }, (_, i) =>
    s.llamar('PUT', `/api/pedidos/${p.id}/descuento`, { descuento: 10 }, tokenRafaga, conPin(String(5000 + i))));
  const estados = (await Promise.all(intentos)).map(r => r[0]);
  assert.equal(estados.filter(st => st === 403).length, 5, 'solo 5 PIN se llegan a probar');
  assert.equal(estados.filter(st => st === 429).length, 35);

  // El encargado prueba PINs al elegir el suyo: "ya lo usa otra persona" también se bloquea
  await s.q("INSERT INTO usuarios (nombre, email, password, rol, debe_cambiar_password) VALUES ('Enc Curioso', 'curioso@test.com', ?, 'encargado', 0)", [hash]);
  const tokenCurioso = s.token((await s.q("SELECT id FROM usuarios WHERE email = 'curioso@test.com'"))[0].id);
  const definir = pin => s.llamar('PUT', '/api/auth/pin', { password: 'clave1234', pin }, tokenCurioso);
  for (let i = 0; i < 5; i++) assert.equal((await definir('9999'))[0], 400);
  assert.equal((await definir('2468'))[0], 429);
});

test('arqueo ciego: el cajero no ve lo esperado ni la diferencia; el encargado sí', async () => {
  await config({ arqueo_ciego: 1 });
  const p = await pedido();
  await s.llamar('POST', `/api/pedidos/${p.id}/pagar`, { metodo: 'efectivo', monto: 2000 }, s.tokenVendedor);

  const [, cajaCajero] = await s.llamar('GET', '/api/caja/estado', null, s.tokenVendedor);
  assert.equal(cajaCajero.resumen.ciego, true);
  for (const campo of ['efectivo_esperado', 'total_ventas', 'por_metodo', 'ventas_efectivo'])
    assert.equal(cajaCajero.resumen[campo], undefined, campo);
  assert.equal(cajaCajero.resumen.monto_inicial, 1000);
  const [, cajaEncargado] = await s.llamar('GET', '/api/caja/estado', null, tokenEncargado);
  assert.ok(cajaEncargado.resumen.efectivo_esperado > 0);

  const [st, cierre] = await s.llamar('POST', '/api/caja/cerrar', { monto_final_real: 2500 }, s.tokenVendedor);
  assert.equal(st, 200);
  assert.equal(cierre.ciego, true);
  assert.equal(cierre.diferencia, undefined);
  assert.equal(cierre.efectivo_esperado, undefined);
  // El encargado ve el arqueo completo con la diferencia
  const [{ id, diferencia, monto_esperado }] = await s.q('SELECT id, diferencia, monto_esperado FROM caja ORDER BY id DESC LIMIT 1');
  assert.equal(diferencia, 2500 - monto_esperado);
  const [stA, arqueo] = await s.llamar('GET', `/api/caja/${id}/arqueo`, null, tokenEncargado);
  assert.equal(stA, 200);
  assert.equal(arqueo.diferencia, diferencia);
  assert.equal((await s.llamar('GET', `/api/caja/${id}/arqueo`, null, s.tokenVendedor))[0], 403);
});
