// Tests de punta a punta en un navegador real (Edge o Chrome instalado, sin ventana).
// Ejecutar con: npm run test:e2e
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const { chromium } = require('playwright-core');
const { iniciarServidor } = require('../helpers');
const { iniciarArcaSimulado } = require('../afip-simulado');

const CANAL = process.env.GM_E2E_NAVEGADOR || (process.platform === 'win32' ? 'msedge' : 'chrome');
// El navegador en la zona del negocio, como en un local real. Sin esto, en el CI (UTC) después de las 21 h de
// Argentina la pantalla pide los pedidos "de mañana" y la lista sale vacía (ver docs/MAPA-DE-RIESGOS.md).
const ZONA = process.env.ZONA_HORARIA || 'America/Argentina/Buenos_Aires';
let s, navegador, arca;

before(async () => {
  arca = await iniciarArcaSimulado();
  s = await iniciarServidor({ GM_AFIP_API_URL: arca.url });
  for (const [rol, email] of [['mozo', 'mozo@test.com'], ['cocina', 'cocina@test.com']]) {
    await s.llamar('POST', '/api/usuarios', { nombre: `Usuario ${rol}`, email, password: 'clave1234', rol }, s.tokenAdmin);
  }
  await s.q('UPDATE usuarios SET debe_cambiar_password = 0');
  // GM_E2E_EJECUTABLE: ruta a un Chromium propio (ej. en CI o contenedores sin Chrome instalado)
  navegador = await chromium.launch(process.env.GM_E2E_EJECUTABLE
    ? { executablePath: process.env.GM_E2E_EJECUTABLE, headless: true }
    : { channel: CANAL, headless: true });
});
after(async () => {
  await navegador?.close();
  await s?.cerrar();
  await arca?.cerrar();
});

// Página nueva que registra errores de JavaScript (deben quedar en cero)
async function nuevaPagina() {
  const contexto = await navegador.newContext({ serviceWorkers: 'block', timezoneId: ZONA });
  const page = await contexto.newPage();
  page.errores = [];
  page.on('pageerror', e => page.errores.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) page.errores.push(m.text()); });
  page.on('dialog', d => d.accept());
  return page;
}
const sinErrores = page => assert.deepEqual(page.errores, [], 'errores de JavaScript en la página');

async function ingresar(page, email, password) {
  await page.goto(s.base + '/');
  await page.fill('#loginEmail', email);
  await page.fill('#loginPassword', password);
  await page.click('#loginForm button[type=submit]');
}
async function ingresarOk(page, email, password) {
  await ingresar(page, email, password);
  await page.waitForSelector('#app', { state: 'visible' });
}
const toast = (page, tipo, texto) => page.waitForSelector(`#toastContainer .toast.${tipo}:has-text("${texto}")`, { timeout: 8000 });
const seccionesVisibles = page => page.$$eval('a.nav-item[data-view]', els => els.filter(e => e.offsetParent !== null).map(e => e.dataset.view));
const vistaActiva = page => page.$eval('.view.active', el => el.id.replace('view-', ''));
const ir = async (page, vista) => { await page.click(`a.nav-item[data-view="${vista}"]`); await page.waitForSelector(`#view-${vista}.active`); };

test('inicio de sesión: error con datos incorrectos, ingreso y salida', async () => {
  const page = await nuevaPagina();
  await ingresar(page, 'vendedor@test.com', 'incorrecta');
  await page.waitForSelector('#loginError', { state: 'visible' });
  assert.match(await page.textContent('#loginError'), /Credenciales incorrectas/);

  await ingresarOk(page, 'vendedor@test.com', 'vendedor123');
  assert.equal(await page.textContent('#userName'), 'Vendedor Test');
  assert.equal(await page.textContent('#userRole'), 'Cajero');

  await page.click('#btnLogout');
  await page.waitForSelector('#loginForm', { state: 'visible' });
  sinErrores(page);
  await page.context().close();
});

