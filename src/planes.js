'use strict';
// Planes de Morfi: qué incluye cada uno y cuánto cuesta. Es el ÚNICO lugar con precios y módulos:
// lo usan el local (src/licencia.js), Morfi Nube (nube/) y la pantalla "Tu plan". La landing repite los precios
// a mano (landing/index.html, sección #precios): si cambian acá, cambiarlos también ahí.
// Precios finales en pesos por mes (actualizarlos con la inflación; referencia en docs/PLANES.md).
//
// Lo básico de un local (pedidos, mesas, cocina, caja, cobros, factura electrónica, stock, reportes, copias de
// seguridad, funcionar sin internet) está en TODOS los planes y nunca se apaga: ni con el plan vencido.

// Módulos que dependen del plan
const MODULOS = {
  mesa_qr: 'Pedido y pago con Mercado Pago desde el QR de la mesa',
  online: 'Pedidos online: carta con link fijo, WhatsApp e Instagram',
  apps_delivery: 'Integración con PedidosYa, Rappi y otras apps de delivery',
  whatsapp: 'WhatsApp Business: comprobantes, avisos y recordatorios de reservas',
  personal: 'Personal: fichadas, turnos y reparto de propinas',
  fidelizacion: 'Fidelización: puntos, cupones y gift cards',
  costos: 'Ganancias detalladas (por día, mes, plato y canal), recetas y costos',
  contabilidad: 'Contabilidad: gastos, cuentas a pagar, IVA, resultados y libro diario',
  panel_nube: 'Panel Morfi Nube: tus ventas desde el celular',
  multisucursal: 'Varias sucursales y precios centrales',
  asistente: 'Asistente IA que atiende WhatsApp (pedidos y reservas)'
};

const PRO = ['mesa_qr', 'online', 'apps_delivery', 'whatsapp', 'personal', 'fidelizacion', 'costos', 'contabilidad', 'panel_nube'];

const PLANES = {
  esencial: { nombre: 'Esencial', precio: 24900, modulos: [],
    para: 'Cafés, bares, rotiserías y locales chicos' },
  pro: { nombre: 'Pro', precio: 49900, modulos: PRO,
    para: 'Restaurantes con salón, delivery y equipo' },
  cadenas: { nombre: 'Cadenas', precio: 44900, por_local: true, minimo_locales: 2, modulos: [...PRO, 'multisucursal'],
    para: 'Dos o más sucursales' },
  // Prueba gratis de una instalación nueva (y de un local nuevo en la nube): todo incluido
  prueba: { nombre: 'Prueba gratis', precio: 0, modulos: Object.keys(MODULOS), interno: true }
};

// Se suman a cualquier plan
const EXTRAS = {
  asistente: { nombre: 'Asistente IA por WhatsApp', precio: 19900,
    nota: 'El consumo de IA va en la cuenta de Anthropic del local (su propia clave)' }
};

const DIAS_PRUEBA = 30;
// Con el plan vencido sigue todo igual estos días; después quedan solo los módulos de Esencial
const DIAS_GRACIA = 10;
// Desde cuántos días antes de vencer se avisa
const DIAS_AVISO = 7;
// Pago adelantado: anual = 2 meses gratis; semestral = 10 % menos
const DESCUENTOS = { semestral: 0.10, anual: 2 / 12 };

// A dónde escribe el cliente para contratar o cambiar de plan (botón "Quiero este plan")
const VENTAS = {
  whatsapp: process.env.MORFI_VENTAS_WHATSAPP || '', // con código de país, solo números: 5491112345678
  email: process.env.MORFI_VENTAS_EMAIL || ''
};

const PLAN_MINIMO = Object.fromEntries(Object.keys(MODULOS).map(m =>
  [m, Object.keys(EXTRAS).includes(m) ? m : ['esencial', 'pro', 'cadenas'].find(p => PLANES[p].modulos.includes(m))]));

// Módulos de un plan con sus extras
function modulosDe(plan, extras = []) {
  const base = (PLANES[plan] || PLANES.esencial).modulos;
  return [...new Set([...base, ...extras.filter(e => EXTRAS[e])])];
}

// Plan más barato que incluye el módulo (o el extra que hay que sumar)
const planMinimo = modulo => PLAN_MINIMO[modulo] || null;

module.exports = { MODULOS, PLANES, EXTRAS, DIAS_PRUEBA, DIAS_GRACIA, DIAS_AVISO, DESCUENTOS, VENTAS, modulosDe, planMinimo };
