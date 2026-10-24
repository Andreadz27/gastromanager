const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Los datos del titular se editan en docs/legales/datos.json y `npm run legales` los pasa a los documentos
const RAIZ = path.join(__dirname, '..');
const SCRIPT = path.join(RAIZ, 'scripts', 'datos-legales.js');
const ARCHIVOS = ['docs/legales/datos.json', 'docs/legales/ORDEN-DE-ALTA.md', 'landing/privacidad.html', 'landing/terminos.html'];
const correr = (...a) => spawnSync(process.execPath, [SCRIPT, ...a], { encoding: 'utf8' });

test('los documentos legales tienen los datos de docs/legales/datos.json', () => {
  const r = correr('--revisar');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const f of ['landing/privacidad.html', 'landing/terminos.html']) {
    assert.doesNotMatch(fs.readFileSync(path.join(RAIZ, f), 'utf8'), /class="completar"/, `${f}: quedó un dato sin completar`);
  }
});

test('npm run legales cambia un dato en todos los documentos (texto, mailto y wa.me)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'morfi-legales-'));
  try {
    for (const f of ARCHIVOS) {
      fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true });
      fs.copyFileSync(path.join(RAIZ, f), path.join(tmp, f));
    }
    const datos = JSON.parse(fs.readFileSync(path.join(tmp, 'docs/legales/datos.json'), 'utf8'));
    const viejo = datos.titular;
    Object.assign(datos, { titular: 'Morfi <S.R.L.>', email: 'hola@morfi.com.ar', whatsapp_numero: '5491100000000' });
    fs.writeFileSync(path.join(tmp, 'docs/legales/datos.json'), JSON.stringify(datos));

    assert.equal(correr('--raiz', tmp, '--revisar').status, 1, 'detecta que no coinciden');
    const r = correr('--raiz', tmp);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    for (const f of ['landing/privacidad.html', 'landing/terminos.html']) {
      const t = fs.readFileSync(path.join(tmp, f), 'utf8');
      assert.match(t, /<span data-dato="titular">Morfi &lt;S\.R\.L\.&gt;<\/span>/, f);
      assert.ok(!t.includes(viejo), `${f}: quedó el titular anterior`);
      assert.match(t, /href="mailto:hola@morfi\.com\.ar"/, f);
      assert.doesNotMatch(t, /wa\.me\/(?!5491100000000)/, f);
    }
    assert.match(fs.readFileSync(path.join(tmp, 'docs/legales/ORDEN-DE-ALTA.md'), 'utf8'), /<!--dato:titular-->Morfi <S\.R\.L\.><!--\/dato-->/);
    assert.equal(correr('--raiz', tmp, '--revisar').status, 0);

    // Un dato vacío no se publica en blanco
    datos.cuit = '';
    fs.writeFileSync(path.join(tmp, 'docs/legales/datos.json'), JSON.stringify(datos));
    const vacio = correr('--raiz', tmp);
    assert.equal(vacio.status, 1);
    assert.match(vacio.stderr, /falta "cuit"/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