test('primer ingreso: obliga a cambiar la contraseña', async () => {
  await s.llamar('POST', '/api/usuarios', { nombre: 'Nuevo Cajero', email: 'nuevo@test.com', password: 'provisoria1', rol: 'cajero' }, s.tokenAdmin);
  const page = await nuevaPagina();
  await ingresar(page, 'nuevo@test.com', 'provisoria1');
  await page.waitForSelector('#cpNueva');
  assert.equal(await page.isVisible('#app'), false, 'no entra al sistema sin cambiarla');
  await page.fill('#cpActual', 'provisoria1');
  await page.fill('#cpNueva', 'definitiva2026');
  await page.fill('#cpRepetir', 'definitiva2026');
  await page.click('#modalContainer button[type=submit]');
  await page.waitForSelector('#app', { state: 'visible' });

  // La nueva contraseña funciona y la provisoria ya no
  const [st] = await s.llamar('POST', '/api/auth/login', { email: 'nuevo@test.com', password: 'definitiva2026' });
  assert.equal(st, 200);
  assert.equal((await s.llamar('POST', '/api/auth/login', { email: 'nuevo@test.com', password: 'provisoria1' }))[0], 400);
  sinErrores(page);
  await page.context().close();
});

test('cada rol ve solo sus secciones y arranca en la suya', async () => {
  const casos = [
    ['mozo@test.com', 'clave1234', 'mesas', ['pos', 'mesas', 'pedidos', 'clientes'], ['caja', 'reportes', 'usuarios', 'config', 'dashboard']],
    ['cocina@test.com', 'clave1234', 'cocina', ['cocina', 'stock'], ['pos', 'caja', 'pedidos', 'dashboard']],
    ['vendedor@test.com', 'vendedor123', 'dashboard', ['pos', 'caja', 'reportes', 'delivery'], ['usuarios', 'config', 'integraciones', 'productos']],
    ['admin@gastromanager.com', 'admin123', 'dashboard', ['usuarios', 'config', 'integraciones', 'productos', 'caja'], []]
  ];
  for (const [email, clave, inicial, ve, noVe] of casos) {
    const page = await nuevaPagina();
    await ingresarOk(page, email, clave);
    await page.waitForSelector(`#view-${inicial}.active`);
    const visibles = await seccionesVisibles(page);
    for (const v of ve) assert.ok(visibles.includes(v), `${email} debería ver ${v}`);
    for (const v of noVe) assert.ok(!visibles.includes(v), `${email} no debería ver ${v}`);
    // Aunque intente entrar por enlace directo, vuelve a su sección
    if (noVe.length) {
      await page.evaluate(v => App.navigateTo(v), noVe[0]);
      assert.equal(await vistaActiva(page), inicial);
    }
    sinErrores(page);
    await page.context().close();
  }
});

test('venta completa desde la pantalla: abrir caja, tomar pedido en el POS y cobrarlo', async () => {
  const page = await nuevaPagina();
  await ingresarOk(page, 'vendedor@test.com', 'vendedor123');

  // Abrir la caja
  await ir(page, 'caja');
  await page.click('button[onclick="Caja.mostrarApertura()"]');
  await page.fill('#cajaInicial', '5000');
  await page.click('#modalContainer button[type=submit]');
  await toast(page, 'success', 'Caja abierta');

  // Tomar el pedido en el POS
  await ir(page, 'pos');
  const producto = await page.waitForSelector('.pos-product-btn');
  await producto.click();
  await producto.click();
  await page.click('#view-pos .pos-checkout-btn');
  await page.selectOption('#checkoutTipo', 'takeaway');
  await page.fill('#checkoutCliente', 'Cliente de mostrador');
  await page.fill('#checkoutNotas', 'Sin hielo');
  await page.click('button[onclick="POS.confirmCheckout()"]');
  await toast(page, 'success', 'creado');
  const [pedido] = await s.q("SELECT * FROM pedidos WHERE cliente = 'Cliente de mostrador'");
  assert.ok(pedido, 'el pedido se guardó');
  assert.equal(pedido.notas, 'Sin hielo');
  const items = await s.q('SELECT cantidad FROM pedido_items WHERE pedido_id = ?', [pedido.id]);
  assert.equal(items[0].cantidad, 2);

  // Cobrarlo desde Pedidos
  await ir(page, 'pedidos');
  await page.click(`tr[onclick="Pedidos.verDetalle(${pedido.id})"]`);
  await page.click(`button[onclick="Cobro.abrir(${pedido.id})"]`);
  await page.fill('#modalContainer input[aria-label="Efectivo recibido"]', String(pedido.total + 500));
  await page.click('#cobroBtn');
  await page.waitForSelector('.cobro-vuelto:has-text("Vuelto")');
  assert.equal((await s.q('SELECT estado FROM pedidos WHERE id = ?', [pedido.id]))[0].estado, 'pagado');
  await page.click('#modalContainer button:has-text("Listo")');

  // La caja muestra la venta y el efectivo esperado
  await ir(page, 'caja');
  const tarjetaCaja = await page.textContent('#view-caja .caja-abierta');
  const monto = n => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(n).replace(/\s/g, ' ');
  assert.ok(tarjetaCaja.replace(/\s/g, ' ').includes(monto(5000 + pedido.total)), 'efectivo esperado = inicial + venta');
  sinErrores(page);
  await page.context().close();
});

