const db = require('better-sqlite3')('./database/gastromanager.db');

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
console.log('TABLAS:', tables.join(', '));

const counts = {};
tables.forEach(t => {
  try { counts[t] = db.prepare('SELECT COUNT(*) as n FROM ' + t).get().n; } catch(e) { counts[t] = '?'; }
});
console.log('CONTEOS:', JSON.stringify(counts, null, 2));

// Muestra config del negocio
try {
  const cfg = db.prepare('SELECT * FROM configuracion LIMIT 1').get();
  console.log('CONFIG:', JSON.stringify(cfg));
} catch(e) { console.log('CONFIG error:', e.message); }

// Muestra productos de ejemplo
try {
  const prods = db.prepare('SELECT id, nombre, precio, categoria FROM productos LIMIT 10').all();
  console.log('PRODUCTOS EJEMPLO:', JSON.stringify(prods));
} catch(e) { console.log('PRODUCTOS error:', e.message); }

// Muestra pedidos recientes
try {
  const peds = db.prepare("SELECT id, numero_pedido, tipo, estado, total FROM pedidos ORDER BY id DESC LIMIT 5").all();
  console.log('PEDIDOS RECIENTES:', JSON.stringify(peds));
} catch(e) { console.log('PEDIDOS error:', e.message); }

db.close();
