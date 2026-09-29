'use strict';
// Patch 4: app.js — agrega cargarModulos() y wizard en showApp()
const fs = require('fs');
const file = require('path').join(__dirname, '..', 'public', 'js', 'app.js');
let src = fs.readFileSync(file, 'utf8');
const E = src.includes('\r\n') ? '\r\n' : '\n';
if (src.includes('cargarModulos')) { console.log('app.js ya aplicado'); process.exit(0); }

// Replace showApp() to add cargarModulos call + wizard
const VIEJO = `  showApp() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    document.getElementById('userName').textContent = this.usuario.nombre;
    document.getElementById('userRole').textContent = this.usuario.rol === 'admin' ? 'Administrador' : 'Vendedor';

    // Ocultar opciones de admin si no es admin
    if (this.usuario.rol !== 'admin') {
      document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
    }

    // Iniciar conexión Socket.IO realtime
    this.initSocket();

    this.navigateTo('dashboard');
  },`;

const NUEVO = `  showApp() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    document.getElementById('userName').textContent = this.usuario.nombre;
    document.getElementById('userRole').textContent = this.usuario.rol === 'admin' ? 'Administrador' : 'Vendedor';

    // Ocultar opciones de admin si no es admin
    if (this.usuario.rol !== 'admin') {
      document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
    }

    // Iniciar conexión Socket.IO realtime
    this.initSocket();

    // Cargar módulos activos y verificar setup
    this.cargarModulos();

    this.navigateTo('dashboard');
  },

  async cargarModulos() {
    try {
      const config = await API.getConfig();
      const modulos = Array.isArray(config.modulos_activos) && config.modulos_activos.length
        ? config.modulos_activos : null;
      if (modulos) this.aplicarModulos(modulos);
      // Mostrar wizard si admin y setup no completado
      if (this.usuario.rol === 'admin' && !config.setup_completado) {
        this.mostrarWizardSetup();
      }
    } catch (e) { /* silencioso */ }
  },

  aplicarModulos(modulos) {
    document.querySelectorAll('[data-modulo]').forEach(el => {
      const m = el.dataset.modulo;
      el.style.display = modulos.includes(m) ? '' : 'none';
    });
  },

  async mostrarWizardSetup() {
    let perfiles = {};
    try { perfiles = await API.getPerfilesNegocio(); } catch(e) { perfiles = {}; }
    const tarjetas = Object.entries(perfiles).map(([key, p]) => \`
      <div class="wizard-card" onclick="App.seleccionarPerfil('\${key}')" data-perfil="\${key}">
        <div class="wizard-card-icon"><i class="fas fa-store"></i></div>
        <div class="wizard-card-label">\${p.label}</div>
      </div>\`).join('');
    const div = document.getElementById('wizardSetup');
    if (!div) return;
    div.innerHTML = \`
      <div class="wizard-overlay">
        <div class="wizard-modal">
          <div class="wizard-header">
            <h2><i class="fas fa-store"></i> Configurar tipo de negocio</h2>
            <p>Elegí el perfil que mejor describe tu negocio. Podés cambiarlo después desde Configuración.</p>
          </div>
          <div class="tipos-negocio-grid">\${tarjetas}</div>
          <div class="wizard-footer">
            <button class="btn btn-outline" onclick="App.cerrarWizard()">Omitir por ahora</button>
          </div>
        </div>
      </div>\`;
    div.style.display = 'block';
  },

  async seleccionarPerfil(tipo) {
    try {
      let perfiles = {};
      try { perfiles = await API.getPerfilesNegocio(); } catch(e) {}
      const perfil = perfiles[tipo];
      await API.updateConfig({
        tipo_negocio: tipo,
        modulos_activos: perfil ? perfil.modulos : [],
        terminologia: perfil ? perfil.terminologia : {},
        setup_completado: 1
      });
      if (perfil) this.aplicarModulos(perfil.modulos);
      this.cerrarWizard();
      this.showToast('Perfil configurado: ' + (perfil ? perfil.label : tipo), 'success');
    } catch(err) {
      this.showToast(err.message, 'error');
    }
  },

  cerrarWizard() {
    const div = document.getElementById('wizardSetup');
    if (div) div.style.display = 'none';
  },`;

const srcN = src.replace(/\r\n/g, '\n');
const vN   = VIEJO.replace(/\r\n/g, '\n');
if (!srcN.includes(vN)) { console.error('Patron showApp no encontrado en app.js'); process.exit(1); }
const result = srcN.replace(vN, NUEVO.replace(/\r\n/g, '\n')).replace(/\n/g, E);
fs.writeFileSync(file, result, 'utf8');
console.log('OK app.js');