test('el mozo no ve cobrar, descuentos ni cancelar', async () => {
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'salon', mesa_id: 8, items: [{ producto_id: 1, cantidad: 1 }] }, s.tokenVendedor);
  const page = await nuevaPagina();
  await ingresarOk(page, 'mozo@test.com', 'clave1234');
  await ir(page, 'pos');
  await page.waitForSelector('.pos-product-btn');
  assert.equal(await page.$('#view-pos button[onclick="POS.promocionModal()"]'), null, 'sin botón de descuento');

  await ir(page, 'pedidos');
  await page.click(`tr[onclick="Pedidos.verDetalle(${p.id})"]`);
  await page.waitForSelector(`button[onclick="Pedidos.agregarItem(${p.id})"]`);
  for (const accion of ['Cobro.abrir', 'Pedidos.aplicarDescuentoModal', 'Pedidos.cancelar', 'Pedidos.linkMercadoPago']) {
    assert.equal(await page.$(`button[onclick="${accion}(${p.id})"]`), null, `sin botón ${accion}`);
  }
  sinErrores(page);
  await page.context().close();
});

test('cobro en la mesa: el mozo divide la cuenta entre dos desde su celular', async () => {
  await s.llamar('PUT', '/api/config', { mozo_cobra_mesa: 1 }, s.tokenAdmin);
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'salon', mesa_id: 9, items: [{ producto_id: 1, cantidad: 2 }] }, s.tokenVendedor);
  const contexto = await navegador.newContext({ serviceWorkers: 'block', timezoneId: ZONA, viewport: { width: 390, height: 844 }, isMobile: true });
  const page = await contexto.newPage();
  page.errores = [];
  page.on('pageerror', e => page.errores.push(e.message));
  await ingresarOk(page, 'mozo@test.com', 'clave1234');
  await page.waitForFunction(() => App.config && Number(App.config.mozo_cobra_mesa) === 1);
  await page.evaluate(id => Pedidos.verDetalle(id), p.id);
  await page.click(`button[onclick="Cobro.abrir(${p.id})"]`);

  // Dos personas: la primera paga con tarjeta su mitad
  await page.click('button[aria-label="Más personas"]');
  await page.selectOption('#modalContainer .cobro-pago select', 'tarjeta');
  await page.click('#cobroBtn');
  await page.waitForSelector('#modalContainer .modal:has-text("Pago parcial registrado")');
  let [ped] = await s.q('SELECT estado FROM pedidos WHERE id = ?', [p.id]);
  assert.equal(ped.estado, 'abierto');

  // La segunda paga el resto en efectivo y la mesa se libera
  await page.click('#modalContainer button:has-text("Cobrar al siguiente")');
  await page.click('#cobroBtn');
  await page.waitForSelector('#modalContainer .modal:has-text("Cobro completo")');
  [ped] = await s.q('SELECT estado, metodo_pago, total FROM pedidos WHERE id = ?', [p.id]);
  assert.deepEqual([ped.estado, ped.metodo_pago], ['pagado', 'mixto']);
  const pagos = await s.q('SELECT metodo, monto FROM pagos WHERE pedido_id = ? ORDER BY id', [p.id]);
  assert.deepEqual(pagos.map(x => x.metodo), ['tarjeta', 'efectivo']);
  assert.equal(pagos[0].monto + pagos[1].monto, ped.total);
  assert.equal((await s.q('SELECT estado FROM mesas WHERE id = 9'))[0].estado, 'libre');
  assert.ok(await page.isVisible('#modalContainer button:has-text("WhatsApp")'));
  assert.deepEqual(page.errores, [], 'errores de JavaScript en la página');
  await contexto.close();
  await s.llamar('PUT', '/api/config', { mozo_cobra_mesa: 0 }, s.tokenAdmin);
});

