const http = require('http');

function get(token, path, cb) {
  const opts = {
    hostname: 'localhost', port: 3000, path: path, method: 'GET',
    headers: { Authorization: 'Bearer ' + token }
  };
  http.request(opts, res => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => { try { cb(JSON.parse(d)); } catch(e) { cb(d); } });
  }).end();
}

function post(token, path, body, cb) {
  const data = JSON.stringify(body);
  const opts = {
    hostname: 'localhost', port: 3000, path: path, method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
  };
  const req = http.request(opts, res => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => { try { cb(JSON.parse(d)); } catch(e) { cb(d); } });
  });
  req.write(data);
  req.end();
}

const loginBody = JSON.stringify({ email: 'admin@gastromanager.com', password: 'admin123' });
const loginOpts = {
  hostname: 'localhost', port: 3000, path: '/api/auth/login', method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginBody) }
};

const req = http.request(loginOpts, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    const r = JSON.parse(d);
    const token = r.token;
    let done = 0;
    const total = 7;
    function check() { done++; if (done === total) process.exit(0); }

    get(token, '/api/config', data => { console.log('CONFIG:', JSON.stringify(data)); check(); });
    get(token, '/api/productos', data => { console.log('PRODUCTOS_COUNT:', Array.isArray(data) ? data.length : '?'); if (Array.isArray(data)) { const cats = [...new Set(data.map(p=>p.categoria))]; console.log('CATEGORIAS:', JSON.stringify(cats)); console.log('PRODUCTOS_MUESTRA:', JSON.stringify(data.slice(0,6).map(p=>({id:p.id,nombre:p.nombre,precio:p.precio,categoria:p.categoria})))); } check(); });
    get(token, '/api/mesas', data => { console.log('MESAS:', JSON.stringify(Array.isArray(data) ? data.slice(0,8) : data)); check(); });
    get(token, '/api/pedidos', data => { console.log('PEDIDOS_COUNT:', Array.isArray(data) ? data.length : '?'); if(Array.isArray(data)) console.log('PEDIDOS_MUESTRA:', JSON.stringify(data.slice(0,4).map(p=>({id:p.id,numero:p.numero_pedido,tipo:p.tipo,estado:p.estado,total:p.total})))); check(); });
    get(token, '/api/clientes', data => { console.log('CLIENTES_COUNT:', Array.isArray(data) ? data.length : JSON.stringify(data)); check(); });
    get(token, '/api/stock', data => { console.log('STOCK_COUNT:', Array.isArray(data) ? data.length : '?'); check(); });
    get(token, '/api/usuarios', data => { console.log('USUARIOS:', JSON.stringify(Array.isArray(data) ? data.map(u=>({id:u.id,nombre:u.nombre,rol:u.rol})) : data)); check(); });
  });
});
req.write(loginBody);
req.end();
