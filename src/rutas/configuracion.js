'use strict';
const {
  run, get, errorInterno, autenticar, esAdmin, emitEvento
} = require('../contexto');

module.exports = function registrarRutas(app) {

// ============ CONFIGURACION ============

const PERFILES_NEGOCIO = {
  restaurante_grande:  { label:'Restaurante Grande',    modulos:['pos','mesas','pedidos','delivery','cocina','productos','stock','proveedores','clientes','caja','reportes'], terminologia:{pedido:'Comanda',mesa:'Mesa',producto:'Plato'} },
  restaurante_mediano: { label:'Restaurante Mediano',   modulos:['pos','mesas','pedidos','delivery','cocina','productos','stock','proveedores','clientes','caja','reportes'], terminologia:{pedido:'Pedido', mesa:'Mesa',producto:'Plato'} },
  restaurante_chico:   { label:'Restaurante Chico',     modulos:['pos','mesas','pedidos','cocina','productos','stock','clientes','caja','reportes'],                        terminologia:{pedido:'Pedido', mesa:'Mesa',producto:'Plato'} },
  cafeteria:           { label:'Cafeteria / Bar',       modulos:['pos','pedidos','productos','stock','proveedores','clientes','caja','reportes'],                           terminologia:{pedido:'Venta',  mesa:'Mostrador',producto:'Producto'} },
  panaderia:           { label:'Panaderia / Rotiseria', modulos:['pos','pedidos','cocina','productos','stock','proveedores','clientes','caja','reportes'],                   terminologia:{pedido:'Venta',  mesa:'Mostrador',producto:'Producto'} },
  heladeria:           { label:'Heladeria',             modulos:['pos','pedidos','cocina','productos','stock','proveedores','clientes','caja','reportes'],                   terminologia:{pedido:'Venta',  mesa:'Mostrador',producto:'Producto'} },
  kiosco:              { label:'Kiosco',                modulos:['pos','productos','stock','proveedores','caja','reportes'],                                                 terminologia:{pedido:'Venta',  mesa:'Mostrador',producto:'Articulo' } },
  personalizado:       { label:'Personalizado',         modulos:['pos','mesas','pedidos','delivery','cocina','productos','stock','proveedores','clientes','caja','reportes'], terminologia:{pedido:'Pedido', mesa:'Mesa',      producto:'Producto'} },
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
  } catch (err) { errorInterno(res, err); }
});

app.put('/api/config', autenticar, esAdmin, async (req, res) => {
  try {
    const { nombre_negocio, direccion, telefono, email, cuit, tasa_iva, moneda, activar_impresion,
            tipo_negocio, modulos_activos, terminologia, setup_completado } = req.body;
    const modulosJson     = modulos_activos != null ? JSON.stringify(Array.isArray(modulos_activos) ? modulos_activos : []) : null;
    const terminologiaJson = terminologia != null ? JSON.stringify(typeof terminologia === 'object' ? terminologia : {}) : null;
    await run(`UPDATE configuracion SET
      nombre_negocio = ?, direccion = ?, telefono = ?, email = ?, cuit = ?,
      tasa_iva = ?, moneda = ?, activar_impresion = ?,
      tipo_negocio     = COALESCE(?, tipo_negocio),
      modulos_activos  = COALESCE(?, modulos_activos),
      terminologia     = COALESCE(?, terminologia),
      setup_completado = COALESCE(?, setup_completado)
      WHERE id = 1`,
      [nombre_negocio, direccion, telefono, email, cuit, tasa_iva, moneda, activar_impresion,
       tipo_negocio||null, modulosJson, terminologiaJson, setup_completado!=null?setup_completado:null]);
    const config = await get('SELECT * FROM configuracion WHERE id = 1');
    if (config) {
      try { config.modulos_activos = JSON.parse(config.modulos_activos || '[]'); } catch(e) { config.modulos_activos = []; }
      try { config.terminologia    = JSON.parse(config.terminologia    || '{}'); } catch(e) { config.terminologia    = {}; }
    }
    emitEvento('config:actualizar', { tipo_negocio: config && config.tipo_negocio });
    res.json(config);
  } catch (err) { errorInterno(res, err); }
});

};