test('un nombre de producto malicioso no ejecuta código (XSS)', async () => {
  const nombres = ['<img src=x onerror="window.__xss1=1">', "');window.__xss2=1;//", '"><script>window.__xss3=1</script>'];
  for (const nombre of nombres) {
    const [st] = await s.llamar('POST', '/api/productos', { nombre, precio_venta: 100, categoria_id: 1 }, s.tokenAdmin);
    assert.equal(st, 201);
  }
  const page = await nuevaPagina();
  await ingresarOk(page, 'vendedor@test.com', 'vendedor123');
  await ir(page, 'pos');
  for (const nombre of nombres) {
    await page.click(`.pos-product-btn:has-text(${JSON.stringify(nombre.slice(0, 12))})`);
  }
  await page.click('#view-pos .pos-checkout-btn');
  await page.click('button[onclick="POS.confirmCheckout()"]');
  await toast(page, 'success', 'creado');
  await ir(page, 'pedidos');
  await ir(page, 'dashboard');
  const ejecutado = await page.evaluate(() => [window.__xss1, window.__xss2, window.__xss3].filter(Boolean).length);
  assert.equal(ejecutado, 0, 'ningún código inyectado se ejecutó');
  sinErrores(page);
  await page.context().close();
});

test('el administrador configura una impresora de red y la prueba', async (t) => {
  // Impresora falsa
  let recibido = Buffer.alloc(0);
  const impresora = net.createServer(socket => {
    socket.on('data', d => { recibido = Buffer.concat([recibido, d]); });
    socket.on('end', () => socket.end()); // cerrar la conexión como una impresora real
  });
  await new Promise(ok => impresora.listen(0, '127.0.0.1', ok));
  const destino = `127.0.0.1:${impresora.address().port}`;
  // Se cierra aunque el test falle (si queda abierta, el proceso de test no termina)
  t.after(() => new Promise(r => { impresora.close(r); impresora.unref(); }));

  const page = await nuevaPagina();
  t.after(() => page.context().close());
  await ingresarOk(page, 'admin@gastromanager.com', 'admin123');
  // Primer ingreso del admin: asistente para elegir el tipo de negocio
  await page.click('.wizard-card[data-perfil="restaurante_mediano"]');
  await toast(page, 'success', 'Perfil configurado');
  await page.waitForSelector('#wizardSetup', { state: 'hidden' });
  assert.equal((await s.q('SELECT setup_completado, tipo_negocio FROM configuracion WHERE id = 1'))[0].tipo_negocio, 'restaurante_mediano');
  await ir(page, 'config');
  await page.click('button[onclick="ConfigView.editarImpresora()"]');
  await page.fill('#impNombre', 'Cocina');
  await page.selectOption('#impTipo', 'red');
  await page.fill('#impIp', destino);
  await page.click('#modalContainer button[type=submit]');
  await toast(page, 'success', 'Impresora guardada');
  await page.waitForSelector('#listaImpresoras td:has-text("Cocina")');

  await page.click('#listaImpresoras button[title="Imprimir prueba"]');
  await toast(page, 'success', 'Prueba enviada');
  for (let i = 0; i < 40 && !recibido.toString('latin1').includes('PRUEBA'); i++) await new Promise(r => setTimeout(r, 100));
  assert.ok(recibido.toString('latin1').includes('PRUEBA'), 'la impresora recibió la hoja de prueba');
  await page.waitForSelector('#listaImpresoras .badge-green');
  sinErrores(page);
});

