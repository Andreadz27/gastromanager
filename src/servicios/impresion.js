'use strict';
// Impresión térmica de comandas (cocina/barra) y tickets (cliente).
// Tipos de impresora:
//   red: ESC/POS directo al puerto TCP de la impresora (normalmente 9100)
//   usb: impresora instalada en el sistema operativo (cola de Windows en modo RAW; lp en Linux/Mac)
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { run, get, all } = require('../db');
const { emitEvento } = require('../realtime');
const { ZONA_HORARIA } = require('../tiempo');
const { getIntCfg } = require('./integraciones');
const { Ticket } = require('./escpos');
const { ES_DEMO } = require('../demo');

const TIEMPO_ESPERA_MS = 8000;

// ---------- Envío a la impresora ----------

function enviarRed(destino, datos) {
  const [host, puerto] = String(destino).trim().split(':');
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port: parseInt(puerto, 10) || 9100 });
    let terminado = false;
    const fin = err => {
      if (terminado) return;
      terminado = true;
      socket.destroy();
      err ? reject(err) : resolve();
    };
    socket.setTimeout(TIEMPO_ESPERA_MS, () => fin(new Error(`La impresora ${destino} no responde`)));
    socket.on('error', e => fin(new Error(`No se pudo conectar con la impresora ${destino} (${e.code || e.message})`)));
    socket.on('connect', () => socket.end(datos, () => setTimeout(() => fin(), 200)));
    socket.on('close', () => fin());
  });
}

// Windows: envío RAW a la cola de impresión con la API winspool (sin dependencias nativas).
// El nombre de la impresora y el archivo se pasan por variables de entorno (sin armar comandos con texto del usuario).
const SCRIPT_WINDOWS = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try {
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class GmRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool OpenPrinter(string nombre, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern int StartDocPrinter(IntPtr h, int nivel, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int escritos);
  public static void Enviar(string impresora, byte[] datos) {
    IntPtr h;
    if (!OpenPrinter(impresora, out h, IntPtr.Zero))
      throw new Exception("No se encontró la impresora '" + impresora + "' en Windows (error " + Marshal.GetLastWin32Error() + ")");
    try {
      DOCINFO di = new DOCINFO(); di.pDocName = "GastroManager"; di.pDataType = "RAW";
      if (StartDocPrinter(h, 1, di) == 0) throw new Exception("La impresora rechazó el trabajo (error " + Marshal.GetLastWin32Error() + ")");
      StartPagePrinter(h);
      int escritos;
      if (!WritePrinter(h, datos, datos.Length, out escritos)) throw new Exception("Error al enviar datos (error " + Marshal.GetLastWin32Error() + ")");
      EndPagePrinter(h);
      EndDocPrinter(h);
    } finally { ClosePrinter(h); }
  }
}
"@
[GmRawPrinter]::Enviar($env:GM_IMPRESORA, [IO.File]::ReadAllBytes($env:GM_ARCHIVO))
} catch {
  # Mensaje en texto plano (sin el formato CLIXML de PowerShell)
  $e = $_.Exception
  while ($e.InnerException) { $e = $e.InnerException }
  [Console]::Error.WriteLine($e.Message)
  exit 1
}
`;
const SCRIPT_WINDOWS_B64 = Buffer.from(SCRIPT_WINDOWS, 'utf16le').toString('base64');

function ejecutar(comando, args, opciones = {}) {
  return new Promise((resolve, reject) => {
    execFile(comando, args, { timeout: 30000, windowsHide: true, ...opciones }, (err, stdout, stderr) => {
      if (err) {
        // PowerShell puede devolver los errores serializados como CLIXML: extraer el texto
        let salida = String(stderr || err.message);
        if (salida.startsWith('#< CLIXML')) {
          salida = [...salida.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)].map(m => m[1]).join('')
            .replace(/_x000D_/g, '').replace(/_x000A_/g, '\n').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        }
        // Mensaje legible: la primera línea útil del error de PowerShell / lp
        const detalle = salida.split(/\r?\n/)
          .map(l => l.replace(/^Exception calling "Enviar" with "2" argument\(s\): /, '').trim())
          .find(l => l && !/^(At line|\+|CategoryInfo|FullyQualifiedErrorId|~)/.test(l));
        return reject(new Error(detalle || 'Error al imprimir'));
      }
      resolve(stdout);
    });
  });
}

async function enviarSistema(nombre, datos) {
  const archivo = path.join(os.tmpdir(), `gm-impresion-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
  fs.writeFileSync(archivo, datos);
  try {
    if (process.platform === 'win32') {
      await ejecutar('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', SCRIPT_WINDOWS_B64],
        { env: { ...process.env, GM_IMPRESORA: nombre, GM_ARCHIVO: archivo } });
    } else {
      await ejecutar('lp', ['-d', nombre, '-o', 'raw', archivo]);
    }
  } finally {
    fs.unlink(archivo, () => {});
  }
}

