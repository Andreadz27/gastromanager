// Planes: prueba gratis, Esencial, Pro con licencia firmada, vencimiento con gracia y lo que nunca se corta.
// Se firma con una clave de test (la privada de verdad no está en el repositorio).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { iniciarServidor } = require('./helpers');
const { firmarLicencia } = require('../src/licencia-firma');
const { fechaLocal } = require('../src/tiempo');
const { sumarDias } = require('../src/licencia');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUBLICA = publicKey.export({ type: 'spki', format: 'pem' });
const licencia = datos => firmarLicencia({ cliente: 'test', extras: [], vence: null, ...datos }, privateKey);
let s, mesa;

before(async () => {
  s = await iniciarServidor({ MORFI_LICENCIA_PUBLICA: PUBLICA });
  [mesa] = await s.q('SELECT qr_token FROM mesas ORDER BY id LIMIT 1');
});
after(async () => { if (s) await s.cerrar(); });

const estado = async () => (await s.llamar('GET', '/api/licencia', null, s.tokenAdmin))[1];
const ponerLicencia = async datos => s.llamar('PUT', '/api/licencia', { licencia: licencia(datos) }, s.tokenAdmin);
const sinLicencia = () => s.q("DELETE FROM meta WHERE clave = 'licencia'");
const gastos = () => s.llamar('GET', '/api/contabilidad/gastos', null, s.tokenAdmin);

test('una instalación nueva arranca con 30 días de prueba con todo', async () => {
  const e = await estado();
  assert.equal(e.estado, 'prueba');
  assert.equal(e.vence, sumarDias(fechaLocal(), 30));
  assert.ok(e.modulos.includes('contabilidad') && e.modulos.includes('asistente'));
  assert.equal((await gastos())[0], 200);
  assert.equal(e.planes.prueba, undefined, 'la prueba no se ofrece como plan');
  assert.equal(e.planes.pro.precio, require('../src/planes').PLANES.pro.precio);
});

test('terminada la prueba queda Esencial: lo Pro se bloquea, vender y cobrar sigue igual', async () => {
  await s.q("UPDATE meta SET valor = ? WHERE clave = 'licencia_inicio'", [fechaLocal(40)]);
  const e = await estado();
  assert.equal(e.estado, 'prueba_terminada');
  assert.equal(e.plan, 'esencial');
  assert.match(e.aviso, /Terminó la prueba/);

  const [st, r] = await gastos();
  assert.equal(st, 402);
  assert.match(r.error, /Contabilidad/);
  assert.equal(r.plan_requerido, 'pro');
  assert.equal((await s.llamar('GET', '/api/personal/mi-fichaje', null, s.tokenVendedor))[0], 402);
  assert.equal((await s.llamar('GET', '/api/reportes/rentabilidad', null, s.tokenAdmin))[0], 402);

  // Lo básico: pedido, cobro y cocina
  const [prod] = await s.q('SELECT id, precio_venta FROM productos WHERE activo = 1 LIMIT 1');
  const [sp, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: prod.id, cantidad: 1 }] }, s.tokenVendedor);
  assert.equal(sp, 201);
  const [sc] = await s.llamar('POST', `/api/pedidos/${p.id}/cobro`, { pagos: [{ metodo: 'efectivo', monto: p.total }] }, s.tokenVendedor);
  assert.equal(sc, 200);

  // QR de la mesa: solo carta y llamar al mozo; el mensaje es para el cliente, no habla del plan
  const [, m] = await s.llamar('GET', `/api/publico/mesa/${mesa.qr_token}`);
  assert.equal(m.modo, 'solo_carta');
  assert.equal(m.pago.mercadopago, false);
  const [sm, rm] = await s.llamar('POST', `/api/publico/mesa/${mesa.qr_token}/pedido`, { items: [{ producto_id: prod.id, cantidad: 1 }] });
  assert.equal(sm, 403);
  assert.doesNotMatch(rm.error, /plan/i);
  assert.equal((await s.llamar('POST', `/api/publico/mesa/${mesa.qr_token}/llamar`, { tipo: 'mozo' }))[0], 201);
  assert.equal((await s.llamar('POST', '/api/publico/pedido', { cliente: 'Ana', telefono: '1155556666', items: [] }))[0], 403);
});

test('licencia Pro firmada: vuelve todo lo Pro, el extra del asistente aparte', async () => {
  const [st, e] = await ponerLicencia({ plan: 'pro', vence: sumarDias(fechaLocal(), 60) });
  assert.equal(st, 200);
  assert.equal(e.plan, 'pro');
  assert.equal(e.estado, 'activo');
  assert.equal((await gastos())[0], 200);
  assert.equal((await s.llamar('GET', '/api/asistente/estado', null, s.tokenAdmin))[0], 402, 'el asistente es un extra');
  await ponerLicencia({ plan: 'pro', extras: ['asistente'], vence: sumarDias(fechaLocal(), 60) });
  assert.notEqual((await s.llamar('GET', '/api/asistente/estado', null, s.tokenAdmin))[0], 402);
});

test('vencido: aviso antes, gracia de 10 días con todo, después solo Esencial', async () => {
  let e = (await ponerLicencia({ plan: 'pro', vence: sumarDias(fechaLocal(), 3) }))[1];
  assert.equal(e.estado, 'por_vencer');
  assert.match(e.aviso, /vence en 3 días/);

  e = (await ponerLicencia({ plan: 'pro', vence: fechaLocal(5) }))[1];
  assert.equal(e.estado, 'gracia');
  assert.equal(e.plan, 'pro');
  assert.equal((await gastos())[0], 200);

  e = (await ponerLicencia({ plan: 'pro', vence: fechaLocal(11) }))[1];
  assert.equal(e.estado, 'vencido');
  assert.equal(e.plan, 'esencial');
  assert.equal(e.contratado, 'pro');
  const [st, r] = await gastos();
  assert.equal(st, 402);
  assert.match(r.error, /pausado/);
});

test('una licencia mal firmada o editada no se acepta; solo el admin la carga', async () => {
  const otra = crypto.generateKeyPairSync('ed25519').privateKey;
  const falsa = firmarLicencia({ plan: 'cadenas', vence: null }, otra);
  assert.equal((await s.llamar('PUT', '/api/licencia', { licencia: falsa }, s.tokenAdmin))[0], 400);
  const buena = licencia({ plan: 'esencial', vence: null });
  const [cuerpo, firma] = buena.split('.');
  const editada = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(cuerpo, 'base64url')), plan: 'cadenas' })).toString('base64url') + '.' + firma;
  assert.equal((await s.llamar('PUT', '/api/licencia', { licencia: editada }, s.tokenAdmin))[0], 400);
  assert.equal((await s.llamar('PUT', '/api/licencia', { licencia: buena }, s.tokenVendedor))[0], 403);
  // Editar la base a mano tampoco sirve: se verifica la firma en cada consulta
  await s.q("UPDATE meta SET valor = ? WHERE clave = 'licencia'", [editada]);
  assert.notEqual((await estado()).plan, 'cadenas');
});

test('una instalación que ya vendía antes de los planes sigue con todo', async () => {
  await sinLicencia();
  await s.q("UPDATE meta SET valor = 'heredada' WHERE clave = 'licencia_inicio'");
  const e = await estado();
  assert.equal(e.origen, 'instalacion_anterior');
  assert.equal(e.plan, 'pro');
  assert.equal((await gastos())[0], 200);
});