test('factura A con datos del padrón de ARCA, anulación con nota de crédito y nueva factura', async () => {
  await s.llamar('PUT', '/api/integraciones/config/afip', { cuit: '20-11111111-2', access_token: 'x', activa: true, iva_tipo: 5 }, s.tokenAdmin);
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: 1, cantidad: 1 }] }, s.tokenVendedor);
  const [{ total }] = await s.q('SELECT total FROM pedidos WHERE id = ?', [p.id]);
  await s.llamar('POST', `/api/pedidos/${p.id}/pagar`, { metodo: 'tarjeta', monto: total }, s.tokenVendedor);

  const page = await nuevaPagina();
  await ingresarOk(page, 'vendedor@test.com', 'vendedor123');
  await page.evaluate(id => Pedidos.verDetalle(id), p.id);
  await page.click('#modalContainer button:has-text("Facturar AFIP")');
  // El CUIT trae razón social y condición desde ARCA
  await page.fill('#afipCuitReceptor', '27-30123456-8');
  await page.click('#modalContainer button:has-text("Buscar en ARCA")');
  await page.waitForSelector('#afipPadronInfo:has-text("GOMEZ ANA")');
  assert.match(await page.textContent('#afipPadronInfo'), /Monotributo/);
  await page.click('button[onclick="Integraciones.facturar(' + p.id + ',1)"]');
  await toast(page, 'success', 'Factura A emitida');
  let [c] = await s.q('SELECT * FROM comprobantes_afip WHERE pedido_id = ?', [p.id]);
  assert.deepEqual([c.condicion_iva_receptor, c.razon_social_receptor], [6, 'GOMEZ ANA']);

  // Anularla con nota de crédito
  await page.evaluate(id => Pedidos.verDetalle(id), p.id);
  await page.click('#modalContainer button:has-text("Anular con nota de crédito")');
  await page.fill('#ncMotivo', 'Error en el CUIT');
  await page.click('#ncBtn');
  await toast(page, 'success', 'Nota Crédito A emitida');
  await page.waitForSelector('#modalContainer .badge:has-text("Anulada")');
  // Se puede volver a facturar
  await page.click('#modalContainer button:has-text("Facturar AFIP")');
  await page.click('button[onclick="Integraciones.facturar(' + p.id + ',6)"]');
  await toast(page, 'success', 'Factura B emitida');
  const comps = await s.q('SELECT tipo_comprobante_nombre AS t FROM comprobantes_afip WHERE pedido_id = ? ORDER BY id', [p.id]);
  assert.deepEqual(comps.map(x => x.t), ['Factura A', 'Nota Crédito A', 'Factura B']);
  sinErrores(page);
  await page.context().close();
});

// La pantalla calculaba "hoy" con la zona del dispositivo: en uno con otra zona, después de las 21 h de Argentina
// la lista de Pedidos salía vacía. Con navegadores en UTC+14 y UTC-12, al menos uno tiene otra fecha que Argentina.
test('la lista de pedidos de hoy usa la fecha del negocio aunque el dispositivo esté en otra zona', async () => {
  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', cliente: 'Zona horaria', items: [{ producto_id: 1, cantidad: 1 }] }, s.tokenVendedor);
  for (const zona of ['Pacific/Kiritimati', 'Etc/GMT+12']) {
    const contexto = await navegador.newContext({ serviceWorkers: 'block', timezoneId: zona });
    const page = await contexto.newPage();
    await ingresarOk(page, 'vendedor@test.com', 'vendedor123');
    await ir(page, 'pedidos');
    await page.waitForSelector(`tr[onclick="Pedidos.verDetalle(${p.id})"]`, { timeout: 8000 });
    await contexto.close();
  }
});


