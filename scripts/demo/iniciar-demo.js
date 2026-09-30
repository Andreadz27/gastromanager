// Inicia el entorno de demostración (La Buena Mesa) en http://localhost:3100
// Regenera los datos en cada inicio para que "hoy" siempre tenga movimiento.
// Uso: npm run demo            (regenera y arranca)
//      npm run demo -- --mantener   (arranca con los datos que ya había)
// No toca la base real (data/): usa demo/datos.
'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');
const DATOS = path.join(RAIZ, 'demo', 'datos');
const PUERTO = process.env.DEMO_PUERTO || '3100';

if (!process.argv.includes('--mantener') || !fs.existsSync(path.join(DATOS, 'gastromanager.db'))) {
  execFileSync(process.execPath, [path.join(__dirname, 'generar-datos.js'), DATOS], { stdio: 'inherit' });
}

const servidor = spawn(process.execPath, [path.join(RAIZ, 'server.js')], {
  env: { ...process.env, GM_DATA_DIR: DATOS, PORT: PUERTO, NODE_ENV: 'demo', SECRET_KEY: '' },
  stdio: 'inherit'
});
console.log(`\n  Demo: http://localhost:${PUERTO}   (Ctrl+C para cerrar)`);
console.log('  Usuarios (clave demo1234):');
console.log('    admin@labuenamesa.com      Administrador');
console.log('    encargado@labuenamesa.com  Encargado');
console.log('    caja@labuenamesa.com       Cajero');
console.log('    lucas@labuenamesa.com      Mozo');
console.log('    cocina@labuenamesa.com     Cocina\n');
process.on('SIGINT', () => { servidor.kill(); process.exit(0); });
servidor.on('exit', code => process.exit(code || 0));
