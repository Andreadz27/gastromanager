'use strict';
const {
  errorInterno, autenticar, requiere, fechaLocal, miFichaje, fichar, fichajesDelPeriodo, horasPorPersona, corregirFichaje,
  cargarFichaje, listarTurnos, guardarTurno, borrarTurno, copiarSemana, propinasDelPeriodo, calcularReparto, guardarReparto,
  listarRepartos, pagarReparto, anularReparto, all
} = require('../contexto');

module.exports = function registrarRutas(app) {

// ============ PERSONAL ============
// Fichar y ver lo propio: cualquier usuario. Lo del equipo: permiso "personal" (encargado y administrador).

const ruta = fn => async (req, res) => { try { await fn(req, res); } catch (err) { errorInterno(res, err); } };
// Período de la consulta; por defecto, los últimos 7 días
const periodo = q => ({ desde: q.desde || fechaLocal(6), hasta: q.hasta || fechaLocal() });

app.get('/api/personal/mi-fichaje', autenticar, ruta(async (req, res) => {
  res.json(await miFichaje(req.usuario.id));
}));

app.post('/api/personal/fichar', autenticar, ruta(async (req, res) => {
  res.json(await fichar(req.usuario.id));
}));

app.get('/api/personal/mis-turnos', autenticar, ruta(async (req, res) => {
  const { desde, hasta } = periodo({ desde: req.query.desde || fechaLocal(), hasta: req.query.hasta || fechaLocal(-13) });
  res.json(await listarTurnos(desde, hasta, req.usuario.id));
}));

app.get('/api/personal/mis-fichajes', autenticar, ruta(async (req, res) => {
  const { desde, hasta } = periodo(req.query);
  res.json(await fichajesDelPeriodo(desde, hasta, req.usuario.id));
}));

// ---- Equipo ----

app.get('/api/personal/empleados', autenticar, requiere('personal'), ruta(async (req, res) => {
  res.json(await all('SELECT id, nombre, rol FROM usuarios WHERE activo = 1 ORDER BY nombre'));
}));

app.get('/api/personal/fichajes', autenticar, requiere('personal'), ruta(async (req, res) => {
  const { desde, hasta } = periodo(req.query);
  res.json({ fichajes: await fichajesDelPeriodo(desde, hasta, req.query.usuario_id ? Number(req.query.usuario_id) : null),
    horas: await horasPorPersona(desde, hasta) });
}));

app.post('/api/personal/fichajes', autenticar, requiere('personal'), ruta(async (req, res) => {
  res.status(201).json(await cargarFichaje(req.body || {}, req.usuario.id));
}));

app.put('/api/personal/fichajes/:id', autenticar, requiere('personal'), ruta(async (req, res) => {
  res.json(await corregirFichaje(Number(req.params.id), req.body || {}, req.usuario.id));
}));

app.get('/api/personal/turnos', autenticar, requiere('personal'), ruta(async (req, res) => {
  const { desde, hasta } = periodo(req.query);
  res.json(await listarTurnos(desde, hasta));
}));

app.post('/api/personal/turnos', autenticar, requiere('personal'), ruta(async (req, res) => {
  res.status(201).json(await guardarTurno(req.body || {}, req.usuario.id));
}));

app.put('/api/personal/turnos/:id', autenticar, requiere('personal'), ruta(async (req, res) => {
  res.json(await guardarTurno(req.body || {}, req.usuario.id, Number(req.params.id)));
}));

app.delete('/api/personal/turnos/:id', autenticar, requiere('personal'), ruta(async (req, res) => {
  await borrarTurno(Number(req.params.id));
  res.json({ ok: true });
}));

app.post('/api/personal/turnos/copiar-semana', autenticar, requiere('personal'), ruta(async (req, res) => {
  res.status(201).json(await copiarSemana(req.body && req.body.desde, req.usuario.id));
}));

// ---- Propinas ----

app.get('/api/personal/propinas', autenticar, requiere('personal'), ruta(async (req, res) => {
  const { desde, hasta } = periodo(req.query);
  res.json({ desde, hasta, total: await propinasDelPeriodo(desde, hasta), repartos: await listarRepartos() });
}));

// Vista previa: lo que le toca a cada uno (no guarda nada)
app.post('/api/personal/propinas/calcular', autenticar, requiere('personal'), ruta(async (req, res) => {
  res.json(await calcularReparto(req.body || {}));
}));

app.post('/api/personal/propinas/repartos', autenticar, requiere('personal'), ruta(async (req, res) => {
  res.status(201).json(await guardarReparto(req.body || {}, req.usuario.id));
}));

app.post('/api/personal/propinas/repartos/:id/pagar', autenticar, requiere('personal'), ruta(async (req, res) => {
  res.json(await pagarReparto(Number(req.params.id), req.body && req.body.medio, req.usuario.id));
}));

app.post('/api/personal/propinas/repartos/:id/anular', autenticar, requiere('personal'), ruta(async (req, res) => {
  res.json(await anularReparto(Number(req.params.id), req.usuario.id));
}));

};
