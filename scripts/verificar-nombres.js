// Verifica que ningún módulo de src/ use un nombre compartido sin declararlo ni importarlo.
// Uso: node scripts/verificar-nombres.js [carpeta del proyecto]   (lo ejecuta npm test)
const fs = require('fs');
const path = require('path');
const RAIZ = process.argv[2] || path.join(__dirname, '..');

const archivos = ['server.js'];
(function recorrer(dir) {
  for (const f of fs.readdirSync(path.join(RAIZ, dir))) {
    const rel = path.join(dir, f);
    if (fs.statSync(path.join(RAIZ, rel)).isDirectory()) recorrer(rel);
    else if (f.endsWith('.js')) archivos.push(rel);
  }
})('src');

const CONOCIDOS = [
  'PORT', 'DATA_DIR', 'SECRET_KEY', 'origenPermitido', 'allowedOrigins', 'cargarSecretKey',
  'db', 'dbTx', 'txContexto', 'run', 'get', 'all', 'transaccion', 'setEmisor', 'emisor', 'conexion', 'colaTx',
  'ZONA_HORARIA', 'offsetZonaMin', 'LOCAL', 'fechaLocal',
  'errorHttp', 'actualizarParcial', 'slugificar', 'parseCfgPlataforma', 'errorInterno',
  'usuarioDesdeToken', 'autenticar', 'firmarToken', 'esAdmin', 'loginLimiter', 'apiLimiter', 'pedidoOnlineLimiter',
  'emitEvento', 'iniciarRealtime', 'io', 'server', 'app', 'express', 'helmet', 'cors', 'http', 'Server', 'sqlite3', 'AsyncLocalStorage',
  'generarNumeroPedido', 'resolverItems', 'importe', 'recalcularTotales', 'registrarPago', 'registrarPagoTx', 'METODOS_PAGO',
  'getIntCfg', 'setIntCfg', 'urlPublica', 'mpRequest', 'esperar', 'tnRequest',
  'DIR_BACKUPS', 'NOMBRE_BACKUP', 'BACKUPS_CONSERVAR', 'listarBackups', 'crearBackup', 'backupSiCorresponde', 'backupEnCurso',
  'agregarColumna', 'migrarEsquema', 'PERFILES_NEGOCIO', 'datosProducto', 'plataformaSinSecretos', 'resumenCaja', 'redondear',
  'CAMPOS_SECRETOS', 'MASCARA', 'enmascarar', 'facturandoPedidos',
  'crypto', 'fs', 'path', 'bcrypt', 'jwt', 'rateLimit', 'Afip', 'comandaAutomatica', 'ticketAlCobrar', 'imprimirComanda', 'imprimirTicket', 'imprimirPrueba', 'listarImpresorasSistema', 'leerImpresora', 'opcionesImpresion', 'OPCIONES_POR_DEFECTO', 'esperarImpresiones', 'Ticket', 'codificar', 'envolver', 'datosImpresora', 'requiere', 'tienePermiso', 'datosSesion', 'ROLES', 'PERMISOS', 'normalizarRol', 'esRolValido', 'permisosDeRol', 'verificarQuedaAdmin', 'PAUSA_TN_MS', 'API_MP', 'API_TN'
];

let problemas = 0;
for (const rel of archivos) {
  const texto = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
  // Sacar comentarios de línea y strings simples para no confundir texto con código
  const codigo = texto.replace(/^\s*(?:get|set)\s+[\w$]+\s*\(/gm, '(').replace(/\/\/.*$/gm, '').replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
  const declarados = new Set();
  const decl = /(?:function\s+|const\s+|let\s+|var\s+|class\s+)([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = decl.exec(codigo))) declarados.add(m[1]);
  const destr = /(?:const|let|var)\s*\{([^}]*)\}\s*=/g;
  while ((m = destr.exec(codigo))) m[1].split(',').map(s => s.trim().split(':').pop().trim()).filter(Boolean).forEach(n => declarados.add(n));
  const params = /function\s*[\w$]*\s*\(([^)]*)\)/g;
  while ((m = params.exec(codigo))) m[1].split(',').map(s => s.trim().replace(/=.*$/, '').trim()).filter(Boolean).forEach(n => declarados.add(n));
  const flechas = /\(([^()]*)\)\s*=>|([A-Za-z_$][\w$]*)\s*=>/g;
  while ((m = flechas.exec(codigo))) (m[1] || m[2] || '').split(',').map(s => s.trim().replace(/[{}]/g, '').replace(/=.*$/, '').trim()).filter(Boolean).forEach(n => declarados.add(n));

  for (const n of CONOCIDOS) {
    if (declarados.has(n)) continue;
    const re = new RegExp(`(?<![.\\w$])${n.replace('$', '\\$')}(?![\\w$:])`);
    if (re.test(codigo)) { problemas++; console.log(`${rel}: usa "${n}" sin declararlo ni importarlo`); }
  }
}
console.log(problemas ? `${problemas} problema(s)` : 'Sin nombres sin definir');
process.exit(problemas ? 1 : 0);
