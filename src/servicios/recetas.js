'use strict';
// Recetas: los ingredientes de cada plato.
// - Al cobrar un plato con receta se descuenta el stock de sus ingredientes (no el del plato).
// - El costo del plato es la suma de sus ingredientes: se recalcula al guardar la receta y cuando cambia
//   el costo de un ingrediente. Así la rentabilidad y el costo teórico de Contabilidad usan el costo real.
const { run, get, all } = require('../db');
const { errorHttp } = require('../util');

const MAX_LINEAS = 50;
const r4 = n => Math.round((Number(n) || 0) * 10000) / 10000;

async function obtenerReceta(platoId) {
  const lineas = await all(`
    SELECT r.ingrediente_id, r.cantidad, i.nombre, i.unidad, COALESCE(i.costo, 0) AS costo_unitario,
           i.tracking_stock, i.stock_actual
    FROM recetas r JOIN productos i ON i.id = r.ingrediente_id
    WHERE r.plato_id = ? ORDER BY r.id`, [platoId]);
  return lineas.map(l => ({ ...l, subtotal: r4(l.cantidad * l.costo_unitario) }));
}

const costoDe = lineas => Math.round(lineas.reduce((s, l) => s + l.cantidad * l.costo_unitario, 0) * 100) / 100;

// Reemplaza la receta (va dentro de transaccion()). lineas: [{ ingrediente_id, cantidad }]; vacía = sin receta.
async function guardarRecetaTx(platoId, lineas) {
  const plato = await get('SELECT id FROM productos WHERE id = ?', [platoId]);
  if (!plato) throw errorHttp(404, 'Producto no encontrado');
  if (!Array.isArray(lineas)) throw errorHttp(400, 'Faltan los ingredientes');
  if (lineas.length > MAX_LINEAS) throw errorHttp(400, `Una receta tiene como máximo ${MAX_LINEAS} ingredientes`);
  // Un plato que es ingrediente de otro no puede tener receta (sin recetas anidadas ni ciclos)
  if (lineas.length && await get('SELECT 1 AS x FROM recetas WHERE ingrediente_id = ? LIMIT 1', [platoId]))
    throw errorHttp(400, 'Este producto es ingrediente de otra receta: no puede tener receta propia');

  const porIngrediente = new Map();
  for (const l of lineas) {
    const ingredienteId = parseInt(l && l.ingrediente_id, 10);
    const cantidad = Number(l && l.cantidad);
    if (!ingredienteId) throw errorHttp(400, 'Ingrediente inválido');
    if (ingredienteId === Number(platoId)) throw errorHttp(400, 'Un producto no puede ser ingrediente de sí mismo');
    if (!Number.isFinite(cantidad) || cantidad <= 0 || cantidad > 100000) throw errorHttp(400, 'Cantidad de ingrediente inválida');
    const ing = await get('SELECT id, nombre FROM productos WHERE id = ? AND activo = 1', [ingredienteId]);
    if (!ing) throw errorHttp(400, 'El ingrediente no existe o está inactivo');
    if (await get('SELECT 1 AS x FROM recetas WHERE plato_id = ? LIMIT 1', [ingredienteId]))
      throw errorHttp(400, `${ing.nombre} tiene receta propia: no se puede usar como ingrediente`);
    // El mismo ingrediente dos veces se suma
    porIngrediente.set(ingredienteId, r4((porIngrediente.get(ingredienteId) || 0) + cantidad));
  }

  await run('DELETE FROM recetas WHERE plato_id = ?', [platoId]);
  for (const [ingredienteId, cantidad] of porIngrediente) {
    const { unidad } = await get('SELECT unidad FROM productos WHERE id = ?', [ingredienteId]);
    await run('INSERT INTO recetas (plato_id, ingrediente_id, cantidad, unidad) VALUES (?, ?, ?, ?)',
      [platoId, ingredienteId, cantidad, unidad || 'unidad']);
  }
  const receta = await obtenerReceta(platoId);
  if (receta.length) await run('UPDATE productos SET costo = ? WHERE id = ?', [costoDe(receta), platoId]);
  return receta;
}

// Cambió el costo de un ingrediente: actualiza el costo de los platos que lo usan (va dentro de transaccion())
async function recalcularCostosConIngrediente(ingredienteId) {
  const platos = await all('SELECT DISTINCT plato_id FROM recetas WHERE ingrediente_id = ?', [ingredienteId]);
  for (const { plato_id } of platos) {
    await run('UPDATE productos SET costo = ? WHERE id = ?', [costoDe(await obtenerReceta(plato_id)), plato_id]);
  }
  return platos.length;
}

// Descuento de stock de un ítem vendido (dentro de la transacción del cobro).
// Con receta: los ingredientes que llevan stock. Sin receta: el producto, si lleva stock (como antes).
async function descontarStockItemTx(item, pedido, usuarioId) {
  const ingredientes = await all(`
    SELECT r.ingrediente_id, r.cantidad, i.tracking_stock FROM recetas r JOIN productos i ON i.id = r.ingrediente_id
    WHERE r.plato_id = ?`, [item.producto_id]);
  const movimientos = ingredientes.length
    ? ingredientes.filter(i => i.tracking_stock).map(i => ({ id: i.ingrediente_id, cantidad: r4(i.cantidad * item.cantidad), receta: true }))
    : [];
  if (!ingredientes.length) {
    const producto = await get('SELECT tracking_stock FROM productos WHERE id = ?', [item.producto_id]);
    if (producto && producto.tracking_stock) movimientos.push({ id: item.producto_id, cantidad: item.cantidad, receta: false });
  }
  for (const m of movimientos) {
    await run('UPDATE productos SET stock_actual = stock_actual - ? WHERE id = ?', [m.cantidad, m.id]);
    await run(`INSERT INTO movimientos_stock (producto_id, tipo, cantidad, motivo, usuario_id) VALUES (?, 'venta', ?, ?, ?)`,
      [m.id, -m.cantidad, m.receta ? `Venta ${pedido.numero_pedido} (${item.cantidad} x ${item.nombre_producto})` : `Venta ${pedido.numero_pedido}`, usuarioId || null]);
  }
}

module.exports = { obtenerReceta, guardarRecetaTx, recalcularCostosConIngrediente, descontarStockItemTx, costoReceta: costoDe };
