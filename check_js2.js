const fs = require('fs');
const path = require('path');

const jsDir = 'c:/Users/Administrador/Documents/Sistema de gesti\u00f3n gastronomico/public/js';
const files = ['api.js','dashboard.js','pos.js','productos.js','stock.js','proveedores.js',
  'clientes.js','mesas.js','pedidos.js','delivery.js','cocina.js','caja.js',
  'reportes.js','usuarios.js','config.js','integraciones.js','app.js'];

files.forEach(f => {
  const content = fs.readFileSync(path.join(jsDir, f), 'utf8');
  const lines = content.split(/\r?\n/);
  const last5 = lines.slice(-6).map((l,i) => (lines.length-5+i) + ': ' + l).join('\n');
  
  // Contar llaves
  let open = 0, close = 0;
  for (const ch of content) {
    if (ch === '{') open++;
    if (ch === '}') close++;
  }
  const balanced = open === close ? 'OK' : `DESBALANCEADO (${open} abren, ${close} cierran)`;
  
  console.log('\n=== ' + f + ' === llaves: ' + balanced);
  console.log(last5);
});
