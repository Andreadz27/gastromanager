// Graba un video del recorrido por el sistema (con subtítulos) y toma capturas de cada pantalla.
// Usa un navegador real (Edge o Chrome instalado) sobre un entorno de demo nuevo.
//
// Uso: npm run demo:video
// Salida: demo/salida/recorrido.webm y demo/salida/capturas/*.png
'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { chromium } = require('playwright-core');

const RAIZ = path.join(__dirname, '..', '..');
const SALIDA = path.join(RAIZ, 'demo', 'salida');
const DATOS = path.join(SALIDA, '.datos-grabacion');
const CAPTURAS = path.join(SALIDA, 'capturas');
const ANCHO = 1440, ALTO = 900;
const CANAL = process.env.GM_E2E_NAVEGADOR || (process.platform === 'win32' ? 'msedge' : 'chrome');
const esperar = ms => new Promise(r => setTimeout(r, ms));

// Subtítulos, cursor y placas de título que se inyectan en cada página
const OVERLAY = () => {
  const estilo = `
    #gm-cursor{position:fixed;z-index:2147483647;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;
      background:rgba(249,115,22,.35);border:2px solid #f97316;pointer-events:none;transition:transform .15s;left:-50px;top:-50px}
    #gm-cursor.click{transform:scale(.6);background:rgba(249,115,22,.7)}
    #gm-rotulo{position:fixed;z-index:2147483646;left:50%;bottom:34px;transform:translate(-50%,20px);opacity:0;
      width:min(920px,86vw);background:rgba(15,23,42,.92);color:#fff;border-radius:16px;padding:18px 26px 18px 30px;
      font:500 19px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.35);
      border-left:6px solid #f97316;transition:opacity .45s,transform .45s;pointer-events:none}
    #gm-rotulo.visible{opacity:1;transform:translate(-50%,0)}
    #gm-rotulo b{display:block;font-size:24px;font-weight:700;margin-bottom:4px;letter-spacing:-.2px}
    #gm-rotulo small{position:absolute;right:20px;top:14px;color:#94a3b8;font-size:13px;font-weight:600}
    #gm-placa{position:fixed;inset:0;z-index:2147483645;display:flex;flex-direction:column;align-items:center;justify-content:center;
      background:radial-gradient(circle at 30% 20%,#fb923c 0,#ea580c 30%,#9a3412 70%,#431407 100%);color:#fff;text-align:center;
      font-family:system-ui,-apple-system,'Segoe UI',sans-serif;opacity:0;transition:opacity .6s;pointer-events:none}
    #gm-placa.visible{opacity:1}
    #gm-placa .logo{font-size:84px;line-height:1;margin-bottom:18px}
    #gm-placa h1{font-size:64px;margin:0;font-weight:800;letter-spacing:-1.5px}
    #gm-placa p{font-size:26px;margin:14px 0 0;opacity:.92;max-width:900px}
    #gm-placa .chips{display:flex;gap:12px;margin-top:34px;flex-wrap:wrap;justify-content:center}
    #gm-placa .chips span{background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.3);padding:8px 18px;border-radius:999px;font-size:18px}
    .gm-resaltado{outline:4px solid #f97316 !important;outline-offset:4px !important;border-radius:10px;transition:outline-color .3s}`;
  const iniciar = () => {
    if (document.getElementById('gm-cursor')) return;
    const s = document.createElement('style'); s.textContent = estilo; document.head.appendChild(s);
    const c = document.createElement('div'); c.id = 'gm-cursor'; document.body.appendChild(c);
    const r = document.createElement('div'); r.id = 'gm-rotulo'; document.body.appendChild(r);
    const p = document.createElement('div'); p.id = 'gm-placa'; document.body.appendChild(p);
    document.addEventListener('mousemove', e => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    document.addEventListener('mousedown', () => c.classList.add('click'), true);
    document.addEventListener('mouseup', () => c.classList.remove('click'), true);
  };
  window.__gm = {
    rotulo(titulo, texto, paso) {
      const r = document.getElementById('gm-rotulo');
      r.innerHTML = `${paso ? `<small>${paso}</small>` : ''}<b></b><span></span>`;
      r.querySelector('b').textContent = titulo; r.querySelector('span').textContent = texto;
      r.classList.add('visible');
    },
    ocultarRotulo() { document.getElementById('gm-rotulo').classList.remove('visible'); },
    placa(titulo, texto, chips = []) {
      const p = document.getElementById('gm-placa');
      p.innerHTML = `<div class="logo">🍽️</div><h1></h1><p></p><div class="chips"></div>`;
      p.querySelector('h1').textContent = titulo; p.querySelector('p').textContent = texto;
      for (const c of chips) { const s = document.createElement('span'); s.textContent = c; p.querySelector('.chips').appendChild(s); }
      p.classList.add('visible');
    },
    ocultarPlaca() { document.getElementById('gm-placa').classList.remove('visible'); },
    ocultarTodo(ocultar) { for (const id of ['gm-rotulo', 'gm-cursor']) document.getElementById(id).style.visibility = ocultar ? 'hidden' : ''; }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
};

// ffmpeg: variable FFMPEG, en el PATH o instalado con winget (Gyan.FFmpeg)
function buscarFfmpeg() {
  const candidatos = [process.env.FFMPEG, 'ffmpeg'];
  const winget = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  if (fs.existsSync(winget)) {
    for (const pkg of fs.readdirSync(winget).filter(d => /ffmpeg/i.test(d))) {
      const dir = path.join(winget, pkg);
      for (const sub of fs.readdirSync(dir)) candidatos.push(path.join(dir, sub, 'bin', 'ffmpeg.exe'));
    }
  }
  for (const c of candidatos.filter(Boolean)) {
    try { execFileSync(c, ['-version'], { stdio: 'ignore' }); return c; } catch (e) {}
  }
  return null;
}

const puertoLibre = () => new Promise((ok, mal) => {
  const s = net.createServer();
  s.listen(0, () => { const { port } = s.address(); s.close(() => ok(port)); });
  s.on('error', mal);
});

(async () => {
  // Solo se borran los archivos que genera este script (la carpeta puede tener otras cosas)
  for (const f of ['recorrido.webm', 'recorrido.mp4', 'portada.jpg', 'capitulos.json']) fs.rmSync(path.join(SALIDA, f), { force: true });
  fs.rmSync(CAPTURAS, { recursive: true, force: true });
  fs.rmSync(DATOS, { recursive: true, force: true });
  fs.mkdirSync(CAPTURAS, { recursive: true });
  console.log('1/3 Generando datos de la demo...');
  execFileSync(process.execPath, [path.join(__dirname, 'generar-datos.js'), DATOS], { stdio: 'ignore' });

  const port = await puertoLibre();
  const servidor = spawn(process.execPath, [path.join(RAIZ, 'server.js')],
    { env: { ...process.env, GM_DATA_DIR: DATOS, PORT: String(port), SECRET_KEY: '', NODE_ENV: 'demo' }, stdio: 'ignore' });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/')).ok) break; } catch (e) {} await esperar(100); }

  console.log('2/3 Grabando el recorrido...');
  const navegador = await chromium.launch({ channel: CANAL, headless: true });
  const contexto = await navegador.newContext({
    viewport: { width: ANCHO, height: ALTO }, serviceWorkers: 'block', locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires',
    recordVideo: { dir: SALIDA, size: { width: ANCHO, height: ALTO } }
  });
  await contexto.addInitScript(OVERLAY);
  const inicioVideo = Date.now(); // el video empieza al crear el contexto
  const page = await contexto.newPage();
  page.on('pageerror', e => console.error('  error en la página:', e.message));
  // Capítulos del video (segundo de inicio de cada escena) para la página de presentación
  const capitulos = [];
  const capitulo = titulo => capitulos.push({ segundo: Math.max(0, Math.round((Date.now() - inicioVideo) / 1000) - 1), titulo });

  // ---------- Helpers de la puesta en escena ----------
  const rotulo = async (titulo, texto, ms = 3800) => {
    await page.evaluate(([t, x]) => window.__gm.rotulo(t, x), [titulo, texto]);
    await esperar(ms);
  };
  const sinRotulo = () => page.evaluate(() => window.__gm.ocultarRotulo());
  const captura = async nombre => {
    await page.evaluate(() => window.__gm.ocultarTodo(true));
    await page.screenshot({ path: path.join(CAPTURAS, `${nombre}.png`) });
    await page.evaluate(() => window.__gm.ocultarTodo(false));
  };
  const mover = async selector => {
    const el = page.locator(selector).first();
    await el.scrollIntoViewIfNeeded();
    const caja = await el.boundingBox();
    await page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2, { steps: 22 });
    return el;
  };
  const clic = async (selector, pausa = 700) => {
    const el = await mover(selector);
    await esperar(250);
    await el.click();
    await esperar(pausa);
  };
  const resaltar = async (selector, ms = 1600) => {
    await page.evaluate(s => document.querySelector(s)?.classList.add('gm-resaltado'), selector);
    await esperar(ms);
    await page.evaluate(s => document.querySelector(s)?.classList.remove('gm-resaltado'), selector);
  };
  const desplazar = async (selector, ms = 1400) => {
    await page.evaluate(s => document.querySelector(s)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), selector);
    await esperar(ms);
  };
  const arriba = async () => { await page.evaluate(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); document.querySelectorAll('.main-content, main').forEach(m => m.scrollTo && m.scrollTo({ top: 0, behavior: 'smooth' })); }); await esperar(600); };
  const ir = async vista => {
    await sinRotulo(); // el subtítulo de la escena anterior no pasa a la siguiente
    await clic(`a.nav-item[data-view="${vista}"]`, 300);
    await page.waitForSelector(`#view-${vista}.active`);
    await esperar(1100);
  };

  // ---------- Recorrido ----------
  await page.goto(base + '/');
  await page.evaluate(() => window.__gm.placa('GastroManager', 'El sistema de gestión para restaurantes, bares y cafeterías',
    ['Punto de venta', 'Mesas y comandas', 'Delivery', 'Caja y arqueo', 'Facturación AFIP']));
  await esperar(4200);
  await page.evaluate(() => window.__gm.ocultarPlaca());
  await esperar(700);
  await captura('01-ingreso');

  // 1. Ingreso
  capitulo("Ingreso con usuario y rol");
  await rotulo('Cada persona con su usuario', 'Administrador, encargado, cajero, mozo y cocina: cada uno ve solo lo que necesita.', 1800);
  await clic('#loginEmail', 200);
  await page.type('#loginEmail', 'admin@labuenamesa.com', { delay: 45 });
  await clic('#loginPassword', 200);
  await page.type('#loginPassword', 'demo1234', { delay: 70 });
  await clic('#loginForm button[type=submit]', 400);
  await page.waitForSelector('#app', { state: 'visible' });
  await esperar(1500);

  // 2. Dashboard
  capitulo("Dashboard en tiempo real");
  await rotulo('Tu negocio en tiempo real', 'Ventas del día, ticket promedio y comparación con la semana, apenas entrás.', 3200);
  await captura('02-dashboard');
  await resaltar('#view-dashboard .stat-card', 1400);
  await rotulo('Alertas y consejos automáticos', 'Te avisa qué reponer, cuáles son tus horas pico y cómo viene el día frente a tu promedio.', 4000);
  await desplazar('#view-dashboard .card:nth-of-type(3)', 2600);
  await arriba();

  // 3. Mesas
  capitulo("Mapa del salón");
  await ir('mesas');
  await rotulo('El salón de un vistazo', 'Mesas libres, ocupadas y reservadas, con las reservas de la noche.', 3800);
  await captura('03-mesas');

  // 4. Punto de venta
  capitulo("Tomar un pedido");
  await ir('pos');
  await rotulo('Tomar un pedido lleva segundos', 'Tocás los productos, elegís la mesa y la comanda sale a cocina.', 1500);
  await clic('.pos-cat-btn:has-text("Platos Principales")', 900);
  await clic('.pos-product-btn:has-text("Bife de chorizo")', 500);
  await clic('.pos-product-btn:has-text("Bife de chorizo")', 500);
  await clic('.pos-product-btn:has-text("Risotto de hongos")', 500);
  await clic('.pos-cat-btn:has-text("Bebidas Alcohólicas")', 800);
  await clic('.pos-product-btn:has-text("Botella vino tinto")', 700);
  await clic('.pos-cat-btn:has-text("Entradas")', 800);
  await clic('.pos-product-btn:has-text("Provoleta parrilla")', 900);
  await captura('04-punto-de-venta');
  await clic('#view-pos .pos-checkout-btn', 1000);
  await page.selectOption('#checkoutMesa', '3');
  await esperar(500);
  await clic('#checkoutNotas', 200);
  await page.type('#checkoutNotas', 'Un bife jugoso y otro a punto', { delay: 35 });
  await esperar(500);
  await clic('button[onclick="POS.confirmCheckout()"]', 1800);
  await page.waitForSelector('#view-mesas.active');
  await rotulo('La mesa queda ocupada sola', 'Sin pasos extra: el pedido, la mesa y la cocina se actualizan juntos.', 3000);
  await resaltar('#view-mesas .mesa-card:nth-child(3)', 1200);

  // 5. Cocina
  capitulo("Comandas en cocina");
  await ir('cocina');
  await rotulo('La comanda llega al instante', 'Cocina ve cada pedido con sus notas y el tiempo de espera en colores.', 2600);
  await captura('05-cocina');
  await page.evaluate(() => { const c = [...document.querySelectorAll('#view-cocina .comanda-card')]; const n = c.find(x => x.textContent.includes('MESA 3')); n && n.scrollIntoView({ behavior: 'smooth', block: 'center' }); n && n.classList.add('gm-resaltado'); });
  await esperar(3000);

  // 6. Cobro
  capitulo("Cobro con vuelto");
  await page.evaluate(() => document.querySelectorAll('.gm-resaltado').forEach(e => e.classList.remove('gm-resaltado')));
  await ir('mesas');
  await clic(`button[onclick="Pedidos.abrirPedidoDeMesa('3')"]`, 1400);
  await rotulo('Cobrar es igual de simple', 'Efectivo, tarjeta, Mercado Pago o transferencia, con el vuelto calculado.', 1800);
  await captura('06-detalle-pedido');
  await clic('button[onclick^="Pedidos.mostrarPagar("]', 1000);
  const total = Number(await page.inputValue('#pagoMonto'));
  await page.selectOption('#pagoMetodo', 'efectivo');
  await clic('#pagoMonto', 200);
  await page.fill('#pagoMonto', '');
  await page.type('#pagoMonto', String(Math.ceil((total + 1) / 10000) * 10000), { delay: 90 });
  await esperar(700);
  await clic('#modalContainer form[onsubmit^="Pedidos.confirmarPago"] button[type=submit]', 2600);

  // 7. Delivery
  capitulo("Delivery y apps");
  await ir('delivery');
  await rotulo('Todo el delivery en una pantalla', 'PedidosYa, Rappi y los pedidos de tu carta online por WhatsApp, con su estado.', 2600);
  await captura('07-delivery');
  await clic('#view-delivery button:has-text("Aceptar")', 2200);

  // 8. Caja
  capitulo("Caja y arqueo");
  await ir('caja');
  await rotulo('Caja y arqueo automáticos', 'Ventas por medio de pago y el efectivo que tiene que haber en la caja.', 3200);
  await captura('08-caja');
  await desplazar('#view-caja .card:last-child', 1200);
  await rotulo('Cada cierre queda registrado', 'Historial de cajas con faltantes y sobrantes, para saber siempre qué pasó.', 3200);
  await arriba();

  // 9. Reportes
  capitulo("Rentabilidad por plato");
  await ir('reportes');
  await clic('#view-reportes button:has-text("Rentabilidad")', 1500);
  await rotulo('Sabé qué te deja cada plato', 'Costo, margen y unidades vendidas para decidir precios con datos.', 3600);
  await captura('09-rentabilidad');

  // 10. Stock
  capitulo("Stock y alertas");
  await ir('stock');
  await rotulo('Stock al día', 'Cada venta descuenta del inventario y el sistema avisa antes de que falte.', 3400);
  await captura('10-inventario');

  // 11. Roles
  capitulo("Permisos por rol");
  await ir('usuarios');
  await clic('button[onclick="Usuarios.nuevo()"]', 800);
  await page.selectOption('#usuRol', 'mozo');
  await esperar(400);
  await rotulo('Permisos por rol', 'El mozo toma pedidos pero no cobra ni hace descuentos: menos errores y menos pérdidas.', 3800);
  await captura('11-roles');
  await page.evaluate(() => App.closeModal());
  await esperar(500);

  // 12. Impresoras y copias
  capitulo("Impresoras y copias de seguridad");
  await ir('config');
  await desplazar('#listaImpresoras', 1500);
  await rotulo('Comandas impresas por estación', 'La cocina recibe los platos y la barra las bebidas, en impresoras térmicas de red o USB.', 3600);
  await captura('12-impresoras');
  await desplazar('#listaBackups', 1200);
  await rotulo('Tus datos, siempre a salvo', 'Copias de seguridad automáticas todos los días.', 2800);

  // 13. Carta QR
  capitulo("Carta digital con QR");
  await sinRotulo();
  await esperar(500);
  await page.goto(base + '/menu.html');
  await esperar(1200);
  await rotulo('Carta digital con QR', 'Tus clientes ven la carta desde el celular y piden sin comisiones de terceros.', 2500);
  await captura('13-carta-qr');
  await page.mouse.wheel(0, 700);
  await esperar(1800);
  await page.mouse.wheel(0, -700);
  await esperar(900);

  // Cierre
  await page.evaluate(() => { window.__gm.ocultarRotulo(); window.__gm.placa('GastroManager', 'Todo tu restaurante en un solo sistema. Sin instalaciones complicadas.',
    ['Pedidos', 'Cocina', 'Delivery', 'Caja', 'Stock', 'Reportes', 'AFIP']); });
  await esperar(4500);

  fs.writeFileSync(path.join(SALIDA, 'capitulos.json'), JSON.stringify(capitulos, null, 2));

  // Pantalla de cocina (solo captura, fuera del video)
  const video = page.video();
  await contexto.close();
  const archivoVideo = await video.path();
  fs.renameSync(archivoVideo, path.join(SALIDA, 'recorrido.webm'));

  const ctx2 = await navegador.newContext({ viewport: { width: ANCHO, height: ALTO }, serviceWorkers: 'block' });
  const p2 = await ctx2.newPage();
  await p2.goto(base + '/');
  await p2.fill('#loginEmail', 'cocina@labuenamesa.com'); await p2.fill('#loginPassword', 'demo1234');
  await p2.click('#loginForm button[type=submit]'); await p2.waitForSelector('#app', { state: 'visible' });
  await p2.goto(base + '/cocina-display.html'); await esperar(1800);
  await p2.screenshot({ path: path.join(CAPTURAS, '14-pantalla-cocina.png') });
  await ctx2.close();
  const ctx3 = await navegador.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const p3 = await ctx3.newPage();
  await p3.goto(base + '/menu.html'); await esperar(1500);
  await p3.screenshot({ path: path.join(CAPTURAS, '15-carta-celular.png') });
  await ctx3.close();

  await navegador.close();
  servidor.kill();
  await new Promise(r => servidor.exitCode !== null ? r() : servidor.once('exit', r));
  fs.rmSync(DATOS, { recursive: true, force: true });

  // MP4 (H.264): se ve en cualquier celular y se puede mandar por WhatsApp. Requiere ffmpeg.
  const ffmpeg = buscarFfmpeg();
  if (ffmpeg) {
    const webm = path.join(SALIDA, 'recorrido.webm');
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-i', webm, '-c:v', 'libx264', '-preset', 'slow', '-crf', '26',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', path.join(SALIDA, 'recorrido.mp4')]);
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-ss', '2', '-i', webm, '-frames:v', '1', '-q:v', '3', path.join(SALIDA, 'portada.jpg')]);
  } else {
    console.log('   (sin ffmpeg: solo se generó el video .webm)');
  }
  const mb = f => (fs.statSync(path.join(SALIDA, f)).size / 1048576).toFixed(1) + ' MB';
  console.log(`3/3 Listo en demo/salida: recorrido.webm (${mb('recorrido.webm')})` +
    (ffmpeg ? `, recorrido.mp4 (${mb('recorrido.mp4')}), portada.jpg` : '') + ` y ${fs.readdirSync(CAPTURAS).length} capturas`);
})().catch(e => { console.error('Error grabando la demo:', e); process.exit(1); });
