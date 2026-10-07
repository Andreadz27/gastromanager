'use strict';
// Roles y permisos. El servidor controla cada endpoint con requiere(permiso);
// el frontend recibe la lista de permisos del usuario para mostrar u ocultar opciones.

const PERMISOS = {
  'pedidos.ver': 'Ver pedidos y mesas',
  'pedidos.tomar': 'Tomar pedidos, agregar ítems, reservas y estado de mesas',
  'pedidos.descuento': 'Aplicar descuentos',
  'pedidos.cobrar': 'Cobrar, links de pago y facturación',
  'pedidos.cancelar': 'Cancelar pedidos',
  'caja.operar': 'Abrir, cerrar y registrar movimientos de caja',
  'caja.historial': 'Historial y arqueos de caja',
  'cocina': 'Pantalla de cocina',
  'delivery': 'Gestionar entregas',
  'clientes': 'Clientes',
  'stock.ver': 'Consultar stock y proveedores',
  'stock.mover': 'Registrar movimientos de stock',
  'catalogo': 'Editar productos, categorías, mesas, promociones, proveedores y carta QR',
  'reportes': 'Dashboard y reportes de ventas',
  'reportes.costos': 'Rentabilidad y costos',
  'contabilidad': 'Contabilidad: gastos, cuentas a pagar, IVA, estado de resultados y libro diario',
  'admin': 'Usuarios, configuración, integraciones, impresoras y copias de seguridad'
};

const TODOS = Object.keys(PERMISOS);

const ROLES = {
  admin: { nombre: 'Administrador', permisos: TODOS },
  encargado: { nombre: 'Encargado', permisos: TODOS.filter(p => p !== 'admin') },
  // Igual que el antiguo rol "vendedor"
  cajero: {
    nombre: 'Cajero',
    permisos: ['pedidos.ver', 'pedidos.tomar', 'pedidos.descuento', 'pedidos.cobrar', 'pedidos.cancelar',
      'caja.operar', 'cocina', 'delivery', 'clientes', 'stock.ver', 'stock.mover', 'reportes']
  },
  mozo: { nombre: 'Mozo', permisos: ['pedidos.ver', 'pedidos.tomar', 'clientes'] },
  cocina: { nombre: 'Cocina', permisos: ['cocina', 'stock.ver'] }
};

// Roles anteriores que se siguen aceptando
const ALIAS = { vendedor: 'cajero' };

const normalizarRol = rol => ALIAS[rol] || rol;
const esRolValido = rol => Object.prototype.hasOwnProperty.call(ROLES, normalizarRol(rol));
const permisosDeRol = rol => (ROLES[normalizarRol(rol)] || { permisos: [] }).permisos;

module.exports = { PERMISOS, ROLES, normalizarRol, esRolValido, permisosDeRol };
