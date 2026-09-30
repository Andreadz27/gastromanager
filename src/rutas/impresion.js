'use strict';
const {
  run, get, all, errorHttp, errorInterno, autenticar, esAdmin, getIntCfg, setIntCfg,
  listarImpresorasSistema, leerImpresora, opcionesImpresion, OPCIONES_POR_DEFECTO,
  imprimirComanda, imprimirTicket, imprimirPrueba
} = require('../contexto');

// Valida los datos de una impresora (en edición, lo que no viene conserva su valor)
function datosImpresora(body, actual = {}) {
  const v = campo => body[campo] !== undefined ? body[campo] : actual[campo];
  const nombre = String(v('nombre') || '').trim();
  if (!nombre) throw errorHttp(400, 'Poné un nombre a la impresora (ej. Cocina, Barra, Caja)');
  const tipo = v('tipo') || 'red';
  if (!['red', 'usb'].includes(tipo)) throw errorHttp(400, 'Tipo de impresora inválido');
  const destino = String(v('destino') || '').trim();
  if (!destino) throw errorHttp(400, tipo === 'red' ? 'Indicá la IP de la impresora' : 'Elegí la impresora instalada');
  if (tipo === 'red' && !/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(destino))
    throw errorHttp(400, 'La dirección debe ser una IP o nombre, con puerto opcional (ej. 192.168.0.50:9100)');
  const ancho = Number(v('ancho') || 80);
  if (![58, 80].includes(ancho)) throw errorHttp(400, 'El ancho del papel debe ser 58 u 80 mm');
  let categorias = v('categorias');
  if (typeof categorias === 'string') { try { categorias = JSON.parse(categorias); } catch (e) { categorias = []; } }
  categorias = (Array.isArray(categorias) ? categorias : []).map(Number).filter(n => Number.isInteger(n) && n > 0);
  const comandas = v('imprime_comandas') === undefined ? 1 : (v('imprime_comandas') ? 1 : 0);
  const tickets = v('imprime_tickets') ? 1 : 0;
  if (!comandas && !tickets) throw errorHttp(400, 'Elegí si la impresora imprime comandas, tickets o ambos');
  return {
    nombre, tipo, destino, ancho,
    imprime_comandas: comandas, imprime_tickets: tickets,
    categorias: JSON.stringify(categorias),
    copias: Math.max(1, Math.min(5, parseInt(v('copias'), 10) || 1)),
    activa: v('activa') === undefined ? 1 : (v('activa') ? 1 : 0)
  };
}

