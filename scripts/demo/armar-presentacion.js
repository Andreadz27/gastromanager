// Arma la página de presentación con el video, los capítulos y las capturas de la demo.
// Requiere haber corrido antes: npm run demo:video
// Uso: npm run demo:presentacion
// Salida: demo/salida/presentacion/ (index.html para publicar y ver.html para abrir en el navegador)
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SALIDA = path.join(__dirname, '..', '..', 'demo', 'salida');
const DESTINO = path.join(SALIDA, 'presentacion');

const TITULOS = {
  '01-ingreso': 'Ingreso con usuario y contraseña',
  '02-dashboard': 'Dashboard con ventas del día y alertas',
  '03-mesas': 'Mapa del salón: mesas ocupadas y reservadas',
  '04-punto-de-venta': 'Punto de venta',
  '05-cocina': 'Comandas en cocina con tiempo de espera',
  '06-detalle-pedido': 'Detalle del pedido: cobro, precuenta y factura',
  '07-delivery': 'Delivery de PedidosYa, Rappi y WhatsApp',
  '08-caja': 'Caja con arqueo por medio de pago',
  '09-rentabilidad': 'Rentabilidad por plato',
  '10-inventario': 'Inventario con niveles de stock',
  '11-roles': 'Alta de usuario con los permisos del rol',
  '12-impresoras': 'Impresoras térmicas por estación',
  '13-carta-qr': 'Carta digital',
  '14-pantalla-cocina': 'Pantalla de cocina para tablet o TV',
  '15-carta-celular': 'La carta en el celular del cliente'
};

function buscarFfmpeg() {
  const candidatos = [process.env.FFMPEG, 'ffmpeg'];
  const winget = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  if (fs.existsSync(winget)) {
    for (const pkg of fs.readdirSync(winget).filter(d => /ffmpeg/i.test(d))) {
      for (const sub of fs.readdirSync(path.join(winget, pkg))) candidatos.push(path.join(winget, pkg, sub, 'bin', 'ffmpeg.exe'));
    }
  }
  for (const c of candidatos.filter(Boolean)) { try { execFileSync(c, ['-version'], { stdio: 'ignore' }); return c; } catch (e) {} }
  return null;
}

for (const f of ['recorrido.mp4', 'portada.jpg', 'capitulos.json']) {
  if (!fs.existsSync(path.join(SALIDA, f))) { console.error(`Falta demo/salida/${f}: corré primero "npm run demo:video"`); process.exit(1); }
}
fs.rmSync(DESTINO, { recursive: true, force: true });
fs.mkdirSync(path.join(DESTINO, 'media'), { recursive: true });
fs.mkdirSync(path.join(DESTINO, 'capturas'), { recursive: true });
fs.copyFileSync(path.join(SALIDA, 'recorrido.mp4'), path.join(DESTINO, 'media', 'recorrido.mp4'));
fs.copyFileSync(path.join(SALIDA, 'portada.jpg'), path.join(DESTINO, 'media', 'portada.jpg'));

// Capturas en WebP (mucho más livianas que PNG) si hay ffmpeg
const ffmpeg = buscarFfmpeg();
const capturas = [];
for (const archivo of fs.readdirSync(path.join(SALIDA, 'capturas')).filter(f => f.endsWith('.png')).sort()) {
  const nombre = archivo.replace('.png', '');
  const origen = path.join(SALIDA, 'capturas', archivo);
  let salida = `capturas/${nombre}.png`;
  if (ffmpeg) {
    salida = `capturas/${nombre}.webp`;
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-i', origen, '-c:v', 'libwebp', '-quality', '82', path.join(DESTINO, salida)]);
  } else {
    fs.copyFileSync(origen, path.join(DESTINO, salida));
  }
  capturas.push({ archivo: salida, titulo: TITULOS[nombre] || nombre, celular: nombre.includes('celular') });
}

const capitulos = JSON.parse(fs.readFileSync(path.join(SALIDA, 'capitulos.json'), 'utf8'));
const plantilla = fs.readFileSync(path.join(__dirname, 'presentacion.html'), 'utf8');
const pagina = plantilla
  .replace('/*CAPITULOS*/[]', JSON.stringify(capitulos))
  .replace('/*CAPTURAS*/[]', JSON.stringify(capturas));
fs.writeFileSync(path.join(DESTINO, 'index.html'), pagina);
// Versión para abrir con doble clic (documento HTML completo)
fs.writeFileSync(path.join(DESTINO, 'ver.html'),
  '<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n' + pagina + '\n</body>\n</html>\n');

const peso = f => fs.statSync(path.join(DESTINO, f)).size;
const total = [...['index.html', 'media/recorrido.mp4', 'media/portada.jpg'], ...capturas.map(c => c.archivo)].reduce((s, f) => s + peso(f), 0);
console.log(`Presentación lista en demo/salida/presentacion (${capturas.length} capturas, ${capitulos.length} capítulos, ${(total / 1048576).toFixed(1)} MB)`);
console.log('Abrila con doble clic en demo/salida/presentacion/ver.html');
