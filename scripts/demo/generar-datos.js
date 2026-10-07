// Genera un entorno de demostración de "La Buena Mesa" con datos realistas:
// una semana de ventas, cajas cerradas con arqueo, mesas ocupadas, comandas en cocina,
// delivery, reservas, usuarios de cada rol, alertas de stock y compras y gastos para la contabilidad.
//
// Uso: node scripts/demo/generar-datos.js [carpeta]   (por defecto demo/datos)
// No toca la base real (data/). Los datos son siempre los mismos (semilla fija),
// con fechas relativas al momento en que se genera.
'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3');
const { PRODUCTOS, CLIENTES } = require('../seed-data');

const RAIZ = path.join(__dirname, '..', '..');
const DESTINO = path.resolve(process.argv[2] || path.join(RAIZ, 'demo', 'datos'));
const CLAVE_DEMO = 'demo1234';
const OFFSET_ARG_MIN = -180; // Argentina: UTC-3 (sin horario de verano)

// ---------- Utilidades ----------
let semilla = 20260930;
const azar = () => { // mulberry32: mismos datos en cada generación
  semilla |= 0; semilla = semilla + 0x6D2B79F5 | 0;
  let t = Math.imul(semilla ^ semilla >>> 15, 1 | semilla);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};
const entre = (a, b) => a + Math.floor(azar() * (b - a + 1));
const elegir = lista => lista[Math.floor(azar() * lista.length)];
const ponderado = pares => { let r = azar() * pares.reduce((s, [, p]) => s + p, 0); for (const [v, p] of pares) { if ((r -= p) <= 0) return v; } return pares[0][0]; };
const esperar = ms => new Promise(r => setTimeout(r, ms));

// Fecha/hora local de Argentina → texto UTC como lo guarda SQLite
const utc = fecha => fecha.toISOString().replace('T', ' ').slice(0, 19);
function horaLocal(diasAtras, hora, minuto) {
  const ahora = new Date(Date.now() + OFFSET_ARG_MIN * 60000);
  const d = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate() - diasAtras, hora, minuto));
  return new Date(d.getTime() - OFFSET_ARG_MIN * 60000);
}
const aaaammdd = fecha => new Date(fecha.getTime() + OFFSET_ARG_MIN * 60000).toISOString().slice(0, 10).replace(/-/g, '');

const puertoLibre = () => new Promise((ok, mal) => {
  const s = net.createServer();
  s.listen(0, () => { const { port } = s.address(); s.close(() => ok(port)); });
  s.on('error', mal);
});