module.exports = function registrarRutas(app) {

// ============ IMPRESORAS (configuración, solo admin) ============

app.get('/api/impresoras', autenticar, esAdmin, async (req, res) => {
  try {
    const impresoras = (await all('SELECT * FROM impresoras ORDER BY id')).map(leerImpresora);
    // Último resultado de cada impresora (para mostrar si está funcionando)
    for (const imp of impresoras) {
      imp.ultima_impresion = await get('SELECT estado, error, fecha, tipo FROM impresiones WHERE impresora_id = ? ORDER BY id DESC LIMIT 1', [imp.id]) || null;
    }
    res.json(impresoras);
  } catch (err) { errorInterno(res, err); }
});

// Impresoras instaladas en esta computadora (para elegir una USB)
app.get('/api/impresoras/sistema', autenticar, esAdmin, async (req, res) => {
  try { res.json(await listarImpresorasSistema()); } catch (err) { errorInterno(res, err); }
});

app.post('/api/impresoras', autenticar, esAdmin, async (req, res) => {
  try {
    const d = datosImpresora(req.body || {});
    const r = await run(`INSERT INTO impresoras (nombre, tipo, destino, ancho, imprime_comandas, imprime_tickets, categorias, copias, activa)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [d.nombre, d.tipo, d.destino, d.ancho, d.imprime_comandas, d.imprime_tickets, d.categorias, d.copias, d.activa]);
    await run('INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, ?, ?)', [req.usuario.id, 'impresora', `Impresora creada: ${d.nombre}`]);
    res.status(201).json({ id: r.id, message: 'Impresora agregada' });
  } catch (err) { errorInterno(res, err); }
});

app.put('/api/impresoras/:id', autenticar, esAdmin, async (req, res) => {
  try {
    const actual = await get('SELECT * FROM impresoras WHERE id = ?', [req.params.id]);
    if (!actual) return res.status(404).json({ error: 'Impresora no encontrada' });
    const d = datosImpresora(req.body || {}, leerImpresora(actual));
    await run(`UPDATE impresoras SET nombre = ?, tipo = ?, destino = ?, ancho = ?, imprime_comandas = ?, imprime_tickets = ?,
      categorias = ?, copias = ?, activa = ? WHERE id = ?`,
      [d.nombre, d.tipo, d.destino, d.ancho, d.imprime_comandas, d.imprime_tickets, d.categorias, d.copias, d.activa, actual.id]);
    res.json({ message: 'Impresora actualizada' });
  } catch (err) { errorInterno(res, err); }
});

app.delete('/api/impresoras/:id', autenticar, esAdmin, async (req, res) => {
  try {
    const { changes } = await run('DELETE FROM impresoras WHERE id = ?', [req.params.id]);
    if (!changes) return res.status(404).json({ error: 'Impresora no encontrada' });
    res.json({ message: 'Impresora eliminada' });
  } catch (err) { errorInterno(res, err); }
});

// Imprime una hoja de prueba y devuelve el resultado (para configurar la impresora)
app.post('/api/impresoras/:id/prueba', autenticar, esAdmin, async (req, res) => {
  try {
    const impresora = await get('SELECT * FROM impresoras WHERE id = ?', [req.params.id]);
    if (!impresora) return res.status(404).json({ error: 'Impresora no encontrada' });
    const r = await imprimirPrueba(impresora);
    res.json(r.ok ? { ok: true, message: `Prueba enviada a ${impresora.nombre}` } : { ok: false, message: r.error });
  } catch (err) { errorInterno(res, err); }
});

// Opciones generales de impresión
app.get('/api/impresion/config', autenticar, esAdmin, async (req, res) => {
  try { res.json(await opcionesImpresion()); } catch (err) { errorInterno(res, err); }
});

app.put('/api/impresion/config', autenticar, esAdmin, async (req, res) => {
  try {
    const actual = await getIntCfg('impresion');
    const b = req.body || {};
    const nueva = {
      ...OPCIONES_POR_DEFECTO, ...actual,
      ...(b.ticket_al_cobrar !== undefined ? { ticket_al_cobrar: !!b.ticket_al_cobrar } : {}),
      ...(b.abrir_cajon !== undefined ? { abrir_cajon: !!b.abrir_cajon } : {}),
      ...(b.pie !== undefined ? { pie: String(b.pie).slice(0, 200) } : {})
    };
    await setIntCfg('impresion', nueva);
    res.json(nueva);
  } catch (err) { errorInterno(res, err); }
});

// Registro de impresiones (para revisar fallas)
app.get('/api/impresiones', autenticar, esAdmin, async (req, res) => {
  try {
    res.json(await all('SELECT * FROM impresiones ORDER BY id DESC LIMIT 100'));
  } catch (err) { errorInterno(res, err); }
});

// ============ IMPRIMIR (cualquier usuario) ============

// Reimprimir la comanda completa de un pedido
app.post('/api/pedidos/:id/imprimir/comanda', autenticar, async (req, res) => {
  try {
    const pedido = await get('SELECT id FROM pedidos WHERE id = ?', [req.params.id]);
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
    const resultados = await imprimirComanda(pedido.id, { titulo: 'COMANDA' });
    if (!resultados.length) return res.status(400).json({ error: 'No hay impresoras de comandas configuradas', sin_impresoras: true });
    res.json({ ok: resultados.every(r => r.ok), resultados });
  } catch (err) { errorInterno(res, err); }
});

// Imprimir el ticket del cliente (precuenta si está abierto, comprobante si está cobrado)
app.post('/api/pedidos/:id/imprimir/ticket', autenticar, async (req, res) => {
  try {
    const pedido = await get('SELECT id FROM pedidos WHERE id = ?', [req.params.id]);
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
    const resultados = await imprimirTicket(pedido.id);
    if (!resultados.length) return res.status(400).json({ error: 'No hay impresoras de tickets configuradas', sin_impresoras: true });
    res.json({ ok: resultados.every(r => r.ok), resultados });
  } catch (err) { errorInterno(res, err); }
});

};
