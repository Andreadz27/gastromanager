// Datos del titular de Morfi en los documentos legales: se editan en docs/legales/datos.json y este script los
// pasa a la política de privacidad, los términos y la orden de alta.
// Uso:  npm run legales              (aplica los datos)
//       node scripts/datos-legales.js --revisar   (falla si algún documento no coincide con datos.json; lo usa el test)
// En el HTML cada dato va en <span data-dato="clave">; en la orden de alta, entre <!--dato:clave--> y <!--/dato-->.
// Los enlaces mailto: y wa.me de las páginas legales también se actualizan (email y whatsapp_numero).
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const RAIZ = args.includes('--raiz') ? path.resolve(args[args.indexOf('--raiz') + 1]) : path.join(__dirname, '..');
const DATOS = path.join(RAIZ, 'docs', 'legales', 'datos.json');
const HTML = ['landing/privacidad.html', 'landing/terminos.html'];
const MD = ['docs/legales/ORDEN-DE-ALTA.md'];

const escapar = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function valor(datos, clave, archivo) {
  const v = datos[clave];
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${archivo}: falta "${clave}" en docs/legales/datos.json`);
  return v.trim();
}

function aplicar(texto, archivo, datos) {
  if (archivo.endsWith('.html')) {
    texto = texto.replace(/(<span data-dato="(\w+)">)[^<]*(<\/span>)/g, (m, a, clave, c) => a + escapar(valor(datos, clave, archivo)) + c);
    texto = texto.replace(/href="mailto:[^"]*"/g, `href="mailto:${escapar(valor(datos, 'email', archivo))}"`);
    texto = texto.replace(/https:\/\/wa\.me\/\d+/g, `https://wa.me/${valor(datos, 'whatsapp_numero', archivo).replace(/\D/g, '')}`);
  } else {
    texto = texto.replace(/(<!--dato:(\w+)-->)[^\n]*?(<!--\/dato-->)/g, (m, a, clave, c) => a + valor(datos, clave, archivo) + c);
  }
  return texto;
}

function main() {
  const datos = JSON.parse(fs.readFileSync(DATOS, 'utf8'));
  const revisar = args.includes('--revisar');
  const distintos = [];
  for (const archivo of [...HTML, ...MD]) {
    const ruta = path.join(RAIZ, archivo);
    const antes = fs.readFileSync(ruta, 'utf8');
    const despues = aplicar(antes, archivo, datos);
    if (antes === despues) continue;
    distintos.push(archivo);
    if (!revisar) fs.writeFileSync(ruta, despues);
  }
  if (revisar && distintos.length) {
    console.error(`No coinciden con docs/legales/datos.json: ${distintos.join(', ')}. Correr: npm run legales`);
    process.exit(1);
  }
  console.log(distintos.length ? `Actualizados: ${distintos.join(', ')}` : 'Los documentos ya tienen los datos de datos.json.');
}

try { main(); } catch (e) { console.error(e.message); process.exit(1); }
