'use strict';
// Factura electrónica AFIP/ARCA de un pedido cobrado.
// La usan la ruta de facturar y el cobro en la mesa (cobrar y facturar en un solo paso).
const Afip = require('@afipsdk/afip.js');
const { run, get } = require('../db');
const { emitEvento } = require('../realtime');
const { LOCAL } = require('../tiempo');
const { errorHttp } = require('../util');
const { getIntCfg } = require('./integraciones');

const NOMBRES_COMPROBANTE = { 1: 'Factura A', 2: 'Nota Débito A', 3: 'Nota Crédito A',
                              6: 'Factura B', 7: 'Nota Débito B', 8: 'Nota Crédito B',
                             11: 'Factura C', 12: 'Nota Débito C', 13: 'Nota Crédito C',
                             51: 'Factura M' };

// Evita pedir dos CAE para el mismo pedido si llegan dos solicitudes a la vez
// (la llamada a AFIP es HTTP externa y no puede ir dentro de una transacción)
const facturandoPedidos = new Set();

// Valida los datos del comprobante sin llamar a AFIP. Devuelve { tipo, cuit } o lanza un error 400.
function validarDatosFactura(tipoComprobante, cuitReceptor) {
  const tipo = parseInt(tipoComprobante, 10);
  // CUIT del receptor: obligatorio para Factura A
  const cuit = String(cuitReceptor || '').replace(/\D/g, '');
  if (!tipo) throw errorHttp(400, 'Faltan datos obligatorios.');
  // 1 = Factura A, 6 = Factura B, 11 = Factura C
  if (![1, 6, 11].includes(tipo))
    throw errorHttp(400, 'Tipo de comprobante no soportado (usar Factura A, B o C).');
  if (tipo === 1 && cuit.length !== 11)
    throw errorHttp(400, 'La Factura A requiere el CUIT del cliente (11 dígitos).');
  return { tipo, cuit };
}