test('el administrador configura WhatsApp Business desde Integraciones', async () => {
  const page = await nuevaPagina();
  await ingresarOk(page, 'admin@gastromanager.com', 'admin123');
  await ir(page, 'integraciones');
  await page.waitForSelector('#waPhoneId');
  await page.fill('#waPhoneId', '1234567890');
  await page.fill('#waToken', 'EAAG-token-de-prueba');
  await page.fill('#waSecret', 'secreto');
  await page.fill('#waVerify', 'palabra-secreta');
  await page.selectOption('#waAvisos', '1');
  await page.selectOption('#waRecordatorio', '3');
  await page.selectOption('#waActiva', '1');
  await page.click('#waCard button[type=submit]');
  await toast(page, 'success', 'WhatsApp guardado');
  await page.waitForSelector('#waCard .badge:has-text("Conectada")');
  const [{ valor }] = await s.q("SELECT valor FROM integraciones_config WHERE clave = 'whatsapp'");
  const cfg = JSON.parse(valor);
  assert.deepEqual([cfg.phone_number_id, cfg.access_token, cfg.avisar_pedidos, cfg.recordatorio_horas, cfg.activa],
    ['1234567890', 'EAAG-token-de-prueba', true, 3, true]);
  assert.doesNotMatch(await page.content(), /EAAG-token-de-prueba/, 'el token no vuelve a la pantalla');
  sinErrores(page);
  await page.context().close();
});

test('receta desde la pantalla: ingredientes, costo calculado y descuento de stock al cobrar', async () => {
  const crear = async d => (await s.llamar('POST', '/api/productos', { categoria_id: 1, ...d }, s.tokenAdmin))[1].id;
  const pan = await crear({ nombre: 'Pan e2e', precio_venta: 0, costo: 200, tracking_stock: 1, stock_actual: 50 });
  const plato = await crear({ nombre: 'Sandwich e2e', precio_venta: 2000, costo: 0 });
  const page = await nuevaPagina();
  await ingresarOk(page, 'admin@gastromanager.com', 'admin123');
  await page.evaluate(() => App.closeModal());
  await ir(page, 'productos');
  await page.click(`button[onclick="Productos.receta(${plato})"]`);
  await page.selectOption('#recetaCuerpo .receta-linea select', String(pan));
  await page.fill('#recetaCuerpo .receta-linea input', '2');
  await page.click('#recetaCuerpo button:has-text("Guardar receta")');
  await toast(page, 'success', 'Receta guardada');
  assert.equal((await s.q('SELECT costo FROM productos WHERE id = ?', [plato]))[0].costo, 400);

  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: plato, cantidad: 3 }] }, s.tokenVendedor);
  await s.llamar('POST', `/api/pedidos/${p.id}/pagar`, { metodo: 'efectivo', monto: 6000 }, s.tokenVendedor);
  assert.equal((await s.q('SELECT stock_actual FROM productos WHERE id = ?', [pan]))[0].stock_actual, 44);
  sinErrores(page);
  await page.context().close();
});

