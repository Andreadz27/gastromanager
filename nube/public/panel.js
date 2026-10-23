'use strict';
// Panel de Morfi Nube: ventas de todos los locales y su estado. Se actualiza solo cada minuto.
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const plata = n => '$ ' + Math.round(Number(n) || 0).toLocaleString('es-AR');
  const num = n => (Number(n) || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 });
  const fechaISO = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const diaCorto = f => { const [, m, d] = f.split('-'); return `${d}/${m}`; };

  let token = null, usuario = null, periodo = 'hoy', vista = 'ventas', reloj = null;
  try { token = localStorage.getItem('morfiNubeToken'); usuario = JSON.parse(localStorage.getItem('morfiNubeUsuario') || 'null'); } catch (e) {}

  async function api(ruta, opciones = {}) {
    const r = await fetch(ruta, { ...opciones, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } });
    const datos = await r.json().catch(() => ({}));
    if (r.status === 401) { salir(); throw new Error(datos.error || 'Iniciá sesión'); }
    if (!r.ok) throw new Error(datos.error || 'Error ' + r.status);
    return datos;
  }

  function rango() {
    const hoy = new Date(), d = new Date();
    if (periodo === 'ayer') { d.setDate(d.getDate() - 1); return { desde: fechaISO(d), hasta: fechaISO(d) }; }
    if (periodo === '7' || periodo === '30') { d.setDate(d.getDate() - Number(periodo) + 1); return { desde: fechaISO(d), hasta: fechaISO(hoy) }; }
    if (periodo === 'mes') { d.setDate(1); return { desde: fechaISO(d), hasta: fechaISO(hoy) }; }
    return { desde: fechaISO(hoy), hasta: fechaISO(hoy) };
  }

  async function cargarVentas() {
    const { desde, hasta } = rango();
    const r = await api(`/api/panel/resumen?desde=${desde}&hasta=${hasta}`);
    $('kpis').innerHTML = [
      ['Ventas', plata(r.total.ventas)], ['Tickets', num(r.total.tickets)],
      ['Ticket promedio', plata(r.total.ticket_promedio)], ['Propinas', plata(r.total.propinas)]
    ].map(([t, v]) => `<div class="kpi"><small>${t}</small><strong>${v}</strong></div>`).join('');

    $('por-local').innerHTML = r.locales.length ? r.locales.map(l => `<div class="fila">
      <span>${esc(l.nombre)}<small>${num(l.tickets)} tickets · promedio ${plata(l.ticket_promedio)}</small></span>
      <span class="derecha"><strong>${plata(l.ventas)}</strong></span></div>`).join('')
      : '<p class="vacio">Todavía no hay locales conectados a la nube.</p>';

    // Barras por día (sumando los locales)
    const dias = {};
    for (const d of r.por_dia) dias[d.fecha] = (dias[d.fecha] || 0) + d.ventas;
    const max = Math.max(1, ...Object.values(dias));
    $('por-dia').innerHTML = Object.keys(dias).length ? Object.entries(dias).map(([f, v]) => `<div class="dia">
      <span>${diaCorto(f)}</span><div class="pista"><div class="relleno" style="width:${Math.max(2, v / max * 100).toFixed(1)}%"></div></div>
      <span class="derecha">${plata(v)}</span></div>`).join('') : '<p class="vacio">Sin ventas en el período.</p>';

    $('productos').innerHTML = r.productos.length ? r.productos.map((p, i) => `<div class="fila">
      <span>${i + 1}. ${esc(p.producto)}<small>${num(p.cantidad)} unidades</small></span>
      <span class="derecha">${plata(p.importe)}</span></div>`).join('') : '<p class="vacio">Sin ventas en el período.</p>';
  }

  function hace(min) {
    if (min === null || min === undefined) return 'nunca';
    if (min < 1) return 'recién';
    if (min < 120) return `hace ${min} min`;
    if (min < 48 * 60) return `hace ${Math.round(min / 60)} h`;
    return `hace ${Math.round(min / 1440)} días`;
  }

  function pintarLocales(lista, conCuenta) {
    if (!lista.length) return '<p class="vacio">No hay locales.</p>';
    return lista.map(l => {
      const e = l.estado || {};
      const grave = l.minutos_sin_sync === null || l.minutos_sin_sync > 15 || e.facturas_con_error;
      const clase = !l.alertas.length ? '' : grave ? 'mal' : 'alerta';
      const datos = [
        `Última conexión ${hace(l.minutos_sin_sync)}`,
        e.version && `versión ${esc(e.version)}`,
        e.caja_abierta ? 'caja abierta' : e.version && 'caja cerrada',
        e.ventas_sin_enviar && `${num(e.ventas_sin_enviar)} ventas por enviar`
      ].filter(Boolean).join(' · ');
      return `<div class="tarjeta local"><span class="punto ${clase}" aria-hidden="true"></span><div>
        <strong>${esc(l.nombre)}</strong>${conCuenta ? ` <small class="vacio">— ${esc(l.cuenta)} (${esc(l.cliente)})</small>` : ''}
        <p>${datos}</p>
        ${l.carta_online ? `<p>Carta y pedidos online: <a href="${esc(location.origin + l.carta_online)}" target="_blank" rel="noopener">${esc(location.host + l.carta_online)}</a></p>` : ''}
        ${l.alertas.length ? `<ul>${l.alertas.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : '<p>Todo en orden</p>'}
      </div></div>`;
    }).join('');
  }

  // ---- Precios centrales: cada producto con su precio en cada sucursal ----
  let carta = null, editando = null;
  function pintarPrecios() {
    if (!carta) return;
    const q = $('buscar-producto').value.trim().toLowerCase();
    const lista = carta.productos.filter(p => !q || p.producto.toLowerCase().includes(q));
    if (!carta.productos.length) { $('lista-precios').innerHTML = '<p class="vacio">Todavía ninguna sucursal mandó su carta.</p>'; return; }
    $('lista-precios').innerHTML = lista.slice(0, 100).map(p => {
      const idx = carta.productos.indexOf(p);
      const chips = p.precios.map(x => `<span class="chip${x.precio_nuevo !== null ? ' nuevo' : ''}">${esc(x.local)} ${plata(x.precio)}${
        x.precio_nuevo !== null ? ` → ${plata(x.precio_nuevo)} (aplicando)` : ''}</span>`).join('');
      const form = editando === idx ? `<form class="cambiar" data-idx="${idx}">
          <label class="precio-nuevo">Precio nuevo<input type="number" name="precio" min="1" step="0.01" inputmode="decimal" required value="${esc(p.precios[0].precio)}"></label>
          ${carta.locales.length > 1 ? p.precios.map(x => `<label><input type="checkbox" name="local" value="${x.local_id}" checked> ${esc(x.local)}</label>`).join('') : ''}
          <div class="fila-botones"><button type="button" class="boton-sec" data-cancelar>Cancelar</button><button type="submit" class="boton">Aplicar</button></div>
          <p class="error error-form" role="alert"></p></form>` : '';
      return `<div class="tarjeta producto${p.distinto ? ' distinto' : ''}"><div class="producto-cab"><strong>${esc(p.producto)}</strong>
        ${editando === idx ? '' : `<button type="button" class="boton-sec" data-editar="${idx}">Cambiar</button>`}</div>
        <div class="precios">${chips}</div>${p.distinto ? '<p class="nota-izq">Precio distinto entre sucursales</p>' : ''}${form}</div>`;
    }).join('') + (lista.length > 100 ? '<p class="vacio">Mostrando 100. Buscá para ver el resto.</p>' : '')
      + (!lista.length ? '<p class="vacio">Ningún producto con ese nombre.</p>' : '');
  }
  async function cargarPrecios() {
    if (editando !== null) return; // no borrar lo que se está escribiendo
    carta = await api('/api/panel/carta');
    pintarPrecios();
  }
  $('buscar-producto').addEventListener('input', () => { editando = null; pintarPrecios(); });
  $('lista-precios').addEventListener('click', ev => {
    const b = ev.target.closest('[data-editar]');
    if (b) { editando = Number(b.dataset.editar); pintarPrecios(); const i = document.querySelector('.cambiar input[name=precio]'); if (i) i.select(); }
    if (ev.target.closest('[data-cancelar]')) { editando = null; pintarPrecios(); }
  });
  $('lista-precios').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target, p = carta.productos[Number(f.dataset.idx)];
    const locales = [...f.querySelectorAll('input[name=local]')].filter(x => x.checked).map(x => Number(x.value));
    if (carta.locales.length > 1 && !locales.length) { f.querySelector('.error').textContent = 'Elegí al menos una sucursal'; return; }
    f.querySelector('button[type=submit]').disabled = true;
    try {
      await api('/api/panel/precios', { method: 'POST', body: JSON.stringify({ producto: p.producto, precio: Number(f.precio.value),
        ...(carta.locales.length > 1 ? { locales } : {}) }) });
      editando = null;
      await cargarPrecios();
    } catch (e) {
      f.querySelector('.error').textContent = e.message;
      f.querySelector('button[type=submit]').disabled = false;
    }
  });

  async function cargar() {
    try {
      if (vista === 'ventas') await cargarVentas();
      else if (vista === 'precios') await cargarPrecios();
      else if (vista === 'locales') $('lista-locales').innerHTML = pintarLocales(await api('/api/panel/locales'), false);
      else $('lista-soporte').innerHTML = pintarLocales(await api('/api/soporte/locales'), true);
      $('actualizado').textContent = 'Actualizado ' + new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      $('actualizado').textContent = 'No se pudo actualizar: ' + e.message;
    }
  }

  function mostrarPanel() {
    $('ingreso').hidden = true;
    $('panel').hidden = false;
    $('cuenta').textContent = usuario ? (usuario.cuenta || (usuario.rol === 'soporte' ? 'Soporte' : usuario.nombre)) : '';
    $('pestana-soporte').hidden = !usuario || usuario.rol !== 'soporte';
    $('pestana-precios').hidden = !usuario || usuario.rol !== 'duenio';
    cargar();
    clearInterval(reloj);
    reloj = setInterval(() => { if (!document.hidden) cargar(); }, 60000);
  }

  function salir() {
    token = null; usuario = null; clearInterval(reloj);
    try { localStorage.removeItem('morfiNubeToken'); localStorage.removeItem('morfiNubeUsuario'); } catch (e) {}
    $('panel').hidden = true;
    $('ingreso').hidden = false;
  }

  $('form-ingreso').addEventListener('submit', async ev => {
    ev.preventDefault();
    const boton = ev.target.querySelector('button');
    boton.disabled = true;
    $('error-ingreso').textContent = '';
    try {
      const r = await api('/api/login', { method: 'POST', body: JSON.stringify({ email: $('email').value, password: $('password').value }) });
      token = r.token; usuario = r.usuario;
      try { localStorage.setItem('morfiNubeToken', token); localStorage.setItem('morfiNubeUsuario', JSON.stringify(usuario)); } catch (e) {}
      $('password').value = '';
      mostrarPanel();
    } catch (e) {
      $('error-ingreso').textContent = e.message;
    } finally { boton.disabled = false; }
  });

  $('salir').addEventListener('click', salir);
  document.querySelector('.pestanas').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-vista]');
    if (!b) return;
    vista = b.dataset.vista;
    document.querySelectorAll('.pestanas button').forEach(x => x.classList.toggle('activa', x === b));
    editando = null;
    for (const v of ['ventas', 'locales', 'precios', 'soporte']) $('vista-' + v).hidden = v !== vista;
    cargar();
  });
  $('periodos').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-p]');
    if (!b) return;
    periodo = b.dataset.p;
    document.querySelectorAll('#periodos button').forEach(x => x.classList.toggle('activa', x === b));
    cargar();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && token) cargar(); });

  if (token) mostrarPanel(); else salir();
})();