async function emitirFactura(pedidoId, tipoComprobante, cuitReceptor) {
  const { tipo: tipo_comprobante, cuit: cuitRecep } = validarDatosFactura(tipoComprobante, cuitReceptor);
  if (facturandoPedidos.has(pedidoId))
    throw errorHttp(409, 'Ya se está generando el comprobante de este pedido.');
  facturandoPedidos.add(pedidoId);
  try {
    const cfg = await getIntCfg('afip');
    if (!cfg.activa)        throw errorHttp(400, 'La integración AFIP no está activa.');
    if (!cfg.cuit)          throw errorHttp(400, 'Configurá el CUIT en Integraciones → AFIP.');
    if (!cfg.access_token)  throw errorHttp(400, 'Configurá el Access Token de AfipSDK en Integraciones → AFIP.');

    const pedido = await get('SELECT * FROM pedidos WHERE id = ?', [pedidoId]);
    if (!pedido) throw errorHttp(404, 'Pedido no encontrado.');
    if (pedido.estado !== 'pagado') throw errorHttp(400, 'Solo se pueden facturar pedidos cobrados.');

    // No emitir comprobante duplicado para el mismo pedido
    const yaFacturado = await get(
      'SELECT id, cae, tipo_comprobante_nombre FROM comprobantes_afip WHERE pedido_id = ?', [pedidoId]);
    if (yaFacturado)
      throw errorHttp(409, `Este pedido ya tiene ${yaFacturado.tipo_comprobante_nombre} con CAE ${yaFacturado.cae}.`);

    // Construir instancia Afip con o sin certificado propio
    const afipOpts = {
      CUIT:         parseInt(String(cfg.cuit).replace(/-/g, ''), 10),
      production:   cfg.modo === 'produccion',
      access_token: cfg.access_token
    };
    // Si el usuario subió su propio cert + key, los usamos
    if (cfg.cert && cfg.key && !/^•+$/.test(cfg.key)) {
      afipOpts.cert = cfg.cert;
      afipOpts.key  = cfg.key;
    }
    const afipInst = new Afip(afipOpts);

    const ptoVenta = parseInt(cfg.pto_venta, 10) || 1;

    // Obtener último número de comprobante para calcular el siguiente
    const ultimoNro = await afipInst.ElectronicBilling.getLastVoucher(ptoVenta, tipo_comprobante);
    const nroComprobante = ultimoNro + 1;

    // Fecha en formato YYYYMMDD que requiere AFIP
    const hoy = new Date();
    const fechaAFIP = `${hoy.getFullYear()}${String(hoy.getMonth() + 1).padStart(2, '0')}${String(hoy.getDate()).padStart(2, '0')}`;

    // Calcular importes. El total del pedido incluye IVA.
    const total = parseFloat(pedido.total) || 0;
    // Alícuotas AFIP: 3 = 0%, 4 = 10.5%, 5 = 21%, 6 = 27%
    const ALICUOTAS = { 3: 0, 4: 0.105, 5: 0.21, 6: 0.27 };
    const codigoAlicuota = ALICUOTAS[cfg.iva_tipo] !== undefined ? Number(cfg.iva_tipo) : 5;
    const tasaIVA = ALICUOTAS[codigoAlicuota];
    // Factura A y B (emisor Responsable Inscripto) discriminan IVA; Factura C (monotributo) no lleva IVA
    const discriminaIVA = tipo_comprobante === 1 || tipo_comprobante === 6;
    let impNeto = total, impIVA = 0;
    if (discriminaIVA) {
      impNeto = parseFloat((total / (1 + tasaIVA)).toFixed(2));
      impIVA  = parseFloat((total - impNeto).toFixed(2));
    }

    const voucherData = {
      CbteTipo:   tipo_comprobante,
      PtoVta:     ptoVenta,
      Concepto:   1,           // 1=Productos, 2=Servicios, 3=Productos y Servicios
      // Factura A: 80 = CUIT del receptor. B/C: 99 = Consumidor Final
      DocTipo:    tipo_comprobante === 1 ? 80 : 99,
      DocNro:     tipo_comprobante === 1 ? parseInt(cuitRecep, 10) : 0,
      // Condición IVA del receptor (obligatoria): 1 = Resp. Inscripto, 5 = Consumidor Final
      CondicionIVAReceptorId: tipo_comprobante === 1 ? 1 : 5,
      CbteDesde:  nroComprobante,
      CbteHasta:  nroComprobante,
      CbteFch:    parseInt(fechaAFIP, 10),
      ImpTotal:   total,
      ImpTotConc: 0,
      ImpNeto:    impNeto,
      ImpOpEx:    0,
      ImpIVA:     impIVA,
      ImpTrib:    0,
      MonId:      'PES',
      MonCotiz:   1,
      ...(discriminaIVA ? {
        Iva: [{ Id: codigoAlicuota, BaseImp: impNeto, Importe: impIVA }]
      } : {})
    };

    // Llamada real al WSFE de AFIP
    const resultado = await afipInst.ElectronicBilling.createVoucher(voucherData);
    const nombre = NOMBRES_COMPROBANTE[tipo_comprobante] || `Tipo ${tipo_comprobante}`;

    await run(
      `INSERT INTO comprobantes_afip
         (pedido_id, tipo_comprobante, tipo_comprobante_nombre, punto_venta,
          numero_comprobante, cae, cae_vencimiento, fecha_comprobante, total)
       VALUES (?, ?, ?, ?, ?, ?, ?, date('now', ${LOCAL()}), ?)`,
      [pedidoId, tipo_comprobante, nombre, ptoVenta, nroComprobante, resultado.CAE, resultado.CAEFchVto, total]
    );

    emitEvento('afip:comprobante', { pedido_id: pedidoId, cae: resultado.CAE });

    return {
      ok:                 true,
      cae:                resultado.CAE,
      cae_vencimiento:    resultado.CAEFchVto,
      numero_comprobante: nroComprobante,
      punto_venta:        ptoVenta,
      tipo_comprobante,
      tipo_nombre:        nombre
    };
  } finally {
    facturandoPedidos.delete(pedidoId);
  }
}

module.exports = { emitirFactura, validarDatosFactura };