test('PIN de autorización: el encargado define su PIN y autoriza el descuento del cajero sin cerrar el formulario', async () => {
  await s.llamar('POST', '/api/usuarios', { nombre: 'Encargada', email: 'encargada@test.com', password: 'clave1234', rol: 'encargado' }, s.tokenAdmin);
  await s.q('UPDATE usuarios SET debe_cambiar_password = 0');
  await s.llamar('PUT', '/api/config', { pin_autorizacion: 1 }, s.tokenAdmin);

  const enc = await nuevaPagina();
  await ingresarOk(enc, 'encargada@test.com', 'clave1234');
  await enc.click('#btnPin');
  await enc.fill('#miPinPassword', 'clave1234');
  await enc.fill('#miPinNuevo', '2468');
  await enc.click('#modalContainer button[type=submit]');
  await toast(enc, 'success', 'PIN guardado');
  await enc.context().close();

  const [, p] = await s.llamar('POST', '/api/pedidos', { tipo: 'takeaway', items: [{ producto_id: 1, cantidad: 2 }] }, s.tokenVendedor);
  const page = await nuevaPagina();
  await ingresarOk(page, 'vendedor@test.com', 'vendedor123');
  assert.equal(await page.isVisible('#btnPin'), false, 'el cajero no tiene PIN');
  await page.evaluate(id => Pedidos.verDetalle(id), p.id);
  await page.click(`button[onclick="Pedidos.aplicarDescuentoModal(${p.id})"]`);
  await page.fill('#descuentoMonto', '100');
  await page.click('#modalContainer button[type=submit]');
  await page.waitForSelector('.pin-overlay #pinAutorizacion');
  await page.fill('#pinAutorizacion', '2468');
  await page.click('.pin-overlay button[type=submit]');
  await toast(page, 'success', 'Descuento aplicado');
  assert.equal((await s.q('SELECT descuento FROM pedidos WHERE id = ?', [p.id]))[0].descuento, 100);
  sinErrores(page);
  await page.context().close();
  await s.llamar('PUT', '/api/config', { pin_autorizacion: 0 }, s.tokenAdmin);
});

test('arqueo ciego: el cajero cierra la caja sin ver el efectivo esperado', async () => {
  await s.llamar('PUT', '/api/config', { arqueo_ciego: 1 }, s.tokenAdmin);
  const page = await nuevaPagina();
  await ingresarOk(page, 'vendedor@test.com', 'vendedor123');
  await ir(page, 'caja');
  await page.waitForSelector('#view-caja .caja-abierta');
  const texto = await page.textContent('#view-caja');
  assert.match(texto, /Arqueo ciego/);
  assert.doesNotMatch(texto, /Efectivo esperado/);
  await page.click('button[onclick="Caja.mostrarCierre()"]');
  assert.doesNotMatch(await page.textContent('#modalContainer'), /esperado/i);
  await page.fill('#cajaFinal', '12345');
  await page.click('#modalContainer button[type=submit]');
  await page.waitForSelector('#modalContainer .modal:has-text("El encargado revisa el arqueo")');
  const [c] = await s.q('SELECT estado, monto_final_real, diferencia FROM caja ORDER BY id DESC LIMIT 1');
  assert.deepEqual([c.estado, c.monto_final_real], ['cerrada', 12345]);
  assert.equal(typeof c.diferencia, 'number');
  sinErrores(page);
  await page.context().close();
  await s.llamar('PUT', '/api/config', { arqueo_ciego: 0 }, s.tokenAdmin);
});

// Auditoría de lanzamiento: con mala señal el mozo tocaba dos veces y salían dos pedidos y dos comandas
test('POS: doble toque en "Confirmar pedido" con la red lenta crea un solo pedido', async () => {
  const page = await nuevaPagina();
  await ingresarOk(page, 'vendedor@test.com', 'vendedor123');
  await page.route('**/api/pedidos', async ruta => { await new Promise(r => setTimeout(r, 800)); await ruta.continue(); });
  await ir(page, 'pos');
  await (await page.waitForSelector('.pos-product-btn')).click();
  await page.click('#view-pos .pos-checkout-btn');
  await page.selectOption('#checkoutTipo', 'takeaway');
  await page.fill('#checkoutCliente', 'Doble toque');
  await page.$eval('button[onclick="POS.confirmCheckout()"]', b => { b.click(); b.click(); b.click(); });
  await toast(page, 'success', 'creado');
  await page.waitForTimeout(1500);
  assert.equal((await s.q("SELECT COUNT(*) c FROM pedidos WHERE cliente = 'Doble toque'"))[0].c, 1);
  sinErrores(page);
  await page.context().close();
});

