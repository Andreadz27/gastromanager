'use strict';
const {
  run, get, all, errorHttp, actualizarParcial, errorInterno, autenticar, esAdmin
} = require('../contexto');

module.exports = function registrarRutas(app) {

// ============ CATEGORIAS ============

app.get('/api/categorias', autenticar, async (req, res) => {
  try {
    const categorias = await all('SELECT * FROM categorias WHERE activo = 1 ORDER BY orden');
    res.json(categorias);
  } catch (err) {
    errorInterno(res, err);
  }
});

app.post('/api/categorias', autenticar, esAdmin, async (req, res) => {
  try {
    const { nombre, descripcion, color, orden } = req.body;
    const result = await run(
      'INSERT INTO categorias (nombre, descripcion, color, orden) VALUES (?, ?, ?, ?)',
      [nombre, descripcion || '', color || '#4CAF50', orden || 0]
    );
    res.status(201).json({ id: result.id, message: 'Categoría creada' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.put('/api/categorias/:id', autenticar, esAdmin, async (req, res) => {
  try {
    await actualizarParcial('categorias', req.params.id, req.body || {}, ['nombre', 'descripcion', 'color', 'orden', 'activo']);
    res.json({ message: 'Categoría actualizada' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.delete('/api/categorias/:id', autenticar, esAdmin, async (req, res) => {
  try {
    await run('UPDATE categorias SET activo = 0 WHERE id = ?', [req.params.id]);
    res.json({ message: 'Categoría desactivada' });
  } catch (err) {
    errorInterno(res, err);
  }
});

// ============ PRODUCTOS ============

app.get('/api/productos', autenticar, async (req, res) => {
  try {
    const productos = await all(`
      SELECT p.*, c.nombre as categoria_nombre, c.color as categoria_color
      FROM productos p
      LEFT JOIN categorias c ON p.categoria_id = c.id
      WHERE p.activo = 1
      ORDER BY c.orden, p.nombre
    `);
    res.json(productos);
  } catch (err) {
    errorInterno(res, err);
  }
});

// Valida y normaliza los datos de un producto. Con "actual" (edición) los campos que
// no vienen en el body conservan su valor: antes se guardaban como NULL y el producto
// editado desaparecía del POS (activo = NULL) y perdía el stock.
async function datosProducto(body, actual = {}) {
  const valor = (campo, porDefecto) => body[campo] !== undefined ? body[campo] : (actual[campo] !== undefined ? actual[campo] : porDefecto);
  const numero = (campo, porDefecto) => {
    const v = valor(campo, porDefecto);
    const n = Number(v);
    if (v === null || v === '' || !Number.isFinite(n) || n < 0) throw errorHttp(400, `Valor inválido en ${campo.replace('_', ' ')}`);
    return n;
  };
  const bandera = (campo, porDefecto) => valor(campo, porDefecto) ? 1 : 0;

  const nombre = String(valor('nombre', '') || '').trim();
  if (!nombre) throw errorHttp(400, 'El nombre es obligatorio');
  if (valor('precio_venta', undefined) === undefined) throw errorHttp(400, 'El precio de venta es obligatorio');

  let categoriaId = valor('categoria_id', null);
  if (categoriaId === '' || Number.isNaN(Number(categoriaId))) categoriaId = null;
  if (categoriaId !== null) {
    const cat = await get('SELECT id FROM categorias WHERE id = ?', [categoriaId]);
    if (!cat) throw errorHttp(400, 'La categoría no existe');
    categoriaId = cat.id;
  }

  return {
    nombre,
    descripcion: String(valor('descripcion', '') || ''),
    categoria_id: categoriaId,
    precio_venta: numero('precio_venta'),
    costo: numero('costo', 0),
    es_plato: bandera('es_plato', 0),
    tracking_stock: bandera('tracking_stock', 0),
    stock_actual: Number(valor('stock_actual', 0)) || 0, // puede quedar negativo por ventas
    stock_minimo: numero('stock_minimo', 0),
    unidad: String(valor('unidad', 'unidad') || 'unidad'),
    activo: bandera('activo', 1)
  };
}

app.post('/api/productos', autenticar, esAdmin, async (req, res) => {
  try {
    const p = await datosProducto(req.body || {});
    const result = await run(
      `INSERT INTO productos (nombre, descripcion, categoria_id, precio_venta, costo, es_plato, tracking_stock, stock_actual, stock_minimo, unidad, activo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [p.nombre, p.descripcion, p.categoria_id, p.precio_venta, p.costo, p.es_plato, p.tracking_stock, p.stock_actual, p.stock_minimo, p.unidad, p.activo]
    );
    res.status(201).json({ id: result.id, message: 'Producto creado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.put('/api/productos/:id', autenticar, esAdmin, async (req, res) => {
  try {
    const actual = await get('SELECT * FROM productos WHERE id = ?', [req.params.id]);
    if (!actual) return res.status(404).json({ error: 'Producto no encontrado' });
    const p = await datosProducto(req.body || {}, actual);
    await run(
      `UPDATE productos SET
       nombre = ?, descripcion = ?, categoria_id = ?, precio_venta = ?, costo = ?,
       es_plato = ?, tracking_stock = ?, stock_actual = ?, stock_minimo = ?, unidad = ?, activo = ?
       WHERE id = ?`,
      [p.nombre, p.descripcion, p.categoria_id, p.precio_venta, p.costo, p.es_plato, p.tracking_stock, p.stock_actual, p.stock_minimo, p.unidad, p.activo, actual.id]
    );
    res.json({ message: 'Producto actualizado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.delete('/api/productos/:id', autenticar, esAdmin, async (req, res) => {
  try {
    await run('UPDATE productos SET activo = 0 WHERE id = ?', [req.params.id]);
    res.json({ message: 'Producto desactivado' });
  } catch (err) {
    errorInterno(res, err);
  }
});

};
