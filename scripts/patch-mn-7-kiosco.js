'use strict';
// Patch: server.js — separa heladeria y kiosco como perfiles distintos
const fs = require('fs');
const file = require('path').join(__dirname, '..', 'server.js');
let src = fs.readFileSync(file, 'utf8');
const E = src.includes('\r\n') ? '\r\n' : '\n';

if (src.includes("label:'Kiosco'")) { console.log('Ya aplicado'); process.exit(0); }

const VIEJO = `  heladeria:           { label:'Heladeria / Kiosco',    modulos:['pos','pedidos','productos','stock','clientes','caja','reportes'],                                         terminologia:{pedido:'Venta',  mesa:'Mostrador',producto:'Producto'} },
  personalizado:       { label:'Personalizado',         modulos:['pos','mesas','pedidos','delivery','cocina','productos','stock','proveedores','clientes','caja','reportes'], terminologia:{pedido:'Pedido', mesa:'Mesa',producto:'Producto'} },`;

const NUEVO = `  heladeria:           { label:'Heladeria',             modulos:['pos','pedidos','cocina','productos','stock','proveedores','clientes','caja','reportes'],                   terminologia:{pedido:'Venta',  mesa:'Mostrador',producto:'Producto'} },
  kiosco:              { label:'Kiosco',                modulos:['pos','productos','stock','proveedores','caja','reportes'],                                                 terminologia:{pedido:'Venta',  mesa:'Mostrador',producto:'Articulo' } },
  personalizado:       { label:'Personalizado',         modulos:['pos','mesas','pedidos','delivery','cocina','productos','stock','proveedores','clientes','caja','reportes'], terminologia:{pedido:'Pedido', mesa:'Mesa',      producto:'Producto'} },`;

const srcN = src.replace(/\r\n/g, '\n');
const vN   = VIEJO.replace(/\r\n/g, '\n');
if (!srcN.includes(vN)) { console.error('Patron no encontrado'); process.exit(1); }
const result = srcN.replace(vN, NUEVO.replace(/\r\n/g, '\n')).replace(/\n/g, E);
fs.writeFileSync(file, result, 'utf8');
console.log('OK server.js — heladeria y kiosco separados');