(async () => {
  console.log('Generando demo en', DESTINO);
  fs.rmSync(DESTINO, { recursive: true, force: true });
  fs.mkdirSync(DESTINO, { recursive: true });
  // La carga masiva de la semana de ventas supera el límite de peticiones normal
  const env = { ...process.env, GM_DATA_DIR: DESTINO, NODE_ENV: 'demo', GM_API_LIMITE: '100000' };
  delete env.SECRET_KEY;
  execFileSync(process.execPath, [path.join(RAIZ, 'init-db.js')], { env, stdio: 'ignore' });

  const port = await puertoLibre();
  const servidor = spawn(process.execPath, [path.join(RAIZ, 'server.js')], { env: { ...env, PORT: String(port) }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/')).ok) break; } catch (e) {} await esperar(100); }

  const db = new sqlite3.Database(path.join(DESTINO, 'gastromanager.db'));
  db.configure('busyTimeout', 10000);
  const q = (sql, p = []) => new Promise((ok, mal) => db.all(sql, p, (e, r) => e ? mal(e) : ok(r)));
  const clave = fs.readFileSync(path.join(DESTINO, '.secret_key'), 'utf8').trim();
  const token = id => jwt.sign({ id }, clave);
  const api = async (tok, metodo, ruta, body) => {
    const r = await fetch(base + ruta, { method: metodo, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${metodo} ${ruta}: ${r.status} ${JSON.stringify(j)}`);
    return j;
  };

  try {
    // ---------- Administrador y negocio ----------
    const hash = await bcrypt.hash(CLAVE_DEMO, 10);
    await q("UPDATE usuarios SET nombre = 'Sofía Ramírez', email = 'admin@labuenamesa.com', password = ?, debe_cambiar_password = 0 WHERE rol = 'admin'", [hash]);
    const [{ id: idAdmin }] = await q("SELECT id FROM usuarios WHERE rol = 'admin'");
    const A = token(idAdmin);
    await api(A, 'PUT', '/api/config', {
      nombre_negocio: 'La Buena Mesa', direccion: 'Av. Corrientes 1234, CABA', telefono: '11 4567-8900',
      email: 'contacto@labuenamesa.com', cuit: '30-71234567-8', tasa_iva: 21, moneda: 'ARS',
      activar_impresion: 0, tipo_negocio: 'restaurante_mediano', setup_completado: 1,
      modulos_activos: ['pos', 'mesas', 'pedidos', 'delivery', 'cocina', 'productos', 'stock', 'proveedores', 'clientes', 'caja', 'reportes']
    });

    // ---------- Usuarios de cada rol ----------
    const usuarios = {};
    for (const [nombre, email, rol] of [
      ['Martín Ruiz', 'encargado@labuenamesa.com', 'encargado'],
      ['Roberto Díaz', 'caja@labuenamesa.com', 'cajero'],
      ['Lucas Fernández', 'lucas@labuenamesa.com', 'mozo'],
      ['Camila Torres', 'camila@labuenamesa.com', 'mozo'],
      ['Valeria Gómez', 'cocina@labuenamesa.com', 'cocina']
    ]) {
      const r = await api(A, 'POST', '/api/usuarios', { nombre, email, password: CLAVE_DEMO, rol });
      usuarios[email] = r.id;
    }
    await q('UPDATE usuarios SET debe_cambiar_password = 0');
    const CAJA = token(usuarios['caja@labuenamesa.com']);
    const MOZOS = [token(usuarios['lucas@labuenamesa.com']), token(usuarios['camila@labuenamesa.com'])];

    // ---------- Carta ----------
    for (const p of await api(A, 'GET', '/api/productos')) await api(A, 'DELETE', `/api/productos/${p.id}`);
    const cats = await api(A, 'GET', '/api/categorias');
    const idCat = {};
    for (const c of cats) idCat[c.nombre] = c.id;
    for (const [nombre, color, orden] of [['Ensaladas', '#10b981', 3], ['Guarniciones', '#f59e0b', 7]]) {
      idCat[nombre] = (await api(A, 'POST', '/api/categorias', { nombre, color, orden })).id;
    }
    await api(A, 'DELETE', `/api/categorias/${idCat['Delivery']}`); // categoría de ejemplo sin uso
    const categoriaDe = p => /vino|cerveza/i.test(p.nombre) ? 'Bebidas Alcohólicas'
      : ({ Principales: 'Platos Principales' }[p.categoria] || p.categoria);
    const productos = [];
    for (const p of PRODUCTOS) {
      const r = await api(A, 'POST', '/api/productos', {
        nombre: p.nombre, descripcion: p.descripcion, categoria_id: idCat[categoriaDe(p)], precio_venta: p.precio,
        costo: Math.round(p.precio * (0.24 + azar() * 0.12) / 10) * 10, es_plato: p.categoria !== 'Bebidas',
        tracking_stock: 1, stock_actual: 500, stock_minimo: Math.ceil(p.stock * 0.25), unidad: p.categoria === 'Bebidas' ? 'unidad' : 'porción'
      });
      productos.push({ ...p, id: r.id, cat: categoriaDe(p) });
    }
    const porCat = c => productos.filter(p => p.cat === c);
    const principales = porCat('Platos Principales'), entradas = porCat('Entradas'), postres = porCat('Postres');
    const bebidas = [...porCat('Bebidas'), ...porCat('Bebidas Alcohólicas')], ensaladas = porCat('Ensaladas'), guarniciones = porCat('Guarniciones');

    // Pedido típico: principales + bebidas, a veces entrada, postre o guarnición
    const armarPedido = () => {
      const comensales = ponderado([[1, 2], [2, 5], [3, 2], [4, 3], [6, 1]]);
      const items = new Map();
      const sumar = (p, n = 1) => items.set(p.id, (items.get(p.id) || 0) + n);
      for (let i = 0; i < comensales; i++) {
        sumar(azar() < 0.8 ? elegir(principales) : elegir(ensaladas));
        sumar(elegir(bebidas));
      }
      if (azar() < 0.45) sumar(elegir(entradas));
      if (azar() < 0.35) sumar(elegir(guarniciones));
      if (azar() < 0.4) sumar(elegir(postres), entre(1, Math.max(1, comensales - 1)));
      return [...items].map(([producto_id, cantidad]) => ({ producto_id, cantidad }));
    };
    const METODOS = [['efectivo', 35], ['tarjeta', 35], ['mercadopago', 22], ['transferencia', 8]];

    // Vende, cobra y lleva el pedido a la fecha indicada
    async function venta(creado, { tipo = 'salon', mesa = null, descuento = 0, plataforma = null } = {}) {
      const body = { tipo, mesa_id: mesa, items: armarPedido(), descuento };
      if (plataforma) {
        const cli = elegir(CLIENTES);
        Object.assign(body, { plataforma, cliente: cli.nombre, codigo_externo: `${plataforma === 'Rappi' ? 'RP' : 'PY'}-${entre(100000, 999999)}`,
          direccion: cli.direccion, telefono: cli.telefono, costo_envio: 1200 });
      }
      // Los mozos no pueden aplicar descuentos: esos pedidos los carga el cajero
      const p = await api(descuento ? CAJA : elegir(MOZOS), 'POST', '/api/pedidos', body);
      const metodo = plataforma ? 'mercadopago' : ponderado(METODOS);
      await api(CAJA, 'POST', `/api/pedidos/${p.id}/pagar`, { metodo, monto: p.total });
      const cerrado = new Date(creado.getTime() + entre(35, 95) * 60000);
      const numero = p.numero_pedido.replace(/^P-\d{8}-/, `P-${aaaammdd(creado)}-`);
      await q('UPDATE pedidos SET creado_en = ?, cerrado_en = ?, numero_pedido = ? WHERE id = ?', [utc(creado), utc(cerrado), numero, p.id]);
      await q('UPDATE pagos SET fecha = ? WHERE pedido_id = ?', [utc(cerrado), p.id]);
      await q('UPDATE movimientos_stock SET fecha = ?, motivo = ? WHERE motivo = ?', [utc(cerrado), `Venta ${numero}`, `Venta ${p.numero_pedido}`]);
      if (plataforma) await q("UPDATE entregas SET estado = 'entregado', cadete = ? WHERE pedido_id = ?", [elegir(['Leo', 'Nico', 'Ramiro']), p.id]);
      return p;
    }
    const horaAlmuerzo = () => [entre(12, 15), entre(0, 59)];
    const horaCena = () => [ponderado([[20, 2], [21, 4], [22, 3], [23, 1]]), entre(0, 59)];

    // ---------- Activar plataformas de delivery ----------
    const plataformas = await api(A, 'GET', '/api/delivery/plataformas');
    await api(A, 'PUT', '/api/delivery/plataformas', { plataformas: plataformas.map(p => ({ ...p, activa: ['PedidosYa', 'Rappi'].includes(p.nombre) })) });

    // ---------- Semana anterior: ventas y cajas cerradas ----------
    const [{ id: idCajero }] = await q("SELECT id FROM usuarios WHERE email = 'caja@labuenamesa.com'");
    const PEDIDOS_POR_DIA = { 6: 26, 5: 31, 4: 29, 3: 37, 2: 46, 1: 52 };
    const DIFERENCIAS = [0, 0, -500, 0, 300, 0];
    for (const [dias, cantidad] of Object.entries(PEDIDOS_POR_DIA).map(([d, c]) => [Number(d), c])) {
      process.stdout.write(`  hace ${dias} día(s): ${cantidad} ventas`);
      for (let i = 0; i < cantidad; i++) {
        const [h, m] = azar() < 0.4 ? horaAlmuerzo() : horaCena();
        const tipo = ponderado([['salon', 78], ['takeaway', 10], ['delivery', 12]]);
        await venta(horaLocal(dias, h, m), {
          tipo, mesa: tipo === 'salon' ? entre(1, 10) : null, descuento: azar() < 0.08 ? 1000 : 0,
          plataforma: tipo === 'delivery' ? elegir(['PedidosYa', 'Rappi']) : null
        });
      }
      // Caja del día con arqueo
      const apertura = horaLocal(dias, 11, 30), cierre = horaLocal(dias - 1, 0, 45);
      const [{ efectivo }] = await q("SELECT COALESCE(SUM(monto), 0) efectivo FROM pagos WHERE metodo = 'efectivo' AND fecha >= ? AND fecha <= ?", [utc(apertura), utc(cierre)]);
      const egreso = dias % 2 ? 0 : entre(8, 25) * 500;
      const esperado = 20000 + efectivo - egreso;
      const diferencia = DIFERENCIAS[dias - 1];
      const { lastID } = await new Promise((ok, mal) => db.run(
        `INSERT INTO caja (fecha_apertura, fecha_cierre, monto_inicial, monto_final_real, usuario_id, estado, observaciones,
           monto_esperado, diferencia, observaciones_cierre) VALUES (?, ?, 20000, ?, ?, 'cerrada', '', ?, ?, ?)`,
        [utc(apertura), utc(cierre), esperado + diferencia, idCajero, esperado, diferencia,
          diferencia < 0 ? 'Faltante: vuelto mal dado en la cena' : diferencia > 0 ? 'Propina dejada en caja' : ''],
        function (e) { e ? mal(e) : ok(this); }));
      if (egreso) await q("INSERT INTO movimientos_caja (caja_id, tipo, concepto, monto, fecha, usuario_id) VALUES (?, 'egreso', 'Pago a proveedor de verduras', ?, ?, ?)",
        [lastID, egreso, utc(horaLocal(dias, 17, 10)), idCajero]);
      console.log(' ✓');
    }

    // ---------- Hoy ----------
    const ahora = new Date();
    const minutosAtras = n => new Date(ahora.getTime() - n * 60000);
    // El turno empieza hasta 5 h 30 antes, pero nunca antes de las 7:00 (ni menos de 1 h antes de ahora)
    const inicioTurno = new Date(Math.min(minutosAtras(60).getTime(), Math.max(minutosAtras(330).getTime(), horaLocal(0, 7, 0).getTime())));
    const caja = await api(CAJA, 'POST', '/api/caja/abrir', { monto_inicial: 20000, observaciones: 'Turno de hoy' });
    await q('UPDATE caja SET fecha_apertura = ? WHERE id = ?', [utc(inicioTurno), caja.id]);
    await api(CAJA, 'POST', '/api/caja/movimiento', { tipo: 'egreso', monto: 3500, concepto: 'Hielo y descartables' });
    const turnoMin = Math.max(30, Math.floor((minutosAtras(25) - inicioTurno) / 60000));
    process.stdout.write('  hoy: ventas del turno');
    // Un buen día: por encima del promedio de la semana, con algunos delivery ya entregados
    for (let i = 0; i < 44; i++) {
      const creado = new Date(inicioTurno.getTime() + Math.floor(azar() * (turnoMin - 20)) * 60000);
      const plataforma = i % 9 === 4 ? elegir(['PedidosYa', 'Rappi']) : null;
      await venta(creado, plataforma ? { tipo: 'delivery', plataforma } : { mesa: entre(1, 10) });
    }
    await q('UPDATE movimientos_caja SET fecha = ? WHERE caja_id = ?', [utc(minutosAtras(95)), caja.id]);
    console.log(' ✓');

    // Mesas ocupadas con comandas en distintos tiempos de cocina
    const abiertos = [];
    for (const [mesa, minutos, notas] of [[1, 4, ''], [2, 14, 'Cumpleaños: traer vela con el postre'], [5, 23, ''], [7, 38, 'Sin sal para la señora']]) {
      const p = await api(elegir(MOZOS), 'POST', '/api/pedidos', { tipo: 'salon', mesa_id: mesa, notas, items: armarPedido() });
      await q('UPDATE pedidos SET creado_en = ? WHERE id = ?', [utc(minutosAtras(minutos)), p.id]);
      abiertos.push(p);
    }
    const bife = productos.find(p => p.nombre === 'Bife de chorizo');
    await api(MOZOS[0], 'POST', `/api/pedidos/${abiertos[1].id}/items`, { producto_id: bife.id, cantidad: 1, notas: 'Jugoso' });
    await q("UPDATE pedido_items SET notas = 'Bien cocido' WHERE pedido_id = ? AND id = (SELECT MIN(id) FROM pedido_items WHERE pedido_id = ?)", [abiertos[3].id, abiertos[3].id]);

    // Delivery en curso: apps y carta online
    const delivery = [
      ['PedidosYa', 'aceptado', '', 9],
      ['Rappi', 'en_camino', 'Nico', 27],
      ['PedidosYa', 'pendiente', '', 2]
    ];
    for (const [plataforma, estado, cadete, minutos] of delivery) {
      const cli = elegir(CLIENTES);
      const p = await api(CAJA, 'POST', '/api/pedidos', {
        tipo: 'delivery', cliente: cli.nombre, items: armarPedido().slice(0, 3), plataforma,
        codigo_externo: `${plataforma === 'Rappi' ? 'RP' : 'PY'}-${entre(100000, 999999)}`, direccion: cli.direccion, telefono: cli.telefono, costo_envio: 1200
      });
      await q('UPDATE pedidos SET creado_en = ? WHERE id = ?', [utc(minutosAtras(minutos)), p.id]);
      await q('UPDATE entregas SET estado = ?, cadete = ? WHERE pedido_id = ?', [estado, cadete, p.id]);
    }
    const web = await fetch(base + '/api/publico/pedido', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliente: 'Marina Suárez', telefono: '11 6123-4567', tipo: 'delivery', direccion: 'Av. Santa Fe 3100, CABA', origen: 'whatsapp', notas: 'Timbre 4B',
        items: [{ producto_id: productos.find(p => p.nombre === 'Hamburguesa artesanal').id, cantidad: 2 }, { producto_id: productos.find(p => p.nombre === 'Papas fritas').id, cantidad: 1 }, { producto_id: productos.find(p => p.nombre === 'Gaseosa lata').id, cantidad: 2 }] })
    }).then(r => r.json());
    await q('UPDATE pedidos SET creado_en = ? WHERE id = ?', [utc(minutosAtras(6)), web.id]);
    const llevar = await api(CAJA, 'POST', '/api/pedidos', { tipo: 'takeaway', cliente: 'Diego (para llevar)', items: [{ producto_id: productos.find(p => p.nombre === 'Empanadas x4').id, cantidad: 3 }] });
    await q('UPDATE pedidos SET creado_en = ? WHERE id = ?', [utc(minutosAtras(11)), llevar.id]);

    // Reservas de esta noche
    const hoy = new Date(ahora.getTime() + OFFSET_ARG_MIN * 60000).toISOString().slice(0, 10);
    for (const [mesa, cliente, telefono, hora, personas, notas] of [
      [9, 'Familia Gómez', '11 5234-6789', '21:30', 6, 'Silla para bebé'],
      [10, 'Cumpleaños de Sofía', '11 4876-3210', '22:00', 8, 'Traen torta'],
      [null, 'Carlos Rodríguez', '11 6543-2109', '20:30', 2, 'Prefiere terraza']
    ]) {
      await api(MOZOS[1], 'POST', '/api/reservas', { mesa_id: mesa, cliente, telefono, fecha: hoy, hora, personas, notas });
    }

    // ---------- Contabilidad: compras y gastos de la semana ----------
    // Importes proporcionales a lo vendido, para un resultado realista (~15-20 % de margen)
    const [{ vendido }] = await q("SELECT COALESCE(SUM(monto), 0) vendido FROM pagos");
    const proveedores = Object.fromEntries((await api(A, 'GET', '/api/proveedores')).map(p => [p.nombre, p.id]));
    proveedores['Verdulería Don Pepe'] = (await api(A, 'POST', '/api/proveedores', { nombre: 'Verdulería Don Pepe', cuit: '20-23456789-1', telefono: '11 4932-1188' })).id;
    proveedores['Frío Service'] = (await api(A, 'POST', '/api/proveedores', { nombre: 'Frío Service', cuit: '20-30111222-5', telefono: '11 5011-4433' })).id;
    const fechaDia = dias => new Date(horaLocal(dias, 12, 0).getTime() + OFFSET_ARG_MIN * 60000).toISOString().slice(0, 10);
    let nroComprobante = 1840;
    const GASTOS = [
      // [días atrás, categoría, proveedor, descripción, comprobante, % de lo vendido, pago ('' = a pagar), vence en días]
      [6, 'mercaderia', 'Carnes del Norte', 'Carne vacuna: bife, vacío y entraña', 'factura_a', 0.13, 'transferencia'],
      [6, 'sueldos', null, 'Sueldos de la semana: cocina y salón', 'recibo', 0.22, 'transferencia'],
      [5, 'mercaderia', 'Verdulería Don Pepe', 'Verduras y frutas', 'factura_c', 0.028, 'efectivo'],
      [5, 'alquiler', null, 'Alquiler del local', 'factura_a', 0.07, '', 3],
      [4, 'mercaderia', 'Bebidas del Sur', 'Vinos, cervezas y gaseosas', 'factura_a', 0.065, '', 10],
      [4, 'servicios', null, 'Factura de luz', 'factura_a', 0.02, '', 8],
      [3, 'mercaderia', 'Distribuidora Central', 'Almacén: harinas, aceite y lácteos', 'factura_a', 0.055, '', -1],
      [3, 'servicios', null, 'Gas natural', 'factura_a', 0.012, 'tarjeta'],
      [3, 'mantenimiento', 'Frío Service', 'Service de la cámara de frío', 'factura_c', 0.008, 'efectivo'],
      [2, 'mercaderia', 'Carnes del Norte', 'Carne vacuna y pollo', 'factura_a', 0.08, '', 5],
      [2, 'servicios', null, 'Internet y telefonía', 'factura_a', 0.004, 'tarjeta'],
      [1, 'mercaderia', 'Verdulería Don Pepe', 'Verduras y frutas', 'factura_c', 0.022, 'efectivo'],
      [1, 'comisiones', null, 'Comisiones PedidosYa y Rappi', 'factura_a', 0.025, '', 6],
      [1, 'impuestos', null, 'Ingresos Brutos: anticipo', 'recibo', 0.03, '', 12],
      [0, 'marketing', null, 'Publicidad en Instagram', 'factura_a', 0.006, 'tarjeta']
    ];
    for (const [dias, categoria, proveedor, descripcion, tipo, pct, pago, vence] of GASTOS) {
      const total = vendido * pct;
      const neto = tipo === 'factura_a' ? Math.round(total / 1.21 / 100) * 100 : Math.round(total / 100) * 100;
      const fecha = fechaDia(dias);
      await api(A, 'POST', '/api/contabilidad/gastos', {
        fecha, categoria, descripcion, proveedor_id: proveedor ? proveedores[proveedor] : null, tipo_comprobante: tipo,
        numero_comprobante: tipo === 'recibo' ? '' : `000${entre(1, 9)}-000${nroComprobante++}`,
        neto, iva: tipo === 'factura_a' ? Math.round(neto * 21) / 100 : 0,
        vencimiento: pago ? null : fechaDia(-vence), pagado: !!pago, metodo_pago: pago || undefined, fecha_pago: fecha
      });
    }
    // Compra de hoy pagada con el efectivo de la caja abierta (queda en el arqueo)
    await api(A, 'POST', '/api/contabilidad/gastos', {
      fecha: fechaDia(0), categoria: 'mercaderia', descripcion: 'Pan del día', proveedor_id: null, tipo_comprobante: 'ticket',
      neto: Math.round(vendido * 0.004 / 100) * 100, pagado: true, metodo_pago: 'efectivo', desde_caja: true
    });

    // Clientes, impresoras y promociones
    for (const c of CLIENTES) await api(CAJA, 'POST', '/api/clientes', c);
    await q("UPDATE clientes SET puntos = ? WHERE nombre = 'Maria Gonzalez'", [320]);
    await q("UPDATE clientes SET puntos = ? WHERE nombre = 'TechSoluciones SA'", [1250]);
    for (const imp of [
      { nombre: 'Cocina', tipo: 'red', destino: '192.168.0.50:9100', categorias: [idCat['Entradas'], idCat['Platos Principales'], idCat['Ensaladas'], idCat['Guarniciones'], idCat['Postres']] },
      { nombre: 'Barra', tipo: 'red', destino: '192.168.0.51:9100', ancho: 58, categorias: [idCat['Bebidas'], idCat['Bebidas Alcohólicas']] },
      { nombre: 'Caja', tipo: 'usb', destino: 'POS-80', imprime_comandas: false, imprime_tickets: true }
    ]) await api(A, 'POST', '/api/impresoras', imp);
    await api(A, 'POST', '/api/promociones', { nombre: 'Happy hour 18 a 20 hs', tipo: 'porcentaje', valor: 20, descripcion: '20% en tragos y cervezas' });

    // Stock final (con algunas alertas de reposición)
    const STOCK = { 'Vino por copa': 4, 'Tiramisu casero': 2, 'Limonada artesanal': 5, 'Bife de chorizo': 7, 'Risotto de hongos': 6 };
    for (const p of productos) {
      await q('UPDATE productos SET stock_actual = ? WHERE id = ?', [STOCK[p.nombre] !== undefined ? STOCK[p.nombre] : entre(Math.ceil(p.stock * 0.6), p.stock * 2), p.id]);
    }
    await q("UPDATE auditoria SET fecha = datetime(fecha, '-1 minutes')");

    const [{ n }] = await q('SELECT COUNT(*) n FROM pedidos');
    console.log(`Listo: ${n} pedidos, ${productos.length} productos, ${Object.keys(usuarios).length + 1} usuarios.`);
    console.log(`Ingreso: admin@labuenamesa.com / ${CLAVE_DEMO} (todos los usuarios de la demo usan la misma clave)`);
  } finally {
    await new Promise(r => db.close(r));
    servidor.kill();
    await new Promise(r => servidor.exitCode !== null ? r() : servidor.once('exit', r));
    // Copias de seguridad creadas durante la generación: no hacen falta en la demo
    fs.rmSync(path.join(DESTINO, 'backups'), { recursive: true, force: true });
  }
})().catch(e => { console.error('Error generando la demo:', e.message); process.exit(1); });
