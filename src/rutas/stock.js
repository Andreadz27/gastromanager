'use strict';
const {
  run, get, all, transaccion, errorHttp, errorInterno, autenticar, emitEvento, requiere
} = require('../contexto');

module.exports = function registrarRutas(app) {

// ============ STOCK Y MOVIMIENTOS ============

app.get('/api/stock', autenticar, requiere('stock.ver'), async (req, res) => {
  try {
    const stock = await all(`
      SELECT p.id, p.nombre, p.stock_actual, p.stock_minimo, p.unidad, c.nombre as categoria_nombre,
        CASE WHEN p.stock_actual <= p.stock_minimo THEN 'bajo'
             WHEN p.stock_actual <= p.stock_minimo * 1.5 THEN 'medio'
             ELSE 'ok' END as nivel
      FROM productos p
      LEFT JOIN categorias c ON p.categoria_id = c.id
      WHERE p.tracking_stock = 1 AND p.activo = 1
      ORDER BY nivel DESC, p.nombre
    `);
    res.json(stock);
  } catch (err) {
    errorInterno(res, err);
  }
});

app.get('/api/stock/movimientos', autenticar, requiere('stock.ver'), async (req, res) => {
  try {
    const movimientos = await all(`
      SELECT ms.*, p.nombre as producto_nombre, u.nombre as usuario_nombre
      FROM movimientos_stock ms
      JOIN productos p ON ms.producto_id = p.id
      LEFT JOIN usuarios u ON ms.usuario_id = u.id
      ORDER BY ms.fecha DESC
      LIMIT 100
    `);
    res.json(movimientos);
  } catch (err) {
    errorInterno(res, err);
  }
});

app.post('/api/stock/movimiento', autenticar, requiere('stock.mover'), async (req, res) => {
  try {
    const { producto_id, tipo, motivo } = req.body;
    // Se convierte a número: "5" + 3 concatenaba texto y corrompía el stock
    const cantidad = Number(req.body.cantidad);
    if (!Number.isFinite(cantidad) || cantidad <= 0)
      return res.status(400).json({ error: 'Cantidad inválida' });
    const delta = tipo === 'entrada' ? cantidad : -cantidad;

    const nuevoStock = await transaccion(async () => {
      const producto = await get('SELECT id FROM productos WHERE id = ?', [producto_id]);
      if (!producto) throw errorHttp(404, 'Producto no encontrado');
      // Actualización relativa: no pisa ventas que ocurran al mismo tiempo
      await run('UPDATE productos SET stock_actual = stock_actual + ? WHERE id = ?', [delta, producto_id]);
      await run('INSERT INTO movimientos_stock (producto_id, tipo, cantidad, motivo, usuario_id) VALUES (?, ?, ?, ?, ?)',
        [producto_id, tipo, cantidad, motivo || '', req.usuario.id]);
      return (await get('SELECT stock_actual FROM productos WHERE id = ?', [producto_id])).stock_actual;
    });
    emitEvento('stock:actualizar', { producto_id: Number(producto_id), accion: 'movimiento' });
    res.json({ message: 'Movimiento registrado', nuevo_stock: nuevoStock });
  } catch (err) {
    errorInterno(res, err);
  }
});

};
