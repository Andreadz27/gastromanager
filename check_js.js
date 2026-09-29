const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const jsDir = 'c:/Users/Administrador/Documents/Sistema de gesti\u00f3n gastronomico/public/js';
const files = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'));

let hasError = false;
files.forEach(f => {
  const full = path.join(jsDir, f);
  try {
    execSync(`node --check "${full}"`, { stdio: 'pipe' });
    console.log('OK  ', f);
  } catch (e) {
    hasError = true;
    console.log('ERR ', f, '-', e.stderr.toString().split('\n').slice(0,2).join(' '));
  }
});
if (!hasError) console.log('\nTodos los scripts OK');