// "Ocupar" una mesa reservada la marcaba ocupada y el POS no la ofrecía: el pedido salía sin mesa y la mesa quedaba trabada
test('mesa reservada: "Ocupar" lleva al POS con la mesa elegida y el pedido queda en esa mesa', async () => {
  const [mesa] = await s.q("INSERT INTO mesas (nombre, capacidad, sector, orden, estado) VALUES ('Reservada E2E', 4, 'Principal', 50, 'reservada') RETURNING id");
  const page = await nuevaPagina();
  await ingresarOk(page, 'vendedor@test.com', 'vendedor123');
  await ir(page, 'mesas');
  await page.click(`button[onclick="Mesas.ocuparMesaReservada(${mesa.id})"]`);
  await page.waitForSelector('#view-pos.active');
  await (await page.waitForSelector('.pos-product-btn')).click();
  await page.click('#view-pos .pos-checkout-btn');
  await page.waitForSelector(`#checkoutMesa option[value="${mesa.id}"]`, { state: 'attached' });
  assert.equal(await page.$eval('#checkoutMesa', el => el.value), String(mesa.id));
  await page.click('button[onclick="POS.confirmCheckout()"]');
  await toast(page, 'success', 'creado');
  const [p] = await s.q("SELECT mesa_id FROM pedidos WHERE mesa_id = ? AND estado = 'abierto'", [mesa.id]);
  assert.ok(p, 'el pedido quedó en la mesa');
  assert.equal((await s.q('SELECT estado FROM mesas WHERE id = ?', [mesa.id]))[0].estado, 'ocupada');
  sinErrores(page);
  await page.context().close();
});

test('pedido desde el QR de la mesa: el cliente pide, el mozo recibe el aviso y confirma, el cliente lo ve', async () => {
  const token = 'e2e0'.repeat(6);
  const [mesa] = await s.q("INSERT INTO mesas (nombre, capacidad, sector, orden, qr_token) VALUES ('Mesa QR E2E', 4, 'Principal', 60, ?) RETURNING id", [token]);
  const mozo = await nuevaPagina();
  await ingresarOk(mozo, 'mozo@test.com', 'clave1234');
  await ir(mozo, 'mesas');

  const cliente = await nuevaPagina();
  await cliente.goto(`${s.base}/pedido.html?mesa=${token}`);
  await cliente.waitForSelector('#origenBadge:has-text("Mesa QR E2E")');
  await (await cliente.waitForSelector('.btn-agregar')).click();
  await cliente.click('#btnConfirmar');
  assert.equal(await cliente.isVisible('#clienteTelefono'), false, 'desde la mesa no se pide teléfono');
  await cliente.fill('#clienteNombre', 'Sofi');
  await cliente.fill('#clienteNotas', 'sin hielo');
  await cliente.click('#btnEnviar');
  await cliente.waitForSelector('#mesaAviso:has-text("El mozo lo confirma")');
  assert.equal(await cliente.isVisible('#confirmacionScreen'), false, 'no tapa la carta');
  await cliente.waitForSelector('#mesaEstado :text("Esperando al mozo")');

  // El mozo recibe el aviso en vivo y lo ve en Mesas
  await toast(mozo, 'warning', 'Mesa QR E2E hizo un pedido');
  await mozo.waitForSelector('#navBadgeMesas:has-text("1")');
  await mozo.click('.solicitud-mesa:has-text("Mesa QR E2E") button:has-text("Confirmar")');
  await toast(mozo, 'success', 'va a cocina');
  const [p] = await s.q("SELECT id, notas, cliente FROM pedidos WHERE mesa_id = ? AND estado = 'abierto'", [mesa.id]);
  assert.deepEqual([p.cliente, p.notas], ['Sofi', 'sin hielo']);
  await cliente.waitForSelector('#mesaEstado :text("Confirmado, en preparación")', { timeout: 15000 });
  await cliente.waitForSelector('#mesaEstado :text("Tu cuenta")');

  // Llamar al mozo: le aparece y lo marca atendido
  await cliente.click('#btnLlamarMozo');
  await toast(mozo, 'warning', 'Mesa QR E2E llama al mozo');
  await mozo.click('.solicitud-mesa:has-text("Mesa QR E2E") button:has-text("Ya fui")');
  await mozo.waitForSelector('.solicitud-mesa', { state: 'detached' });
  sinErrores(cliente);
  sinErrores(mozo);
  await cliente.context().close();
  await mozo.context().close();
});
