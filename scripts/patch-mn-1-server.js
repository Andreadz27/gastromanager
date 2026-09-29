'use strict';
// Patch 1: server.js — reemplaza sección CONFIGURACION con perfiles + endpoints nuevos
const fs = require('fs');
const file = require('path').join(__dirname, '..', 'server.js');
let src = fs.readFileSync(file, 'utf8');
const E = src.includes('\r\n') ? '\r\n' : '\n';
if (src.includes('PERFILES_NEGOCIO')) { console.log('server.js ya aplicado'); process.exit(0); }

const VIEJO = `// ============ CONFIGURACION ============

app.get('/api/config', autenticar, async (req, res) => {
  try {
    const config = await get('SELECT * FROM configuracion WHERE id = 1');
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/config', autenticar, esAdmin, async (req, res) => {
  try {
    const { nombre_negocio, direccion, telefono, email, cuit, tasa_iva, moneda, activar_impresion } = req.body;
    await run(\`UPDATE configuracion SET 
      nombre_negocio = ?, direccion = ?, telefono = ?, email = ?, cuit = ?, tasa_iva = ?, moneda = ?, activar_impresion = ?
      WHERE id = 1\`,
      [nombre_negocio, direccion, telefono, email, cuit, tasa_iva, moneda, activar_impresion]);
    const config = await get('SELECT * FROM configuracion WHERE id = 1');
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});`;

const NUEVO = `// ============ CONFIGURACION ============

const PERFILES_NEGOCIO = {
  restaurante_grande:  { label:'Restaurante Grande',    modulos:['pos','mesas','pedidos','delivery','cocina','productos','stock','proveedores','clientes','caja','reportes'], terminologia:{pedido:'Comanda',mesa:'Mesa',producto:'Plato'} },
  restaurante_mediano: { label:'Restaurante Mediano',   modulos:['pos','mesas','pedidos','delivery','cocina','productos','stock','proveedores','clientes','caja','reportes'], terminologia:{pedido:'Pedido', mesa:'Mesa',producto:'Plato'} },
  restaurante_chico:   { label:'Restaurante Chico',     modulos:['pos','mesas','pedidos','cocina','productos','stock','clientes','caja','reportes'],                        terminologia:{pedido:'Pedido', mesa:'Mesa',producto:'Plato'} },
  cafeteria:           { label:'Cafeteria / Bar',       modulos:['pos','pedidos','productos','stock','proveedores','clientes','caja','reportes'],                           terminologia:{pedido:'Venta',  mesa:'Mostrador',producto:'Producto'} },
  panaderia:           { label:'Panaderia / Rotiseria', modulos:['pos','pedidos','cocina','productos','stock','proveedores','clientes','caja','reportes'],                   terminologia:{pedido:'Venta',  mesa:'Mostrador',producto:'Producto'} },
  heladeria:           { label:'Heladeria / Kiosco',    modulos:['pos','pedidos','productos','stock','clientes','caja','reportes'],                                         terminologia:{pedido:'Venta',  mesa:'Mostrador',producto:'Producto'} },
  personalizado:       { label:'Personalizado',         modulos:['pos','mesas','pedidos','delivery','cocina','productos','stock','proveedores','clientes','caja','reportes'], terminologia:{pedido:'Pedido', mesa:'Mesa',producto:'Producto'} },
};

app.get('/api/config/perfiles', autenticar, async (req, res) => {
  res.json(PERFILES_NEGOCIO);
});

app.get('/api/config', autenticar, async (req, res) => {
  try {
    const config = await get('SELECT * FROM configuracion WHERE id = 1');
    if (config) {
      try { config.modulos_activos = JSON.parse(config.modulos_activos || '[]'); } catch(e) { config.modulos_activos = []; }
      try { config.terminologia    = JSON.parse(config.terminologia    || '{}'); } catch(e) { config.terminologia    = {}; }
    }
    res.json(config);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/config', autenticar, esAdmin, async (req, res) => {
  try {
    const { nombre_negocio, direccion, telefono, email, cuit, tasa_iva, moneda, activar_impresion,
            tipo_negocio, modulos_activos, terminologia, setup_completado } = req.body;
    const modulosJson     = modulos_activos != null ? JSON.stringify(Array.isArray(modulos_activos) ? modulos_activos : []) : null;
    const terminologiaJson = terminologia != null ? JSON.stringify(typeof terminologia === 'object' ? terminologia : {}) : null;
    await run(\`UPDATE configuracion SET
      nombre_negocio = ?, direccion = ?, telefono = ?, email = ?, cuit = ?,
      tasa_iva = ?, moneda = ?, activar_impresion = ?,
      tipo_negocio     = COALESCE(?, tipo_negocio),
      modulos_activos  = COALESCE(?, modulos_activos),
      terminologia     = COALESCE(?, terminologia),
      setup_completado = COALESCE(?, setup_completado)
      WHERE id = 1\`,
      [nombre_negocio, direccion, telefono, email, cuit, tasa_iva, moneda, activar_impresion,
       tipo_negocio||null, modulosJson, terminologiaJson, setup_completado!=null?setup_completado:null]);
    const config = await get('SELECT * FROM configuracion WHERE id = 1');
    if (config) {
      try { config.modulos_activos = JSON.parse(config.modulos_activos || '[]'); } catch(e) { config.modulos_activos = []; }
      try { config.terminologia    = JSON.parse(config.terminologia    || '{}'); } catch(e) { config.terminologia    = {}; }
    }
    emitEvento('config:actualizar', { tipo_negocio: config && config.tipo_negocio });
    res.json(config);
  } catch (err) { res.status(500).json({ error: err.message }); }
});`;

// Normalize line endings for comparison
const srcNorm = src.replace(/\r\n/g, '\n');
const viejoNorm = VIEJO.replace(/\r\n/g, '\n');
if (!srcNorm.includes(viejoNorm)) { console.error('Patron no encontrado en server.js'); process.exit(1); }
const result = srcNorm.replace(viejoNorm, NUEVO.replace(/\r\n/g, '\n')).replace(/\n/g, E);
fs.writeFileSync(file, result, 'utf8');
console.log('OK server.js');
