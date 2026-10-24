const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { SECRET_KEY } = require('./helpers');

// npm run actualizar, el reinicio con pm2 (en un archivo aparte: en el CI de Windows los tests de git tardan y
// juntos pasaban el límite de tiempo por archivo)
const RAIZ = path.join(__dirname, '..');
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@test.com', ...a], { cwd, encoding: 'utf8' }).trim();

// La instalación del local está en "Documents\Sistema de gestión gastronomico": con espacios en la ruta,
// pm2 start recibía la ruta partida y el local quedaba sin servidor
test('reinicia con pm2 aunque la carpeta de la instalación tenga espacios', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gm actualizar '));
  const bare = path.join(tmp, 'origen.git'), inst = path.join(tmp, 'Sistema de gestión'), dev = path.join(tmp, 'dev'), datos = path.join(tmp, 'datos');
  const bin = path.join(tmp, 'bin'), llamadas = path.join(tmp, 'pm2.txt');
  const salud = http.createServer((req, res) => res.end(JSON.stringify({ base: 'ok' })));
  await new Promise(r => salud.listen(0, '127.0.0.1', r));
  try {
    git(tmp, 'init', '--bare', '--quiet', '-b', 'main', bare);
    git(RAIZ, 'push', '--quiet', bare, 'HEAD:refs/heads/main');
    git(tmp, 'clone', '--quiet', bare, inst);
    git(tmp, 'clone', '--quiet', bare, dev);
    fs.symlinkSync(path.join(RAIZ, 'node_modules'), path.join(inst, 'node_modules'), 'junction');

    // pm2 de mentira: anota los argumentos que recibe
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'pm2.js'), `require('fs').appendFileSync(${JSON.stringify(llamadas)}, JSON.stringify(process.argv.slice(2)) + '\\n');`);
    fs.writeFileSync(path.join(bin, 'pm2.cmd'), '@node "%~dp0pm2.js" %*\r\n');
    fs.writeFileSync(path.join(bin, 'pm2'), '#!/bin/sh\nexec node "$(dirname "$0")/pm2.js" "$@"\n', { mode: 0o755 });
    const clavePath = Object.keys(process.env).find(k => k.toUpperCase() === 'PATH');
    const env = { ...process.env, [clavePath]: bin + path.delimiter + process.env[clavePath], PORT: String(salud.address().port),
      GM_DATA_DIR: datos, SECRET_KEY, GM_ENV_FILE: path.join(tmp, 'sin.env') };
    execFileSync(process.execPath, [path.join(inst, 'init-db.js')], { env, stdio: 'ignore' });

    fs.writeFileSync(path.join(dev, 'NOVEDAD.txt'), 'versión 2');
    git(dev, 'add', 'NOVEDAD.txt');
    git(dev, 'commit', '--quiet', '-m', 'Versión 2');
    git(dev, 'push', '--quiet', 'origin', 'main');

    const hijo = spawn(process.execPath, [path.join(inst, 'scripts', 'actualizar.js'), '--sin-npm'], { cwd: inst, env });
    let salida = '';
    hijo.stdout.on('data', d => { salida += d; });
    hijo.stderr.on('data', d => { salida += d; });
    const codigo = await new Promise(r => hijo.on('close', r));
    assert.equal(codigo, 0, salida);
    assert.match(salida, /Actualizado a/);
    const inicio = fs.readFileSync(llamadas, 'utf8').trim().split('\n').map(JSON.parse).find(a => a[0] === 'start');
    assert.equal(inicio[1], path.join(inst, 'ecosystem.config.js'), 'la ruta llega entera');
  } finally {
    salud.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
