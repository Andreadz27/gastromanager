const http = require('http');
const body = JSON.stringify({ email: 'admin@gastromanager.com', password: 'admin123' });
const opts = {
  hostname: 'localhost', port: 3000, path: '/api/auth/login', method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
};
const req = http.request(opts, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    const r = JSON.parse(d);
    if (!r.token) { console.log('ERROR:', d); process.exit(1); }
    const token = r.token;
    console.log('TOKEN:', token);

    // Test integraciones/config
    const opts2 = {
      hostname: 'localhost', port: 3000, path: '/api/integraciones/config', method: 'GET',
      headers: { Authorization: 'Bearer ' + token }
    };
    http.request(opts2, res2 => {
      let d2 = '';
      res2.on('data', c => d2 += c);
      res2.on('end', () => console.log('integraciones/config status=' + res2.statusCode + ' body=' + d2.substring(0, 300)));
    }).end();

    // Test integraciones/estado
    const opts3 = {
      hostname: 'localhost', port: 3000, path: '/api/integraciones/estado', method: 'GET',
      headers: { Authorization: 'Bearer ' + token }
    };
    http.request(opts3, res3 => {
      let d3 = '';
      res3.on('data', c => d3 += c);
      res3.on('end', () => console.log('integraciones/estado status=' + res3.statusCode + ' body=' + d3));
    }).end();
  });
});
req.on('error', e => console.log('REQ ERROR:', e.message));
req.write(body);
req.end();
