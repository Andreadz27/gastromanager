// Prueba de fuego: rompe a propósito cada parte crítica (un cambio por vez), corre los tests
// y comprueba que al menos uno falla. Al terminar deja cada archivo como estaba.
// Si un cambio NO hace fallar ningún test, ahí falta un test.
//
// Uso:  npm run prueba:fuego              (todas las mutaciones, ~5 minutos)
//       npm run prueba:fuego -- caja      (solo las que contienen "caja" en el nombre)
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

// [nombre, archivo, texto original, texto roto]
const MUTACIONES = [
  // Precios y totales
  ['precio: usar el que manda el navegador', 'src/servicios/pedidos.js',
    'const precio = Number(prod.precio_venta) || 0;', 'const precio = Number(item.precio ?? prod.precio_venta) || 0;'],
  ['cantidad: aceptar cantidades negativas', 'src/servicios/pedidos.js',
    'cantidad <= 0 || cantidad > 1000', 'cantidad > 1000'],
  ['total: el descuento no se resta', 'src/servicios/pedidos.js',
    'const total = Math.max(0, s - descuento + importe(pedido.propina));', 'const total = Math.max(0, s + importe(pedido.propina));'],
  ['descuento: puede superar el subtotal', 'src/servicios/pedidos.js',
    'const descuento = Math.min(importe(pedido.descuento), s);', 'const descuento = importe(pedido.descuento);'],
  ['carta online: precio del navegador', 'src/rutas/publico.js',
    'item.precio = prod.precio_venta;', 'item.precio = item.precio ?? prod.precio_venta;'],
  // Cobro
  ['cobro: se puede cobrar dos veces', 'src/servicios/pedidos.js',
    "WHERE id = ? AND estado = 'abierto'`,\n    [metodo || '', pedidoId]);", "WHERE id = ?`,\n    [metodo || '', pedidoId]);"],
  ['cobro: no libera la mesa', 'src/servicios/pedidos.js',
    "await run('UPDATE mesas SET estado = ? WHERE id = ?', ['libre', pedido.mesa_id]);", '/* mesa sin liberar */'],
  ['cobro: no descuenta stock', 'src/servicios/pedidos.js',
    "await run('UPDATE productos SET stock_actual = stock_actual - ? WHERE id = ?'", "await run('UPDATE productos SET stock_actual = stock_actual - 0 * ? WHERE id = ?'"],
  ['cobro: acepta un monto menor al total', 'src/rutas/pedidos.js',
    'recibido < total - 0.009', 'recibido < 0'],
  ['cobro: registra lo recibido en vez del total', 'src/rutas/pedidos.js',
    'registrarPago(pedido, { metodo, monto: total,', 'registrarPago(pedido, { metodo, monto: recibido,'],
  ['cancelar: se puede cancelar un pedido cobrado', 'src/rutas/pedidos.js',
    "WHERE id = ? AND estado = 'abierto'`, [pedido.id]);", 'WHERE id = ?`, [pedido.id]);'],
  // Caja
  ['caja: el esperado ignora los egresos', 'src/rutas/caja.js',
    'caja.monto_inicial + ventasEfectivo + ingresos - egresos', 'caja.monto_inicial + ventasEfectivo + ingresos'],
  ['caja: diferencia con el signo invertido', 'src/rutas/caja.js',
    'const diferencia = redondear(contado - resumen.efectivo_esperado);', 'const diferencia = redondear(resumen.efectivo_esperado - contado);'],
  // Permisos y sesiones
  ['permisos: el mozo puede cobrar', 'src/permisos.js',
    "mozo: { nombre: 'Mozo', permisos: ['pedidos.ver', 'pedidos.tomar', 'clientes'] }",
    "mozo: { nombre: 'Mozo', permisos: ['pedidos.ver', 'pedidos.tomar', 'clientes', 'pedidos.cobrar'] }"],
  ['permisos: el encargado es administrador', 'src/permisos.js',
    "permisos: TODOS.filter(p => p !== 'admin')", 'permisos: TODOS'],
  ['sesión: no exige cambiar la contraseña', 'src/auth.js',
    "if (req.usuario.cp && !['/api/auth/me', '/api/auth/password'].includes(req.path))", 'if (false)'],
  ['sesión: usuario desactivado sigue entrando', 'src/auth.js',
    'FROM usuarios WHERE id = ? AND activo = 1', 'FROM usuarios WHERE id = ?'],
  ['login: contraseña incorrecta entra', 'src/rutas/auth.js',
    'if (!passwordValido) {', 'if (false) {'],
  ['usuarios: se puede quedar sin administradores', 'src/rutas/usuarios.js',
    "if (!n) throw errorHttp(400, 'Tiene que quedar al menos un administrador activo');", '/* sin control */'],
  // Mesas y reservas
  ['reservas: la mesa no pasa a ocupada', 'src/rutas/mesas.js',
    "await run('UPDATE mesas SET estado = ? WHERE id = ?', ['ocupada', reservaActual.mesa_id]);", '/* sin ocupar */'],
  // Contabilidad
  ['contabilidad: IVA incluido mal calculado', 'src/rutas/contabilidad.js',
    'r2(monto - monto / (1 + tasa / 100))', 'r2(monto * tasa / 100)'],
  // Copias y migraciones
  ['copias: dos en el mismo segundo se pisan', 'src/servicios/backups.js',
    'for (let n = 2; fs.existsSync(path.join(DIR_BACKUPS, nombre)); n++)', 'for (let n = 2; false; n++)'],
  ['migraciones: sin copia previa', 'src/migraciones.js',
    "&& respaldar) {", '&& false) {'],
  ['migraciones: fuera de la transacción', 'src/migraciones.js',
    'await transaccion(async () => {\n    await migrarEsquema();', 'await (async () => {\n    await migrarEsquema();']
];

