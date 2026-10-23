'use strict';
const {
  get, errorHttp, errorInterno, autenticar, esAdmin, emitEvento, actualizarParcial, MODOS_QR_MESA, requiere, PORT, urlPublica
} = require('../contexto');
const os = require('os');

module.exports = function registrarRutas(app) {

// ============ RED DEL LOCAL ============
// Direcciones de esta PC en la red del local, para el QR "Conectar celulares y tablets". Las arma el servidor:
// desde la misma PC el navegador ve "localhost", que en un celular no abre nada.
const esPrivada = ip => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
// Redes virtuales de Windows y de programas (WSL, Hyper-V, VirtualBox, Docker, VPN): un celular no llega por ahí
const esVirtual = nombre => /vEthernet|WSL|Hyper-V|VirtualBox|VMware|Docker|vboxnet|ZeroTier|Tailscale|Hamachi|Bluetooth/i.test(nombre);
function direccionesLocales() {
  return Object.entries(os.networkInterfaces())
    .flatMap(([interfaz, datos]) => (datos || []).map(d => ({ ...d, interfaz })))
    .filter(d => (d.family === 'IPv4' || d.family === 4) && !d.internal && esPrivada(d.address) && !esVirtual(d.interfaz))
    // Primero las típicas de un router (192.168.x.x)
    .sort((a, b) => Number(!a.address.startsWith('192.168.')) - Number(!b.address.startsWith('192.168.')))
    .map(d => ({ ip: d.address, interfaz: d.interfaz, url: `http://${d.address}:${PORT}` }));
}

app.get('/api/red-local', autenticar, requiere('catalogo'), (req, res) => {
  try {
    res.json({ direcciones: direccionesLocales(), publica: urlPublica() || null });
  } catch (err) { errorInterno(res, err); }
});

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
    // Actualización parcial: el asistente de primer ingreso solo envía tipo de negocio y módulos.
    // Antes se escribían todos los campos y nombre_negocio quedaba en NULL (la base lo rechazaba).
    const b = { ...(req.body || {}) };
    if (b.modulos_activos !== undefined) b.modulos_activos = JSON.stringify(Array.isArray(b.modulos_activos) ? b.modulos_activos : []);
    if (b.terminologia !== undefined) b.terminologia = JSON.stringify(b.terminologia && typeof b.terminologia === 'object' ? b.terminologia : {});
    if (b.nombre_negocio !== undefined && !String(b.nombre_negocio).trim()) throw errorHttp(400, 'El nombre del negocio es obligatorio');
    if (b.qr_mesa_modo !== undefined && !MODOS_QR_MESA.includes(b.qr_mesa_modo)) throw errorHttp(400, 'Modo de pedido por QR inválido');
    // Programa de puntos: cada cuántos pesos se gana un punto, cuánto vale al canjear y desde cuántos se canjea
    for (const c of ['puntos_cada', 'puntos_valor']) if (b[c] !== undefined && !(Number(b[c]) > 0)) throw errorHttp(400, 'Los valores de los puntos tienen que ser mayores a cero');
    if (b.puntos_minimo !== undefined && !(Number(b.puntos_minimo) >= 0)) throw errorHttp(400, 'Mínimo de puntos inválido');
    await actualizarParcial('configuracion', 1, b, ['nombre_negocio', 'direccion', 'telefono', 'email', 'cuit', 'tasa_iva',
      'moneda', 'activar_impresion', 'tipo_negocio', 'modulos_activos', 'terminologia', 'setup_completado', 'mozo_cobra_mesa', 'pin_autorizacion', 'arqueo_ciego',
      'qr_mesa_modo', 'puntos_activo', 'puntos_cada', 'puntos_valor', 'puntos_minimo']);
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
