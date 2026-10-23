// AfipSDK simulado para los tests (el sistema lo usa con GM_AFIP_API_URL): responde como el servicio real
// a la autenticación, la numeración, el pedido de CAE y el padrón. Guarda cada pedido para revisarlo.
const http = require('http');

// Padrón de ejemplo: una SRL responsable inscripta, una monotributista y un consumidor final
const PADRON = {
  30712345671: { datosGenerales: { razonSocial: 'LA ESQUINA SRL', estadoClave: 'ACTIVO',
    domicilioFiscal: { direccion: 'AV CORRIENTES 1234', localidad: 'CABA', descripcionProvincia: 'CIUDAD AUTONOMA BUENOS AIRES' } },
  datosRegimenGeneral: { impuesto: [{ idImpuesto: 30 }, { idImpuesto: 10 }] } },
  27301234568: { datosGenerales: { apellido: 'GOMEZ', nombre: 'ANA', estadoClave: 'ACTIVO' },
    datosMonotributo: { categoriaMonotributo: { descripcionCategoria: 'C' } } },
  20400000000: { datosGenerales: { apellido: 'PEREZ', nombre: 'JUAN', estadoClave: 'ACTIVO' } }
};

async function iniciarArcaSimulado() {
  // caido: ARCA no responde (503). cortarDespuesDeEmitir: emite el comprobante pero la respuesta no llega (503),
  // como cuando se corta internet justo después de pedir el CAE. emitidos: para FECompConsultar.
  const arca = { pedidos: [], ultimo: {}, rechazar: null, padron: { ...PADRON }, caido: false, cortarDespuesDeEmitir: false, emitidos: {} };
  const servidor = http.createServer((req, res) => {
    let cuerpo = '';
    req.on('data', d => { cuerpo += d; });
    req.on('end', () => {
      const responder = (obj, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (arca.caido) return responder({ message: 'Service Unavailable' }, 503);
      if (req.url.endsWith('/v1/afip/auth')) return responder({ token: 't', sign: 's', expiration: '2099-01-01' });
      const { method, params } = JSON.parse(cuerpo || '{}');
      arca.pedidos.push({ method, params });
      if (method === 'FECompConsultar') {
        const c = arca.emitidos[`${params.FeCompConsReq.CbteTipo}-${params.FeCompConsReq.CbteNro}`];
        return responder({ FECompConsultarResult: c ? { ResultGet: c } : { Errors: { Err: { Code: 602, Msg: 'Sin Resultados' } } } });
      }
      if (method === 'FECompUltimoAutorizado')
        return responder({ FECompUltimoAutorizadoResult: { CbteNro: arca.ultimo[params.CbteTipo] || 0 } });
      if (method === 'FECAESolicitar') {
        if (arca.rechazar) {
          return responder({ FECAESolicitarResult: { FeDetResp: { FECAEDetResponse: {
            Resultado: 'R', Observaciones: { Obs: { Code: 10013, Msg: arca.rechazar } } } } } });
        }
        // Como ARCA: el número tiene que ser exactamente el siguiente al último autorizado
        const tipo = params.FeCAEReq.FeCabReq.CbteTipo;
        const numero = params.FeCAEReq.FeDetReq.FECAEDetRequest.CbteDesde;
        if (numero !== (arca.ultimo[tipo] || 0) + 1) {
          return responder({ FECAESolicitarResult: { FeDetResp: { FECAEDetResponse: {
            Resultado: 'R', Observaciones: { Obs: { Code: 10016, Msg: 'El numero de comprobante no es el proximo a autorizar' } } } } } });
        }
        arca.ultimo[tipo] = numero;
        const det = params.FeCAEReq.FeDetReq.FECAEDetRequest;
        const cae = String(74000000000000 + arca.pedidos.length);
        arca.emitidos[`${tipo}-${numero}`] = { CbteDesde: numero, ImpTotal: det.ImpTotal, DocNro: det.DocNro, CbteFch: String(det.CbteFch),
          CodAutorizacion: cae, FchVto: '20261201', Resultado: 'A' };
        if (arca.cortarDespuesDeEmitir) { arca.cortarDespuesDeEmitir = false; return responder({ message: 'Gateway Timeout' }, 503); }
        return responder({ FECAESolicitarResult: { FeDetResp: { FECAEDetResponse: {
          Resultado: 'A', CAE: cae, CAEFchVto: '20261201' } } } });
      }
      if (method === 'getPersona_v2') {
        const persona = arca.padron[params.idPersona];
        return persona ? responder({ personaReturn: persona }) : responder({ message: 'No existe persona con ese Id' }, 500);
      }
      responder({});
    });
  });
  await new Promise(ok => servidor.listen(0, '127.0.0.1', ok));
  arca.url = `http://127.0.0.1:${servidor.address().port}/api/`;
  arca.cerrar = () => new Promise(ok => servidor.close(ok));
  return arca;
}

module.exports = { iniciarArcaSimulado };
