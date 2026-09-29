const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join('c:/Users/Administrador/Documents/Sistema de gesti\u00f3n gastronomico/data/gastromanager.db');
console.log('DB path:', dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) { console.log('ERROR abriendo DB:', err.message); process.exit(1); }
  console.log('DB abierta OK');
});

db.serialize(() => {
  db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", [], (err, rows) => {
    if (err) console.log('ERROR tablas:', err.message);
    else { console.log('\n=== TABLAS ==='); rows.forEach(r => console.log(' -', r.name)); }
  });

  db.all("SELECT id, nombre, email, password, rol FROM usuarios", [], (err, rows) => {
    if (err) console.log('ERROR usuarios:', err.message);
    else {
      console.log('\n=== USUARIOS ===');
      rows.forEach(r => console.log(JSON.stringify(r)));
    }
    db.close();
  });
});