// Si se corta con Ctrl+C a mitad de una mutación, el archivo se restaura igual
let pendiente = null;
for (const senal of ['SIGINT', 'SIGTERM']) {
  process.on(senal, () => {
    if (pendiente) fs.writeFileSync(pendiente.ruta, pendiente.antes);
    console.log('\nCortado: se restauró el último archivo modificado.');
    process.exit(130);
  });
}

const filtro = process.argv[2];
const lista = MUTACIONES.filter(([nombre]) => !filtro || nombre.includes(filtro));
const resultados = [];

for (const [nombre, archivo, original, roto] of lista) {
  const ruta = path.join(RAIZ, archivo);
  const antes = fs.readFileSync(ruta, 'utf8');
  const veces = antes.split(original).length - 1;
  if (veces !== 1) {
    resultados.push({ nombre, estado: 'NO APLICA', detalle: `el texto aparece ${veces} veces en ${archivo} (¿cambió el código?)` });
    continue;
  }
  pendiente = { ruta, antes };
  fs.writeFileSync(ruta, antes.replace(original, roto));
  let r;
  try {
    r = spawnSync(process.execPath, ['--test', '--test-timeout=60000', 'test/*.test.js'], { cwd: RAIZ, encoding: 'utf8', timeout: 300000 });
  } finally {
    fs.writeFileSync(ruta, antes); // siempre se revierte
    pendiente = null;
  }
  const fallidos = ((r.stdout || '').match(/^not ok \d+ - (?!\/|test\/).*$/gm) || []).map(l => l.replace(/^not ok \d+ - /, ''));
  const detectado = r.status !== 0;
  resultados.push({ nombre, estado: detectado ? 'DETECTADO' : 'SIN DETECTAR', detalle: fallidos.slice(0, 2).join(' | ') });
  console.log(`${detectado ? '✔' : '✘'} ${nombre}${detectado ? '' : '  ← falta un test'}`);
}

const sinDetectar = resultados.filter(r => r.estado !== 'DETECTADO');
console.log(`\n${resultados.length - sinDetectar.length}/${resultados.length} cambios a propósito detectados por los tests.`);
for (const r of sinDetectar) console.log(`  ${r.estado}: ${r.nombre} — ${r.detalle}`);
process.exit(sinDetectar.length ? 1 : 0);
