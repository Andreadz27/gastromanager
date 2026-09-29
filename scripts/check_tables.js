const s = require('sqlite3').verbose();
const d = new s.Database('data/gastromanager.db');
d.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", function(e, r) {
  if (e) { console.log('ERROR:', e.message); d.close(); return; }
  r.forEach(function(t) { console.log(t.name); });
  d.close();
});
