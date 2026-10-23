'use strict';
const {
  errorInterno, autenticar, requiere, requiereCobro, configPuntos, asignarCliente, canjearPuntos, quitarCanje, ajustarPuntos,
  movimientosPuntos, guardarCupon, listarCupones, aplicarCupon, quitarCupon, venderGiftCard, consultarGiftCard, listarGiftCards
} = require('../contexto');

module.exports = function registrarRutas(app) {

// ============ FIDELIZACIÓN ============
// Cliente del pedido: quien toma pedidos. Canjear puntos y cupones: quien cobra. Configurar cupones y ajustar
// puntos: catálogo (encargado y administrador). Gift cards: quien cobra.

const ruta = fn => async (req, res) => { try { await fn(req, res); } catch (err) { errorInterno(res, err); } };

app.get('/api/fidelizacion/config', autenticar, ruta(async (req, res) => {
  res.json(await configPuntos());
}));

// ---- En el pedido ----

app.put('/api/pedidos/:id/cliente', autenticar, requiere('pedidos.tomar'), ruta(async (req, res) => {
  res.json({ cliente: await asignarCliente(Number(req.params.id), req.body && req.body.cliente_id ? Number(req.body.cliente_id) : null) });
}));

app.post('/api/pedidos/:id/puntos', autenticar, requiereCobro, ruta(async (req, res) => {
  res.json(await canjearPuntos(Number(req.params.id), req.body && req.body.puntos, req.usuario.id));
}));

app.delete('/api/pedidos/:id/puntos', autenticar, requiereCobro, ruta(async (req, res) => {
  await quitarCanje(Number(req.params.id), req.usuario.id);
  res.json({ ok: true });
}));

app.post('/api/pedidos/:id/cupon', autenticar, requiereCobro, ruta(async (req, res) => {
  res.json(await aplicarCupon(Number(req.params.id), req.body && req.body.codigo));
}));

app.delete('/api/pedidos/:id/cupon', autenticar, requiereCobro, ruta(async (req, res) => {
  await quitarCupon(Number(req.params.id));
  res.json({ ok: true });
}));

// ---- Puntos del cliente ----

app.get('/api/clientes/:id/puntos', autenticar, requiere('clientes'), ruta(async (req, res) => {
  res.json(await movimientosPuntos(Number(req.params.id)));
}));

app.post('/api/clientes/:id/puntos', autenticar, requiere('catalogo'), ruta(async (req, res) => {
  const { puntos, motivo } = req.body || {};
  res.json(await ajustarPuntos(Number(req.params.id), puntos, motivo, req.usuario.id));
}));

// ---- Cupones ----

app.get('/api/fidelizacion/cupones', autenticar, requiere('catalogo'), ruta(async (req, res) => {
  res.json(await listarCupones());
}));

app.post('/api/fidelizacion/cupones', autenticar, requiere('catalogo'), ruta(async (req, res) => {
  res.status(201).json(await guardarCupon(req.body || {}));
}));

app.put('/api/fidelizacion/cupones/:id', autenticar, requiere('catalogo'), ruta(async (req, res) => {
  res.json(await guardarCupon(req.body || {}, Number(req.params.id)));
}));

// ---- Gift cards ----

app.get('/api/fidelizacion/gift-cards', autenticar, requiere('pedidos.cobrar'), ruta(async (req, res) => {
  res.json(await listarGiftCards());
}));

app.post('/api/fidelizacion/gift-cards', autenticar, requiere('pedidos.cobrar'), ruta(async (req, res) => {
  res.status(201).json(await venderGiftCard(req.body || {}, req.usuario.id));
}));

// Saldo de una gift card (al cobrar con ella)
app.get('/api/fidelizacion/gift-cards/:codigo', autenticar, requiereCobro, ruta(async (req, res) => {
  res.json(await consultarGiftCard(req.params.codigo));
}));

};