function enviar(impresora, datos) {
  // Demo pública: la impresión se simula (el servidor no se conecta a ninguna dirección)
  if (ES_DEMO) return Promise.resolve();
  return impresora.tipo === 'red' ? enviarRed(impresora.destino, datos) : enviarSistema(impresora.destino, datos);
}

// Impresoras instaladas en el sistema operativo (para elegir las USB)
async function listarImpresorasSistema() {
  try {
    if (process.platform === 'win32') {
      const salida = await ejecutar('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        'Get-Printer | Select-Object -ExpandProperty Name']);
      return salida.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    }
    const salida = await ejecutar('lpstat', ['-e']);
    return salida.split('\n').map(s => s.trim()).filter(Boolean);
  } catch (e) {
    return [];
  }
}

// ---------- Datos ----------

const leerImpresora = fila => {
  let categorias = [];
  try { categorias = JSON.parse(fila.categorias || '[]'); } catch (e) {}
  return { ...fila, categorias: Array.isArray(categorias) ? categorias.map(Number) : [] };
};

async function impresorasActivas(funcion) {
  const filas = await all(`SELECT * FROM impresoras WHERE activa = 1 AND ${funcion === 'ticket' ? 'imprime_tickets' : 'imprime_comandas'} = 1 ORDER BY id`);
  return filas.map(leerImpresora);
}

const OPCIONES_POR_DEFECTO = { ticket_al_cobrar: false, abrir_cajon: false, pie: '¡Gracias por su visita!' };
async function opcionesImpresion() {
  return { ...OPCIONES_POR_DEFECTO, ...(await getIntCfg('impresion')) };
}

async function datosPedido(pedidoId) {
  const pedido = await get(`
    SELECT p.*, m.nombre AS mesa_nombre, u.nombre AS usuario_nombre
    FROM pedidos p LEFT JOIN mesas m ON m.id = p.mesa_id LEFT JOIN usuarios u ON u.id = p.usuario_id
    WHERE p.id = ?`, [pedidoId]);
  if (!pedido) return null;
  pedido.items = await all(`
    SELECT pi.*, pr.categoria_id FROM pedido_items pi LEFT JOIN productos pr ON pr.id = pi.producto_id
    WHERE pi.pedido_id = ? ORDER BY pi.id`, [pedidoId]);
  pedido.pagos = await all('SELECT * FROM pagos WHERE pedido_id = ? ORDER BY id', [pedidoId]);
  pedido.entrega = await get('SELECT * FROM entregas WHERE pedido_id = ?', [pedidoId]);
  pedido.comprobante = await get('SELECT * FROM comprobantes_afip WHERE pedido_id = ? ORDER BY id DESC LIMIT 1', [pedidoId]);
  return pedido;
}

// ---------- Formato ----------

// SQLite guarda UTC sin zona ("AAAA-MM-DD HH:MM:SS")
const fechaUTC = s => new Date(String(s || '').replace(' ', 'T') + (String(s).includes('Z') ? '' : 'Z'));
const formatoFecha = (s, opciones) => new Intl.DateTimeFormat('es-AR', { timeZone: ZONA_HORARIA, ...opciones }).format(s ? fechaUTC(s) : new Date());
const hora = s => formatoFecha(s, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const fechaHora = s => formatoFecha(s, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const moneda = n => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(n) || 0);
const cantidad = n => (Number.isInteger(Number(n)) ? String(Number(n)) : String(Number(n).toFixed(2)).replace('.', ','));
const TIPOS = { salon: 'SALÓN', mostrador: 'MOSTRADOR', takeaway: 'PARA LLEVAR', delivery: 'DELIVERY' };
const METODOS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', mercadopago: 'Mercado Pago', transferencia: 'Transferencia', otro: 'Otro' };

// Comanda para cocina/barra. titulo: COMANDA | AGREGADO | ANULADO
function plantillaComanda(pedido, items, impresora, titulo) {
  const t = new Ticket(impresora.ancho === 58 ? 32 : 48);
  t.alinear('centro').negrita().tamano(2, 2).linea(titulo);
  t.linea(pedido.mesa_nombre ? String(pedido.mesa_nombre).toUpperCase() : (TIPOS[pedido.tipo] || String(pedido.tipo || '').toUpperCase()));
  t.normal();
  if (impresora.nombre) t.alinear('centro').linea(`[${impresora.nombre}]`).alinear('izquierda');
  t.columnas2(`Pedido ${pedido.numero_pedido}`, hora());
  if (pedido.usuario_nombre) t.linea(`Atiende: ${pedido.usuario_nombre}`);
  if (pedido.cliente && !pedido.mesa_nombre) t.linea(`Cliente: ${pedido.cliente}`);
  t.separador();
  for (const item of items) {
    t.negrita().tamano(1, 2).linea(`${cantidad(item.cantidad)} x ${item.nombre_producto}`).normal();
    if (item.notas) t.linea(`   >> ${item.notas}`);
  }
  t.separador();
  if (pedido.notas && titulo !== 'AGREGADO') t.negrita().linea(`NOTA: ${pedido.notas}`).negrita(false);
  if (pedido.entrega && pedido.entrega.direccion && titulo === 'COMANDA') t.linea(`Entrega: ${pedido.entrega.direccion}`);
  return t.avanzar(3).cortar().buffer();
}

// Ticket para el cliente (precuenta o comprobante de pago)
function plantillaTicket(pedido, negocio, opciones, impresora, extra = {}) {
  const t = new Ticket(impresora.ancho === 58 ? 32 : 48);
  t.alinear('centro').negrita().tamano(2, 2).linea(negocio.nombre_negocio || 'GastroManager').normal().alinear('centro');
  if (negocio.direccion) t.linea(negocio.direccion);
  if (negocio.telefono) t.linea(`Tel: ${negocio.telefono}`);
  if (negocio.cuit) t.linea(`CUIT: ${negocio.cuit}`);
  t.alinear('izquierda').separador();
  t.columnas2(`Pedido ${pedido.numero_pedido}`, fechaHora(pedido.cerrado_en || pedido.creado_en));
  if (pedido.mesa_nombre) t.linea(`Mesa: ${pedido.mesa_nombre}`);
  else t.linea(TIPOS[pedido.tipo] || pedido.tipo || '');
  if (pedido.usuario_nombre) t.linea(`Atendió: ${pedido.usuario_nombre}`);
  if (pedido.cliente) t.linea(`Cliente: ${pedido.cliente}`);
  t.separador();
  for (const item of pedido.items) {
    t.columnas2(`${cantidad(item.cantidad)} x ${item.nombre_producto}`, moneda(item.subtotal));
    if (Number(item.cantidad) !== 1) t.linea(`    ${moneda(item.precio_unitario)} c/u`);
  }
  t.separador();
  t.columnas2('Subtotal', moneda(pedido.subtotal));
  if (pedido.descuento) t.columnas2('Descuento', '-' + moneda(pedido.descuento));
  if (pedido.propina) t.columnas2('Propina', moneda(pedido.propina));
  if (pedido.entrega && pedido.entrega.costo_envio) t.columnas2('Envío', moneda(pedido.entrega.costo_envio));
  t.negrita().tamano(2, 2).columnas2('TOTAL', moneda(pedido.total)).normal();
  for (const pago of pedido.pagos) t.columnas2(`Pago ${METODOS[pago.metodo] || pago.metodo}`, moneda(pago.monto));
  if (extra.vuelto > 0) t.columnas2('Vuelto', moneda(extra.vuelto));
  if (pedido.estado !== 'pagado') t.alinear('centro').negrita().linea('*** PRECUENTA ***').normal();
  t.separador().alinear('centro');
  if (pedido.comprobante) {
    const c = pedido.comprobante;
    t.linea(`${c.tipo_comprobante_nombre} ${String(c.punto_venta).padStart(4, '0')}-${String(c.numero_comprobante).padStart(8, '0')}`);
    t.linea(`CAE ${c.cae} Vto. ${c.cae_vencimiento}`);
  } else {
    t.linea('Documento no válido como factura');
  }
  if (opciones.pie) t.linea(opciones.pie);
  t.avanzar(3).cortar();
  if (extra.abrirCajon) t.abrirCajon();
  return t.buffer();
}

function plantillaPrueba(impresora) {
  const t = new Ticket(impresora.ancho === 58 ? 32 : 48);
  t.alinear('centro').negrita().tamano(2, 2).linea('PRUEBA').normal().alinear('centro');
  t.linea(impresora.nombre).linea(fechaHora()).alinear('izquierda').separador();
  t.linea('Acentos: áéíóú ÁÉÍÓÚ ñÑ ü ¿? ¡!');
  t.columnas2('Producto de ejemplo', moneda(12345.5));
  t.negrita().linea('Negrita').negrita(false).tamano(1, 2).linea('Doble alto').tamano(2, 2).linea('Doble').normal();
  t.separador().alinear('centro').linea('Si ves este ticket, la impresora está lista.');
  return t.avanzar(3).cortar().buffer();
}

// ---------- Registro y envío ----------

async function imprimir(impresora, tipo, pedidoId, datos) {
  const copias = Math.max(1, Math.min(5, parseInt(impresora.copias, 10) || 1));
  try {
    for (let i = 0; i < copias; i++) await enviar(impresora, datos);
    await registrar(impresora, tipo, pedidoId, 'ok', null);
    return { impresora: impresora.nombre, ok: true };
  } catch (e) {
    await registrar(impresora, tipo, pedidoId, 'error', e.message);
    emitEvento('impresion:error', { impresora: impresora.nombre, tipo, pedido_id: pedidoId, error: e.message });
    console.error(`[impresión] ${impresora.nombre}: ${e.message}`);
    return { impresora: impresora.nombre, ok: false, error: e.message };
  }
}

async function registrar(impresora, tipo, pedidoId, estado, error) {
  try {
    await run('INSERT INTO impresiones (impresora_id, impresora_nombre, tipo, pedido_id, estado, error) VALUES (?, ?, ?, ?, ?, ?)',
      [impresora.id || null, impresora.nombre, tipo, pedidoId || null, estado, error]);
    await run('DELETE FROM impresiones WHERE id <= (SELECT MAX(id) - 1000 FROM impresiones)');
  } catch (e) { /* el registro nunca debe impedir imprimir */ }
}

// Ítems que corresponden a una impresora según sus categorías (sin categorías = todo)
const itemsDeImpresora = (impresora, items) => impresora.categorias.length
  ? items.filter(i => i.categoria_id && impresora.categorias.includes(Number(i.categoria_id)))
  : items;

// Imprime la comanda en cada impresora de comandas con los ítems que le tocan
async function imprimirComanda(pedidoId, { itemIds = null, titulo = 'COMANDA' } = {}) {
  const [pedido, impresoras] = await Promise.all([datosPedido(pedidoId), impresorasActivas('comanda')]);
  if (!pedido || !impresoras.length) return [];
  const items = itemIds ? pedido.items.filter(i => itemIds.includes(i.id)) : pedido.items;
  const resultados = [];
  for (const impresora of impresoras) {
    const suyos = itemsDeImpresora(impresora, items);
    if (!suyos.length) continue;
    resultados.push(await imprimir(impresora, titulo.toLowerCase(), pedidoId, plantillaComanda(pedido, suyos, impresora, titulo)));
  }
  return resultados;
}

async function imprimirTicket(pedidoId, extra = {}) {
  const [pedido, impresoras, negocio, opciones] = await Promise.all([
    datosPedido(pedidoId), impresorasActivas('ticket'),
    get('SELECT nombre_negocio, direccion, telefono, cuit FROM configuracion WHERE id = 1'), opcionesImpresion()
  ]);
  if (!pedido || !impresoras.length) return [];
  const resultados = [];
  for (const impresora of impresoras) {
    resultados.push(await imprimir(impresora, 'ticket', pedidoId,
      plantillaTicket(pedido, negocio || {}, opciones, impresora, { ...extra, abrirCajon: extra.abrirCajon && opciones.abrir_cajon })));
  }
  return resultados;
}

async function imprimirPrueba(impresora) {
  return imprimir(leerImpresora(impresora), 'prueba', null, plantillaPrueba(leerImpresora(impresora)));
}

// ---------- Impresión automática ----------

// ¿Se imprimen comandas automáticamente? (interruptor general + al menos una impresora)
async function comandasAutomaticas() {
  const cfg = await get('SELECT activar_impresion FROM configuracion WHERE id = 1');
  if (!cfg || !cfg.activar_impresion) return false;
  return (await impresorasActivas('comanda')).length > 0;
}

// Los ítems agregados en pocos segundos (ej. el mozo suma varios) salen en un solo "AGREGADO"
const ESPERA_AGRUPAR_MS = Number(process.env.GM_IMPRESION_ESPERA_MS) || 1500;
const agregadosPendientes = new Map();
const trabajos = new Set();

// Ejecuta en segundo plano: la impresión nunca demora ni rompe la respuesta al usuario
function enSegundoPlano(fn) {
  const p = Promise.resolve().then(fn).catch(e => console.error('[impresión]', e.message)).finally(() => trabajos.delete(p));
  trabajos.add(p);
}

// Se llama después de confirmar la transacción. Devuelve true si se mandó a imprimir.
async function comandaAutomatica(pedidoId, { itemIds = null, titulo = 'COMANDA' } = {}) {
  if (!(await comandasAutomaticas())) return false;
  if (titulo === 'AGREGADO' && itemIds) {
    const pendiente = agregadosPendientes.get(pedidoId) || { ids: [] };
    clearTimeout(pendiente.timer);
    pendiente.ids.push(...itemIds);
    pendiente.timer = setTimeout(() => {
      agregadosPendientes.delete(pedidoId);
      enSegundoPlano(() => imprimirComanda(pedidoId, { itemIds: pendiente.ids, titulo }));
    }, ESPERA_AGRUPAR_MS);
    agregadosPendientes.set(pedidoId, pendiente);
    return true;
  }
  enSegundoPlano(() => imprimirComanda(pedidoId, { itemIds, titulo }));
  return true;
}

async function ticketAlCobrar(pedidoId, { metodo, vuelto } = {}) {
  const opciones = await opcionesImpresion();
  if (!opciones.ticket_al_cobrar) return false;
  if (!(await impresorasActivas('ticket')).length) return false;
  enSegundoPlano(() => imprimirTicket(pedidoId, { vuelto, abrirCajon: metodo === 'efectivo' }));
  return true;
}

// Para los tests y el apagado: espera a que terminen las impresiones en curso
async function esperarImpresiones() {
  while (agregadosPendientes.size || trabajos.size) {
    await new Promise(r => setTimeout(r, 50));
    await Promise.all([...trabajos]);
  }
}

module.exports = {
  listarImpresorasSistema, leerImpresora, opcionesImpresion, OPCIONES_POR_DEFECTO,
  imprimirComanda, imprimirTicket, imprimirPrueba, comandaAutomatica, ticketAlCobrar, esperarImpresiones
};
