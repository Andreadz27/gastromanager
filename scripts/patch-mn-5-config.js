'use strict';
// Patch 5: config.js — agrega sección "Tipo de negocio" en el panel de configuración
const fs = require('fs');
const file = require('path').join(__dirname, '..', 'public', 'js', 'config.js');
let src = fs.readFileSync(file, 'utf8');
const E = src.includes('\r\n') ? '\r\n' : '\n';
if (src.includes('seleccionarTipo')) { console.log('config.js ya aplicado'); process.exit(0); }

// 1. Ampliar render() para cargar perfiles también
const VIEJO_RENDER = `      const [config, promociones, plataformas] = await Promise.all([API.getConfig(), API.getPromociones(), API.getPlataformasDelivery()]);
      this.config = config;
      this.promociones = promociones || [];
      this.plataformas = plataformas || [];`;
const NUEVO_RENDER = `      const [config, promociones, plataformas, perfiles] = await Promise.all([API.getConfig(), API.getPromociones(), API.getPlataformasDelivery(), API.getPerfilesNegocio().catch(()=>({}))]);
      this.config = config;
      this.promociones = promociones || [];
      this.plataformas = plataformas || [];
      this.perfiles = perfiles || {};`;

// 2. Insertar tarjetas de tipo de negocio antes del form de datos generales
const VIEJO_PAINT = `      <div class="card">
        <form onsubmit="ConfigView.guardar(event)">`;
const NUEVO_PAINT = `      <div class="card">
        <div class="card-header">
          <span class="card-title"><i class="fas fa-store"></i> Tipo de negocio</span>
          <span class="card-subtitle">Define qué módulos están activos</span>
        </div>
        <div class="tipos-negocio-grid">
          \${Object.entries(this.perfiles || {}).map(([key, p]) => \`
            <div class="wizard-card \${(this.config||{}).tipo_negocio===key?'activo':''}"
                 onclick="ConfigView.seleccionarTipo('\${key}')" data-perfil="\${key}">
              <div class="wizard-card-label">\${p.label}</div>
            </div>\`).join('')}
        </div>
      </div>

      <div class="card">
        <form onsubmit="ConfigView.guardar(event)">`;

// 3. Ampliar guardar() para persistir tipo_negocio si fue seleccionado
const VIEJO_GUARDAR = `    const data = {
      nombre_negocio: document.getElementById('cfgNombre').value,
      direccion: document.getElementById('cfgDireccion').value,
      telefono: document.getElementById('cfgTelefono').value,
      email: document.getElementById('cfgEmail').value,
      cuit: document.getElementById('cfgCuit').value,
      tasa_iva: parseInt(document.getElementById('cfgIva').value || 21),
      moneda: document.getElementById('cfgMoneda').value,
      activar_impresion: parseInt(document.getElementById('cfgImpresion').value)
    };`;
const NUEVO_GUARDAR = `    const data = {
      nombre_negocio: document.getElementById('cfgNombre').value,
      direccion: document.getElementById('cfgDireccion').value,
      telefono: document.getElementById('cfgTelefono').value,
      email: document.getElementById('cfgEmail').value,
      cuit: document.getElementById('cfgCuit').value,
      tasa_iva: parseInt(document.getElementById('cfgIva').value || 21),
      moneda: document.getElementById('cfgMoneda').value,
      activar_impresion: parseInt(document.getElementById('cfgImpresion').value),
      setup_completado: 1
    };
    if (this._tipoSeleccionado) {
      data.tipo_negocio = this._tipoSeleccionado;
      const p = (this.perfiles || {})[this._tipoSeleccionado];
      if (p) { data.modulos_activos = p.modulos; data.terminologia = p.terminologia; }
    }`;

// 4. Agregar método seleccionarTipo antes de togglePlataforma
const VIEJO_TOGGLE = `  async togglePlataforma(id, activa) {`;
const NUEVO_TOGGLE = `  seleccionarTipo(tipo) {
    this._tipoSeleccionado = tipo;
    document.querySelectorAll('.wizard-card[data-perfil]').forEach(el => {
      el.classList.toggle('activo', el.dataset.perfil === tipo);
    });
  },

  async togglePlataforma(id, activa) {`;

let srcN = src.replace(/\r\n/g, '\n');
let ok = true;
[[VIEJO_RENDER, NUEVO_RENDER],[VIEJO_PAINT, NUEVO_PAINT],[VIEJO_GUARDAR, NUEVO_GUARDAR],[VIEJO_TOGGLE, NUEVO_TOGGLE]]
  .forEach(([v, n], i) => {
    const vN = v.replace(/\r\n/g, '\n');
    if (!srcN.includes(vN)) { console.error(`Patron ${i+1} no encontrado en config.js`); ok = false; return; }
    srcN = srcN.replace(vN, n.replace(/\r\n/g, '\n'));
  });
if (!ok) process.exit(1);
fs.writeFileSync(file, srcN.replace(/\n/g, E), 'utf8');
console.log('OK config.js');
