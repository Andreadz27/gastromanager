// seed-helpers.js — HTTP helpers para scripts de seed
const http = require('http');

function httpReq(token, method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const opts = { hostname: 'localhost', port: 3000, path, method, headers };
    const r = http.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve(d); } });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

// Credenciales del admin: GM_EMAIL / GM_PASSWORD (la contraseña por defecto
// admin123 debe cambiarse en el primer ingreso, así que no sirve para los scripts)
async function login() {
  const email = process.env.GM_EMAIL || 'admin@gastromanager.com';
  const password = process.env.GM_PASSWORD;
  if (!password) throw new Error('Definí GM_PASSWORD (y GM_EMAIL si no es el admin por defecto)');
  const r = await httpReq(null, 'POST', '/api/auth/login', { email, password });
  if (!r.token) throw new Error('Login fallido: ' + JSON.stringify(r));
  return r.token;
}

const get  = (T, p)    => httpReq(T, 'GET',    p, null);
const post = (T, p, b) => httpReq(T, 'POST',   p, b);
const put  = (T, p, b) => httpReq(T, 'PUT',    p, b);
const del  = (T, p)    => httpReq(T, 'DELETE', p, null);

module.exports = { login, get, post, put, del };
