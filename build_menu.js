const fs = require('fs');
const base = 'c:/Users/Administrador/Documents/Sistema de gesti\u00f3n gastronomico/';
const p1 = JSON.parse(fs.readFileSync(base + 'menu_p1.json', 'utf8'));
const p2 = JSON.parse(fs.readFileSync(base + 'menu_p2.json', 'utf8'));
const all = p1.concat(p2);
const dest = base + 'public/js/menu.js';
fs.writeFileSync(dest, all.join('\n'), 'utf8');
const stat = fs.statSync(dest);
console.log('OK - menu.js escrito:', stat.size, 'bytes,', all.length, 'lineas');
