'use strict';
// patch-pedidos-js.js — agrega badge de origen en la tabla de pedidos
const fs = require('fs'), pt = require('path');
const f = pt.join(__dirname, '..', 'public', 'js', 'pedidos.js');
let s = fs.readFileSync(f, 'utf8');
const E = s.includes('\r\n') ? '\r\n' : '\n';
if (s.includes('origen-badge')) { console.log('SKIP pedidos.js'); process.exit(0); }

// 1. Agregar columna "Origen" al thead
s = s.replace(
  '<th>N\\u00b0</th><th>Tipo</th><th>Mesa</th><th>Cliente</th>\n                   <th>Estado</th><th>Total</th><th>Fecha</th>',
  '<th>N\\u00b0</th><th>Tipo</th><th>Mesa</th><th>Cliente</th>\n                   <th>Origen</th><th>Estado</th><th>Total</th><th>Fecha</th>'
);

// 2. Agregar celda de origen en cada fila
const V = "        <td>${esc(p.numero_pedido)}</td>\n        <td>${esc(p.tipo)}</td>\n        <td>${esc(p.mesa_nombre || '-')}</td>\n        <td>${esc(p.cliente || '-')}</td>\n        <td>${fmtEstado(p.estado)}</td>";
const N = "        <td>${esc(p.numero_pedido)}</td>\n        <td>${esc(p.tipo)}</td>\n        <td>${esc(p.mesa_nombre || '-')}</td>\n        <td>${esc(p.cliente || '-')}</td>\n        <td>${Pedidos.fmtOrigen(p.origen)}</td>\n        <td>${fmtEstado(p.estado)}</td>";
const sN = s.replace(/\r\n/g, '\n');
const vN = V.replace(/\r\n/g, '\n');
if (!sN.includes(vN)) { console.error('PATRON fila no encontrado en pedidos.js'); process.exit(1); }
s = sN.replace(vN, N);

// 3. Agregar metodo fmtOrigen antes del cierre del objeto
const CIERRE = '  async cargarPedido(id) {';
const NUEVO = `  fmtOrigen(origen) {
    if (!origen) return '';
    const map = {
      whatsapp:  '<span class="origen-badge wa"><i class="fab fa-whatsapp"></i> WhatsApp</span>',
      instagram: '<span class="origen-badge ig"><i class="fab fa-instagram"></i> Instagram</span>',
      web:       '<span class="origen-badge web"><i class="fas fa-globe"></i> Web</span>'
    };
    return map[origen] || '';
  },\n\n  async cargarPedido(id) {`;
s = s.replace(CIERRE, NUEVO);

fs.writeFileSync(f, s.replace(/\n/g, E), 'utf8');
console.log('OK pedidos.js');
