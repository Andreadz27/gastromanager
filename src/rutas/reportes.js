'use strict';
const {
  get, all, LOCAL, fechaLocal, errorInterno, autenticar, esAdmin, requiere
} = require('../contexto');

module.exports = function registrarRutas(app) {

// ============ REPORTES / ANALITICAS ============

app.get('/api/reportes/dashboard', autenticar, requiere('reportes'), async (req, res) => {
  try {
    const hoy = fechaLocal();
    
    const ventasHoy = await get(`
      SELECT COALESCE(SUM(total), 0) as total, COUNT(*) as pedidos
      FROM pedidos WHERE estado = 'pagado' AND date(cerrado_en, ${LOCAL()}) = ?
    `, [hoy]);
    
    const ayer = fechaLocal(1);
    const ventasAyer = await get(`
      SELECT COALESCE(SUM(total), 0) as total
      FROM pedidos WHERE estado = 'pagado' AND date(cerrado_en, ${LOCAL()}) = ?
    `, [ayer]);
    
    const mesActual = hoy.substring(0, 7);
    const ventasMes = await get(`
      SELECT COALESCE(SUM(total), 0) as total
      FROM pedidos WHERE estado = 'pagado' AND substr(date(cerrado_en, ${LOCAL()}), 1, 7) = ?
    `, [mesActual]);
    
    const topProductos = await all(`
      SELECT pi.nombre_producto, SUM(pi.cantidad) as cantidad, SUM(pi.subtotal) as total
      FROM pedido_items pi
      JOIN pedidos p ON pi.pedido_id = p.id
      WHERE p.estado = 'pagado' AND date(p.cerrado_en, ${LOCAL()}) = ?
      GROUP BY pi.nombre_producto
      ORDER BY cantidad DESC
      LIMIT 5
    `, [hoy]);
    
    const metodosPago = await all(`
      SELECT metodo, SUM(monto) as total, COUNT(*) as cantidad
      FROM pagos p
      JOIN pedidos ped ON p.pedido_id = ped.id
      WHERE date(ped.cerrado_en, ${LOCAL()}) = ?
      GROUP BY metodo
      ORDER BY total DESC
    `, [hoy]);
    
    const pedidosRecientes = await all(`
      SELECT p.*, m.nombre as mesa FROM pedidos p
      LEFT JOIN mesas m ON p.mesa_id = m.id
      ORDER BY p.creado_en DESC LIMIT 5
    `);
    
    const stockBajo = await all(`
      SELECT nombre, stock_actual, stock_minimo, unidad
      FROM productos
      WHERE tracking_stock = 1 AND activo = 1 AND stock_actual <= stock_minimo
      ORDER BY (stock_actual - stock_minimo) ASC
      LIMIT 5
    `);
    
    const ventas7Dias = await all(`
      SELECT date(cerrado_en, ${LOCAL()}) as fecha,
             COALESCE(SUM(total), 0) as total,
             COUNT(*) as pedidos
      FROM pedidos
      WHERE estado = 'pagado'
        AND date(cerrado_en, ${LOCAL()}) >= date('now', ${LOCAL()}, '-6 days')
      GROUP BY date(cerrado_en, ${LOCAL()})
      ORDER BY fecha ASC
    `);
    // Rellenar días sin ventas para tener siempre 7 entradas
    const dias7 = [];
    for (let i = 6; i >= 0; i--) {
      const fecha = fechaLocal(i);
      const found = ventas7Dias.find(v => v.fecha === fecha);
      dias7.push(found || { fecha, total: 0, pedidos: 0 });
    }
    
    const ticketPromedio = await get(`
      SELECT COALESCE(AVG(total), 0) as promedio
      FROM pedidos WHERE estado = 'pagado' AND date(cerrado_en, ${LOCAL()}) = ?
    `, [hoy]);
    
    res.json({
      ventas_hoy: ventasHoy.total,
      pedidos_hoy: ventasHoy.pedidos,
      ventas_ayer: ventasAyer.total,
      cambio_dia: ventasAyer.total > 0 ? ((ventasHoy.total - ventasAyer.total) / ventasAyer.total * 100) : 0,
      ventas_mes: ventasMes.total,
      ticket_promedio: ticketPromedio.promedio,
      top_productos: topProductos,
      metodos_pago: metodosPago,
      pedidos_recientes: pedidosRecientes,
      stock_bajo: stockBajo,
      ventas_7dias: dias7
    });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.get('/api/reportes/ventas', autenticar, requiere('reportes'), async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    let sql = `SELECT p.*, m.nombre as mesa_nombre, u.nombre as usuario_nombre
               FROM pedidos p
               LEFT JOIN mesas m ON p.mesa_id = m.id
               LEFT JOIN usuarios u ON p.usuario_id = u.id
               WHERE p.estado = 'pagado'`;
    const params = [];
    
    if (desde) {
      sql += ` AND date(p.cerrado_en, ${LOCAL()}) >= ?`;
      params.push(desde);
    }
    if (hasta) {
      sql += ` AND date(p.cerrado_en, ${LOCAL()}) <= ?`;
      params.push(hasta);
    }
    sql += ' ORDER BY p.cerrado_en DESC';
    
    const pedidos = await all(sql, params);
    const total = pedidos.reduce((sum, p) => sum + p.total, 0);
    
    res.json({ pedidos, total, cantidad: pedidos.length });
  } catch (err) {
    errorInterno(res, err);
  }
});

app.get('/api/reportes/rentabilidad', autenticar, requiere('reportes.costos'), async (req, res) => {
  try {
    const rentabilidad = await all(`
      SELECT p.nombre, p.precio_venta, p.costo,
        (p.precio_venta - p.costo) as ganancia,
        CASE WHEN p.precio_venta > 0 THEN ((p.precio_venta - p.costo) / p.precio_venta * 100) ELSE 0 END as margen,
        (SELECT COALESCE(SUM(pi.cantidad), 0) FROM pedido_items pi JOIN pedidos pd ON pi.pedido_id = pd.id 
         WHERE pi.producto_id = p.id AND pd.estado = 'pagado') as vendidos
      FROM productos p
      WHERE p.activo = 1
      ORDER BY margen DESC
    `);
    res.json(rentabilidad);
  } catch (err) {
    errorInterno(res, err);
  }
});

// ============ AUDITORIA ============

app.get('/api/auditoria', autenticar, esAdmin, async (req, res) => {
  try {
    const logs = await all(`
      SELECT a.*, u.nombre as usuario_nombre
      FROM auditoria a
      LEFT JOIN usuarios u ON a.usuario_id = u.id
      ORDER BY a.fecha DESC
      LIMIT 100
    `);
    res.json(logs);
  } catch (err) {
    errorInterno(res, err);
  }
});

// ============ INSIGHTS / INTELIGENCIA DE NEGOCIO ============

app.get('/api/insights', autenticar, requiere('reportes'), async (req, res) => {
  try {
    const hoy = fechaLocal();

    // --- Alerta de stock bajo (crítico y preventivo) ---
    const stockBajo = await all(`
      SELECT nombre, stock_actual, stock_minimo, unidad, tracking_stock
      FROM productos
      WHERE activo = 1 AND tracking_stock = 1
        AND stock_actual <= stock_minimo
      ORDER BY (stock_actual - stock_minimo) ASC
    `);

    const stockCritico = stockBajo.filter(p => p.stock_actual === 0 || p.stock_actual <= (p.stock_minimo / 2));
    const stockPreventivo = stockBajo.filter(p => !stockCritico.includes(p));

    // --- Rentabilidad: productos más vendidos vs margen ---
    const topRentabilidad = await all(`
      SELECT p.nombre, p.precio_venta, p.costo,
        (p.precio_venta - p.costo) as ganancia,
        CASE WHEN p.precio_venta > 0 THEN ROUND((p.precio_venta - p.costo) / p.precio_venta * 100, 1) ELSE 0 END as margen,
        (SELECT COALESCE(SUM(pi.cantidad), 0) FROM pedido_items pi JOIN pedidos pd ON pi.pedido_id = pd.id
         WHERE pi.producto_id = p.id AND pd.estado = 'pagado') as vendidos
      FROM productos p
      WHERE p.activo = 1
      ORDER BY vendidos DESC, margen DESC
      LIMIT 10
    `);

    // --- Horas pico (últimos 7 días) para sugerir personal ---
    const horasPico = await all(`
      SELECT CAST(strftime('%H', pd.cerrado_en, ${LOCAL()}) AS INTEGER) as hora, COUNT(*) as pedidos
      FROM pedidos pd
      WHERE pd.estado = 'pagado' AND date(pd.cerrado_en, ${LOCAL()}) >= date('now', ${LOCAL()}, '-7 days')
      GROUP BY hora
      ORDER BY pedidos DESC
      LIMIT 3
    `);

    // --- Comparativa: hoy vs promedio diario de la semana pasada ---
    const ventasHoy = await get(`
      SELECT COALESCE(SUM(total), 0) as total, COUNT(*) as pedidos
      FROM pedidos WHERE estado = 'pagado' AND date(cerrado_en, ${LOCAL()}) = ?
    `, [hoy]);

    const ventasSemana = await get(`
      SELECT COALESCE(AVG(diario), 0) as promedio
      FROM (
        SELECT date(cerrado_en, ${LOCAL()}) as dia, SUM(total) as diario
        FROM pedidos WHERE estado = 'pagado' AND date(cerrado_en, ${LOCAL()}) >= date('now', ${LOCAL()}, '-7 days')
        GROUP BY date(cerrado_en, ${LOCAL()})
      )
    `);

    const diferencia = ventasSemana.promedio > 0
      ? Math.round(((ventasHoy.total - ventasSemana.promedio) / ventasSemana.promedio) * 100)
      : 0;

    // --- Construcción de alertas inteligentes ---
    const alertas = [];

    if (stockCritico.length > 0) {
      alertas.push({
        tipo: 'critico',
        icono: 'exclamation-triangle',
        titulo: `${stockCritico.length} producto${stockCritico.length > 1 ? 's' : ''} sin stock o al límite`,
        detalle: stockCritico.slice(0, 3).map(p => `${p.nombre} (${p.stock_actual}/${p.stock_minimo})`).join(', ') +
          (stockCritico.length > 3 ? ` y ${stockCritico.length - 3} más` : ''),
        accion: 'Reponer inventario',
        enlace: 'stock'
      });
    }

    const muyVendidos = topRentabilidad.filter(p => p.vendidos > 0);
    if (muyVendidos.length > 0 && muyVendidos[0].margen < 30) {
      alertas.push({
        tipo: 'info',
        icono: 'chart-line',
        titulo: 'Revisar precios',
        detalle: `Tu producto más vendido (${muyVendidos[0].nombre}) tiene solo ${muyVendidos[0].margen}% de margen. Un pequeño ajuste puede aumentar la rentabilidad.`,
        accion: 'Ver rentabilidad',
        enlace: 'reportes'
      });
    }

    if (horasPico.length > 0) {
      alertas.push({
        tipo: 'info',
        icono: 'clock',
        titulo: `Horas pico: ${horasPico[0].hora}:00 hs`,
        detalle: 'Considerá reforzar el personal de cocina y salón en estos horarios para optimizar el servicio.',
        accion: 'Ver reportes',
        enlace: 'reportes'
      });
    }

    if (stockPreventivo.length > 0) {
      alertas.push({
        tipo: 'aviso',
        icono: 'boxes',
        titulo: `${stockPreventivo.length} producto${stockPreventivo.length > 1 ? 's' : ''} por agotarse pronto`,
        detalle: stockPreventivo.slice(0, 3).map(p => `${p.nombre} (${p.stock_actual})`).join(', '),
        accion: 'Orden de compra',
        enlace: 'stock'
      });
    }

    // --- Recomendaciones accionables de negocio ---
    const recomendaciones = [];
    if (diferencia < -15) {
      recomendaciones.push({
        icono: 'trending-down',
        titulo: 'Las ventas están por debajo de tu promedio',
        texto: `Hoy las ventas van ${Math.abs(diferencia)}% por debajo de tu promedio diario de la semana. Considerá promociones para impulsar el ticket.`
      });
    } else if (diferencia > 15) {
      recomendaciones.push({
        icono: 'trending-up',
        titulo: '¡Gran día de ventas!',
        texto: `Hoy superás tu promedio diario en ${diferencia}%. Aprovechá el flujo para ofrecer los productos de mayor margen.`
      });
    }

    const altaDemandaBajoStock = topRentabilidad.filter(p => p.vendidos > 0 && stockBajo.some(s => s.nombre === p.nombre));
    if (altaDemandaBajoStock.length > 0) {
      recomendaciones.push({
        icono: 'lightbulb',
        titulo: 'Productos demandados con stock bajo',
        texto: `${altaDemandaBajoStock[0].nombre} se vende bien pero su stock está bajo. Priorizá su reposición para no perder ventas.`
      });
    }

    if (recomendaciones.length === 0) {
      recomendaciones.push({
        icono: 'thumbs-up',
        titulo: 'Todo bajo control',
        texto: 'No se detectan desvíos importantes. Seguí monitoreando el panel para nuevas recomendaciones personalizadas.'
      });
    }

    res.json({
      alertas,
      recomendaciones,
      stock_bajo: stockBajo.map(p => ({
        nombre: p.nombre, stock_actual: p.stock_actual,
        stock_minimo: p.stock_minimo, unidad: p.unidad
      })),
      metricas: {
        ventas_hoy: ventasHoy.total,
        pedidos_hoy: ventasHoy.pedidos,
        promedio_semana: ventasSemana.promedio,
        diferencia_pct: diferencia,
        horas_pico: horasPico
      },
      generado_en: new Date().toISOString()
    });
  } catch (err) {
    errorInterno(res, err);
  }
});

};
