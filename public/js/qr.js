// =============================================
// GASTROMANAGER - Vista QR & Display Cocina
// =============================================

const QRView = {
  _qrUrl: '',
  _qrApiUrl: '',

  async render() {
    const view = document.getElementById('view-qr');
    view.innerHTML = '<div class="text-center mt-20"><i class="fas fa-spinner fa-spin fa-3x"></i></div>';
    try {
      const info = await fetch('/api/publico/info').then(r => r.json()).catch(() => ({}));
      const links = (info && info.links) || {};
      this._qrUrl = links.carta || (window.location.origin + '/menu.html');
      this._paint(view, info || {});
    } catch (err) {
      this._qrUrl = window.location.origin + '/menu.html';
      this._paint(view, {});
    }
  },

  _paint(view, info) {
    const urlMenu    = this._qrUrl;
    const urlDisplay = window.location.origin + '/cocina-display.html';
    const urlWA  = (info.links && info.links.whatsapp)  || (window.location.origin + '/pedido.html?origen=whatsapp');
    const urlIG  = (info.links && info.links.instagram) || (window.location.origin + '/pedido.html?origen=instagram');
    const waShare = 'https://wa.me/?text=' + encodeURIComponent('\u00a1Mir\u00e1 nuestra carta! ' + urlMenu);

    view.innerHTML = `
      <div class="page-header">
        <div>
          <h2><i class="fas fa-qrcode"></i> Men\u00fa QR &amp; Display Cocina</h2>
          <p>Compartí tu carta digital y gestioná la pantalla de cocina</p>
        </div>
      </div>

      ${App.puede('catalogo') ? `
      <div class="card mb-20">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-chair"></i> QR de cada mesa: pedir desde la mesa</span>
          <span class="card-subtitle">El cliente escanea, pide, llama al mozo o pide la cuenta. El mozo confirma desde Mesas.</span>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;padding:0 16px 16px;">
          <button class="btn btn-primary" onclick="QRView.imprimirQrMesas()"><i class="fas fa-print"></i> Imprimir QR de las mesas</button>
          <button class="btn btn-outline" onclick="QRView.listaQrMesas()"><i class="fas fa-list"></i> Ver por mesa / QR nuevo</button>
          <button class="btn btn-outline" onclick="App.navigateTo('config')"><i class="fas fa-cog"></i> Cómo llegan los pedidos (Configuración)</button>
        </div>
      </div>` : ''}

      <div class="qr-page-grid">

        <!-- Panel QR -->
        <div class="card qr-card-main">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-qrcode"></i> C\u00f3digo QR &mdash; Carta Digital</span>
            <span class="card-subtitle">Imprimilo y colocalo en cada mesa</span>
          </div>
          ${/^(localhost|127\.|\[::1\])/.test(new URL(urlMenu).hostname) ? `
          <div style="background:#fef3c7;color:#92400e;border-radius:8px;padding:10px 12px;margin:8px 12px;font-size:13px;">
            <i class="fas fa-exclamation-triangle"></i> Este QR apunta a <b>esta computadora</b> y no va a abrir en los celulares.
            Entrá a GastroManager con la dirección de la red del local (la que usan los mozos) o pedile a soporte que configure la dirección pública.
          </div>` : ''}
          <div class="qr-center-block">
            <div class="qr-wrapper" id="qrCanvas">
              <div class="qr-loading"><i class="fas fa-spinner fa-spin fa-2x"></i></div>
            </div>
            <div id="qrUrlLabel" style="font-size:11px;color:var(--text-light);margin-top:8px;
              word-break:break-all;text-align:center;max-width:280px;">
              ${esc(urlMenu)}
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;justify-content:center;margin:8px 0;">
            <label style="font-size:13px;color:var(--text-light);">Tama\u00f1o:</label>
            <select id="qrSizeSelect" onchange="QRView._generarQR()"
              style="padding:4px 10px;border-radius:6px;border:1px solid var(--border);font-size:13px;">
              <option value="160">Peque\u00f1o</option>
              <option value="220" selected>Mediano</option>
              <option value="300">Grande</option>
            </select>
          </div>
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;padding:0 16px 16px;">
            <button class="btn btn-primary" onclick="QRView._descargarQR()">
              <i class="fas fa-download"></i> Descargar QR
            </button>
            <button class="btn btn-outline" onclick="window.open(${jsArg(urlMenu)},'_blank')">
              <i class="fas fa-external-link-alt"></i> Ver carta
            </button>
          </div>
        </div>

        <!-- Panel derecho -->
        <div style="display:flex;flex-direction:column;gap:16px;">

          <!-- Links compartir -->
          <div class="card">
            <div class="card-header">
              <span class="card-title"><i class="fas fa-share-alt"></i> Links para compartir</span>
            </div>
            <div class="qr-links-list">

              <div class="qr-link-row">
                <div class="qr-link-icon" style="background:rgba(249,115,22,.12);color:var(--accent);">
                  <i class="fas fa-utensils"></i></div>
                <div class="qr-link-info">
                  <div class="qr-link-label">Carta Digital</div>
                  <div class="qr-link-url" id="qlCarta">${esc(urlMenu)}</div>
                </div>
                <div class="qr-link-btns">
                  <button class="btn btn-outline btn-sm" onclick="QRView._copiar('qlCarta')" title="Copiar">
                    <i class="fas fa-copy"></i></button>
                  <a class="btn btn-success btn-sm" href="${esc(urlMenu)}" target="_blank" rel="noopener">
                    <i class="fas fa-external-link-alt"></i></a>
                </div>
              </div>

              <div class="qr-link-row">
                <div class="qr-link-icon" style="background:rgba(34,197,94,.12);color:#16a34a;">
                  <i class="fab fa-whatsapp"></i></div>
                <div class="qr-link-info">
                  <div class="qr-link-label">WhatsApp</div>
                  <div class="qr-link-url" id="qlWA">${esc(urlWA)}</div>
                </div>
                <div class="qr-link-btns">
                  <button class="btn btn-outline btn-sm" onclick="QRView._copiar('qlWA')" title="Copiar">
                    <i class="fas fa-copy"></i></button>
                  <a class="btn btn-success btn-sm" href="${esc(waShare)}" target="_blank" rel="noopener">
                    <i class="fab fa-whatsapp"></i></a>
                </div>
              </div>

              <div class="qr-link-row">
                <div class="qr-link-icon" style="background:rgba(168,85,247,.12);color:#a855f7;">
                  <i class="fab fa-instagram"></i></div>
                <div class="qr-link-info">
                  <div class="qr-link-label">Instagram (bio)</div>
                  <div class="qr-link-url" id="qlIG">${esc(urlIG)}</div>
                </div>
                <div class="qr-link-btns">
                  <button class="btn btn-outline btn-sm" onclick="QRView._copiar('qlIG')" title="Copiar">
                    <i class="fas fa-copy"></i></button>
                </div>
              </div>

            </div>
          </div>

          <!-- Display Cocina -->
          <div class="card">
            <div class="card-header">
              <span class="card-title"><i class="fas fa-tablet-alt"></i> Display Cocina</span>
              <span class="card-subtitle">Pantalla para tablet &mdash; tiempo real</span>
            </div>
            <div style="padding:16px;display:flex;flex-direction:column;gap:12px;">
              <div style="display:flex;align-items:flex-start;gap:14px;">
                <div style="width:48px;height:48px;border-radius:12px;
                  background:rgba(249,115,22,.12);color:var(--accent);
                  display:flex;align-items:center;justify-content:center;
                  font-size:22px;flex-shrink:0;">
                  <i class="fas fa-fire-burner"></i>
                </div>
                <div>
                  <div style="font-weight:700;font-size:15px;">Pantalla de Cocina</div>
                  <div style="font-size:13px;color:var(--text-light);margin-top:4px;line-height:1.5;">
                    Mostr\u00e1 las comandas en tiempo real en una tablet o segundo monitor.
                    El cocinero puede marcar cada comanda como lista directamente desde esta pantalla.
                  </div>
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:8px;background:var(--bg);
                padding:8px 12px;border-radius:8px;border:1px solid var(--border);">
                <div id="qlDisplay" style="flex:1;font-size:12px;color:var(--text-light);
                  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                  ${esc(urlDisplay)}
                </div>
                <button class="btn btn-outline btn-sm" onclick="QRView._copiar('qlDisplay')">
                  <i class="fas fa-copy"></i>
                </button>
              </div>
              <div style="display:flex;gap:10px;flex-wrap:wrap;">
                <button class="btn btn-primary"
                  onclick="window.open('cocina-display.html','_blank','width=1280,height=800')">
                  <i class="fas fa-external-link-alt"></i> Abrir display cocina
                </button>
                <button class="btn btn-outline" onclick="App.navigateTo('cocina')">
                  <i class="fas fa-fire-burner"></i> Vista interna cocina
                </button>
              </div>
              <div style="display:flex;align-items:center;gap:16px;
                border-top:1px solid var(--border);padding-top:12px;">
                <div id="qrDisplayMini" style="background:#fff;padding:8px;border-radius:8px;
                  border:1px solid var(--border);flex-shrink:0;"></div>
                <div style="font-size:12px;color:var(--text-light);line-height:1.6;">
                  Escane\u00e1 este QR desde la tablet de cocina para abrirla
                  directamente sin escribir la URL.
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>`;

    this._generarQR();
    this._generarQRMini('qrDisplayMini', urlDisplay, 100);
  },

  _generarQR() {
    const cont = document.getElementById('qrCanvas');
    if (!cont) return;
    const url  = this._qrUrl || (window.location.origin + '/menu.html');
    const size = parseInt((document.getElementById('qrSizeSelect') || {}).value || '220');
    this._qrApiUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=' + size + 'x' + size +
                     '&data=' + encodeURIComponent(url) + '&format=png&margin=10';
    cont.innerHTML = '<img id="qrImg" src="' + this._qrApiUrl + '" width="' + size +
      '" height="' + size + '" alt="QR Carta Digital" style="display:block;border-radius:6px;"' +
      ' onerror="this.parentElement.innerHTML=\'<p style=&quot;color:var(--danger);font-size:12px;padding:8px;&quot;>No se pudo cargar el QR</p>\'">';
    const lbl = document.getElementById('qrUrlLabel');
    if (lbl) lbl.textContent = url;
  },

  _generarQRMini(containerId, url, size) {
    const cont = document.getElementById(containerId);
    if (!cont) return;
    const apiUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=' + size + 'x' + size +
                   '&data=' + encodeURIComponent(url) + '&format=png&margin=6';
    cont.innerHTML = '<img src="' + apiUrl + '" width="' + size + '" height="' + size +
      '" alt="QR" style="display:block;border-radius:4px;">';
  },

  _descargarQR() {
    if (!this._qrApiUrl) { App.showToast('Generá el QR primero', 'warning'); return; }
    const a = document.createElement('a');
    a.href = this._qrApiUrl;
    a.download = 'qr-carta-digital.png';
    a.target = '_blank';
    a.rel = 'noopener';
    a.click();
    App.showToast('Descargando QR...', 'success');
  },

  // ===== QR de cada mesa (los genera el servidor: no dependen de un servicio externo) =====
  async _qrMesas() {
    // Sin dirección pública, la que usa este navegador: tiene que ser la de la red del local, no localhost
    const base = window.location.origin;
    const qrs = await API.getQrMesas(base);
    if (qrs.length && /^https?:\/\/(localhost|127\.|\[::1\])/.test(qrs[0].url))
      App.showToast('Estos QR apuntan a esta computadora y no abren en los celulares. Entrá con la dirección de la red del local.', 'warning', 10000);
    return qrs;
  },

  async imprimirQrMesas() {
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) { App.showToast('Habilitá las ventanas emergentes para imprimir', 'warning'); return; }
    try {
      const qrs = await this._qrMesas();
      const negocio = (App.config && App.config.nombre_negocio) || '';
      // El SVG lo arma el servidor con la librería qrcode (solo figuras, sin texto del usuario)
      win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>QR de las mesas</title><style>
        body{font-family:Arial,sans-serif;margin:0;padding:10mm;}
        .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8mm;}
        .qr{border:1px dashed #999;border-radius:4mm;padding:5mm;text-align:center;break-inside:avoid;}
        .qr svg{width:45mm;height:45mm;}
        .mesa{font-size:20pt;font-weight:bold;margin:2mm 0;}
        .ayuda{font-size:10pt;color:#333;}
      </style></head><body><div class="grid">${qrs.map(q => `
        <div class="qr"><div class="ayuda">${esc(negocio)}</div><div class="mesa">${esc(q.nombre)}</div>${q.svg}
        <div class="ayuda">Escaneá para pedir, llamar al mozo o pedir la cuenta</div></div>`).join('')}
      </div><script>window.onload=function(){window.print();};<\/script></body></html>`);
      win.document.close();
    } catch (err) {
      win.close();
      App.showToast(err.message, 'error');
    }
  },

  async listaQrMesas() {
    try {
      const qrs = await this._qrMesas();
      App.showModal(`
        <p class="text-muted">Si alguien se llevó una foto del QR de una mesa, generá uno nuevo: el anterior deja de funcionar y hay que reimprimirlo.</p>
        <div class="table-wrap"><table><thead><tr><th>Mesa</th><th>Link</th><th></th></tr></thead><tbody>
        ${qrs.map(q => `<tr><td><strong>${esc(q.nombre)}</strong></td>
          <td><a href="${esc(q.url)}" target="_blank" rel="noopener">Abrir</a></td>
          <td><button class="btn btn-outline btn-sm" onclick="QRView.nuevoQrMesa(${q.id}, ${jsArg(q.nombre)})"><i class="fas fa-sync-alt"></i> QR nuevo</button></td></tr>`).join('')}
        </tbody></table></div>`, { title: 'QR de cada mesa' });
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  async nuevoQrMesa(id, nombre) {
    if (!confirm(`¿Generar un QR nuevo para ${nombre}? El que está impreso deja de funcionar.`)) return;
    try {
      await API.nuevoQrMesa(id);
      App.showToast(`QR nuevo para ${nombre}: imprimilo y reemplazá el de la mesa`, 'success', 8000);
      this.listaQrMesas();
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  _copiar(elId) {
    const el = document.getElementById(elId);
    if (!el) return;
    const txt = (el.textContent || el.value || '').trim();
    if (!txt) return;
    navigator.clipboard.writeText(txt).then(() => {
      App.showToast('Copiado al portapapeles', 'success');
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = txt;
      ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      App.showToast('Copiado', 'success');
    });
  }
};