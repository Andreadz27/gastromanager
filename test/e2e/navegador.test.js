// Tests de punta a punta en un navegador real (Edge o Chrome instalado, sin ventana).
// Ejecutar con: npm run test:e2e
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const { chromium } = require('playwright-core');
const { iniciarServidor } = require('../helpers');

const CANAL = process.env.GM_E2E_NAVEGADOR || (process.platform === 'win32' ? 'msedge' : 'chrome');
let s, navegador;

before(async () => {
  s = await iniciarServidor();
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
});

// Página nueva que registra errores de JavaScript (deben quedar en cero)
async function nuevaPagina() {
  const contexto = await navegador.newContext({ serviceWorkers: 'block' });
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
  await page.click(`button[onclick="Pedidos.mostrarPagar(${pedido.id})"]`);
  await page.selectOption('#pagoMetodo', 'efectivo');
  await page.fill('#pagoMonto', String(pedido.total + 500));
  await page.click('#modalContainer form[onsubmit^="Pedidos.confirmarPago"] button[type=submit]');
  await toast(page, 'success', 'Vuelto');
  assert.equal((await s.q('SELECT estado FROM pedidos WHERE id = ?', [pedido.id]))[0].estado, 'pagado');

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
  for (const accion of ['mostrarPagar', 'aplicarDescuentoModal', 'cancelar', 'linkMercadoPago']) {
    assert.equal(await page.$(`button[onclick="Pedidos.${accion}(${p.id})"]`), null, `sin botón ${accion}`);
  }
  sinErrores(page);
  await page.context().close();
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
