'use strict';
// Patch 3: index.html — agrega data-modulo a nav items + div wizard
const fs = require('fs');
const file = require('path').join(__dirname, '..', 'public', 'index.html');
let src = fs.readFileSync(file, 'utf8');
const E = src.includes('\r\n') ? '\r\n' : '\n';
if (src.includes('data-modulo')) { console.log('index.html ya aplicado'); process.exit(0); }

const VIEJO = `      <nav class="sidebar-nav">
        <a href="#" class="nav-item active" data-view="dashboard">
          <i class="fas fa-chart-line"></i> Dashboard
        </a>
        <a href="#" class="nav-item" data-view="pos">
          <i class="fas fa-cash-register"></i> Punto de Venta
        </a>
        <a href="#" class="nav-item" data-view="mesas">
          <i class="fas fa-table"></i> Mesas
        </a>
        <a href="#" class="nav-item" data-view="pedidos">
          <i class="fas fa-receipt"></i> Pedidos
        </a>
        <a href="#" class="nav-item" data-view="delivery">
          <i class="fas fa-motorcycle"></i> Delivery
          <span class="nav-badge" id="navBadgeDelivery" style="display:none;"></span>
        </a>
        <a href="#" class="nav-item" data-view="cocina">
          <i class="fas fa-fire-burner"></i> Cocina
          <span class="nav-badge" id="navBadgeCocina" style="display:none;"></span>
        </a>
        <a href="#" class="nav-item admin-only" data-view="productos">
          <i class="fas fa-hamburger"></i> Productos
        </a>
        <a href="#" class="nav-item" data-view="stock">
          <i class="fas fa-boxes"></i> Inventario
        </a>
        <a href="#" class="nav-item" data-view="proveedores">
          <i class="fas fa-truck"></i> Proveedores
        </a>
        <a href="#" class="nav-item" data-view="clientes">
          <i class="fas fa-users"></i> Clientes
        </a>
        <a href="#" class="nav-item" data-view="caja">
          <i class="fas fa-money-bill-wave"></i> Caja
        </a>
        <a href="#" class="nav-item" data-view="reportes">
          <i class="fas fa-file-alt"></i> Reportes
        </a>
        <a href="#" class="nav-item admin-only" data-view="usuarios">
          <i class="fas fa-user-cog"></i> Usuarios
        </a>
        <a href="#" class="nav-item admin-only" data-view="config">
          <i class="fas fa-cog"></i> Configuración
        </a>
        <a href="menu.html" target="_blank" class="nav-item" title="Abrir carta digital para clientes">
          <i class="fas fa-qrcode"></i> Menú QR
        </a>
      </nav>`;

const NUEVO = `      <nav class="sidebar-nav">
        <a href="#" class="nav-item active" data-view="dashboard">
          <i class="fas fa-chart-line"></i> Dashboard
        </a>
        <a href="#" class="nav-item" data-view="pos" data-modulo="pos">
          <i class="fas fa-cash-register"></i> Punto de Venta
        </a>
        <a href="#" class="nav-item" data-view="mesas" data-modulo="mesas">
          <i class="fas fa-table"></i> Mesas
        </a>
        <a href="#" class="nav-item" data-view="pedidos" data-modulo="pedidos">
          <i class="fas fa-receipt"></i> Pedidos
        </a>
        <a href="#" class="nav-item" data-view="delivery" data-modulo="delivery">
          <i class="fas fa-motorcycle"></i> Delivery
          <span class="nav-badge" id="navBadgeDelivery" style="display:none;"></span>
        </a>
        <a href="#" class="nav-item" data-view="cocina" data-modulo="cocina">
          <i class="fas fa-fire-burner"></i> Cocina
          <span class="nav-badge" id="navBadgeCocina" style="display:none;"></span>
        </a>
        <a href="#" class="nav-item admin-only" data-view="productos" data-modulo="productos">
          <i class="fas fa-hamburger"></i> Productos
        </a>
        <a href="#" class="nav-item" data-view="stock" data-modulo="stock">
          <i class="fas fa-boxes"></i> Inventario
        </a>
        <a href="#" class="nav-item" data-view="proveedores" data-modulo="proveedores">
          <i class="fas fa-truck"></i> Proveedores
        </a>
        <a href="#" class="nav-item" data-view="clientes" data-modulo="clientes">
          <i class="fas fa-users"></i> Clientes
        </a>
        <a href="#" class="nav-item" data-view="caja" data-modulo="caja">
          <i class="fas fa-money-bill-wave"></i> Caja
        </a>
        <a href="#" class="nav-item" data-view="reportes" data-modulo="reportes">
          <i class="fas fa-file-alt"></i> Reportes
        </a>
        <a href="#" class="nav-item admin-only" data-view="usuarios">
          <i class="fas fa-user-cog"></i> Usuarios
        </a>
        <a href="#" class="nav-item admin-only" data-view="config">
          <i class="fas fa-cog"></i> Configuración
        </a>
        <a href="menu.html" target="_blank" class="nav-item" title="Abrir carta digital para clientes">
          <i class="fas fa-qrcode"></i> Menú QR
        </a>
      </nav>`;

const srcN = src.replace(/\r\n/g, '\n');
const vN   = VIEJO.replace(/\r\n/g, '\n');
if (!srcN.includes(vN)) { console.error('Patron nav no encontrado en index.html'); process.exit(1); }

// Also insert wizard div before </div> closing main
let result = srcN.replace(vN, NUEVO.replace(/\r\n/g, '\n'));

// Add wizard modal div before </body>
const WIZARD_MARKER = '  <!-- Toast notifications -->';
if (!result.includes('wizardSetup') && result.includes(WIZARD_MARKER)) {
  result = result.replace(WIZARD_MARKER,
    `  <!-- Wizard setup multi-negocio -->\n  <div id="wizardSetup" style="display:none;"></div>\n\n  <!-- Toast notifications -->`);
}

fs.writeFileSync(file, result.replace(/\n/g, E), 'utf8');
console.log('OK index.html');
