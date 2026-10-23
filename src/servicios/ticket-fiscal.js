'use strict';
// Datos fiscales del ticket de una factura electrónica: lo que tiene que decir el comprobante impreso
// (RG 4291 y RG 1415 de ARCA), el código QR (RG 4892) y el "IVA contenido" al consumidor final (Ley 27.743).
// Los usan el ticket térmico (impresion.js) y el de la impresora del navegador (GET /api/pedidos/:id → fiscal).
// Antes el ticket solo decía tipo, número y CAE: no servía como factura.
const QRCode = require('qrcode');
const { CONDICIONES_IVA } = require('./facturacion');

// Condición frente al IVA del local (Integraciones → AFIP)
const CONDICIONES_EMISOR = { ri: 'IVA Responsable Inscripto', monotributo: 'Responsable Monotributo', exento: 'IVA Sujeto Exento' };
const LETRAS = { 1: 'A', 3: 'A', 6: 'B', 8: 'B', 11: 'C', 13: 'C' };

const digitos = s => String(s || '').replace(/\D/g, '');
const fechaAR = s => {
  const d = digitos(s);
  return d.length >= 8 ? `${d.slice(6, 8)}/${d.slice(4, 6)}/${d.slice(0, 4)}` : '';
};
const fechaISO = s => {
  const d = digitos(s);
  return d.length >= 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : '';
};
const formatoCuit = s => { const d = digitos(s); return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : String(s || ''); };
const numeroComprobante = c => `${String(c.punto_venta).padStart(5, '0')}-${String(c.numero_comprobante).padStart(8, '0')}`;

// Si no se configuró, se deduce del tipo de factura (la C es de monotributo)
const condicionEmisor = (cfg, tipo) => CONDICIONES_EMISOR[cfg.condicion_iva] || (LETRAS[tipo] === 'C' ? CONDICIONES_EMISOR.monotributo : CONDICIONES_EMISOR.ri);

// Lo que falta en Integraciones → AFIP para que el ticket tenga los datos obligatorios del emisor
function faltantesEmisor(cfg, negocio = {}) {
  return [
    !cfg.razon_social && 'razón social',
    !(cfg.domicilio || negocio.direccion) && 'domicilio comercial',
    !cfg.iibb && 'Ingresos Brutos',
    !cfg.inicio_actividades && 'inicio de actividades'
  ].filter(Boolean);
}

// URL del QR de ARCA: https://www.afip.gob.ar/fe/qr/?p=<JSON en base64> (especificación de la RG 4892)
function urlQrArca(cfg, c) {
  const datos = {
    ver: 1,
    fecha: fechaISO(c.fecha_comprobante),
    cuit: Number(digitos(cfg.cuit)),
    ptoVta: Number(c.punto_venta),
    tipoCmp: Number(c.tipo_comprobante),
    nroCmp: Number(c.numero_comprobante),
    importe: Number(c.total),
    moneda: 'PES',
    ctz: 1,
    tipoDocRec: c.cuit_receptor ? 80 : 99,
    nroDocRec: c.cuit_receptor ? Number(digitos(c.cuit_receptor)) : 0,
    tipoCodAut: 'E',
    codAut: Number(c.cae)
  };
  return 'https://www.afip.gob.ar/fe/qr/?p=' + Buffer.from(JSON.stringify(datos)).toString('base64');
}

// Todo lo que va en el ticket de la factura c (fila de comprobantes_afip)
function datosTicketFiscal(c, cfg = {}, negocio = {}) {
  const tipo = Number(c.tipo_comprobante);
  const letra = LETRAS[tipo] || '';
  const neto = Number(c.imp_neto) || 0;
  const iva = Number(c.imp_iva) || 0;
  return {
    letra,
    codigo: String(tipo).padStart(3, '0'),
    nombre: c.tipo_comprobante_nombre,
    numero: numeroComprobante(c),
    fecha: fechaAR(c.fecha_comprobante),
    emisor: {
      razon_social: cfg.razon_social || negocio.nombre_negocio || '',
      domicilio: cfg.domicilio || negocio.direccion || '',
      cuit: formatoCuit(cfg.cuit),
      iibb: cfg.iibb || '',
      condicion: condicionEmisor(cfg, tipo),
      inicio_actividades: fechaAR(cfg.inicio_actividades)
    },
    // Sin CUIT: consumidor final
    receptor: c.cuit_receptor ? {
      cuit: formatoCuit(c.cuit_receptor),
      razon_social: c.razon_social_receptor || '',
      condicion: CONDICIONES_IVA[c.condicion_iva_receptor] || ''
    } : null,
    total: Number(c.total) || 0,
    // Factura A: neto e IVA discriminados. Factura B: "IVA contenido" (Ley 27.743). Factura C: nada de IVA.
    discriminado: letra === 'A' ? { neto, iva, alicuota: neto ? Math.round(iva / neto * 1000) / 10 : 0 } : null,
    iva_contenido: letra === 'B' ? iva : null,
    cae: String(c.cae || ''),
    cae_vencimiento: fechaAR(c.cae_vencimiento),
    qr: urlQrArca(cfg, c),
    // Emitida contra el servicio de pruebas de ARCA: no tiene validez fiscal
    prueba: c.modo === 'homologacion'
  };
}

// Igual, con el QR en SVG para imprimir desde el navegador
async function datosTicketFiscalConQR(c, cfg, negocio) {
  const d = datosTicketFiscal(c, cfg, negocio);
  d.qr_svg = await QRCode.toString(d.qr, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
  return d;
}

module.exports = { datosTicketFiscal, datosTicketFiscalConQR, urlQrArca, faltantesEmisor, CONDICIONES_EMISOR };
