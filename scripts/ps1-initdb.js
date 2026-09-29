'use strict';
// patch-s1: init-db.js — columna origen en pedidos
const fs = require('fs'), path = require('path');
const f = path.join(__dirname, '..', 'init-db.js');
let s = fs.readFileSync(f, 'utf8');
const E = s.includes('\r\n') ? '\r\n' : '\n';
if (s.includes('ADD COLUMN origen')) { console.log('SKIP init-db'); process.exit(0); }
const V = `  db.run(\`ALTER TABLE configuracion ADD COLUMN setup_completado INTEGER DEFAULT 0\`, () => {});`;
const N = `  db.run(\`ALTER TABLE configuracion ADD COLUMN setup_completado INTEGER DEFAULT 0\`, () => {});
  db.run(\`ALTER TABLE pedidos ADD COLUMN origen TEXT DEFAULT ''\`, () => {});`;
const sN = s.replace(/\r\n/g,'\n');
if (!sN.includes(V.replace(/\r\n/g,'\n'))) { console.error('PATRON NO ENCONTRADO init-db'); process.exit(1); }
fs.writeFileSync(f, sN.replace(V.replace(/\r\n/g,'\n'), N.replace(/\r\n/g,'\n')).replace(/\n/g, E), 'utf8');
console.log('OK init-db.js');
