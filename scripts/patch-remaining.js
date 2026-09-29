// patch-remaining.js — node scripts/patch-remaining.js
'use strict';
const fs = require('fs');
const path = require('path');
const PUB = path.join(__dirname, '..', 'public');

function read(rel) { return fs.readFileSync(path.join(PUB, rel), 'utf8'); }
function write(rel, txt) { fs.writeFileSync(path.join(PUB, rel), txt, 'utf8'); }

// Detect line ending
function eol(txt) { return txt.includes('\r\n') ? '\r\n' : '\n'; }

// Insert lines after a line that includes `marker` (1-based search)
function insertAfter(txt, marker, newLines) {
  const le = eol(txt);
  const lines = txt.split(le);
  const idx = lines.findIndex(l => l.includes(marker));
  if (idx === -1) throw new Error('Marker not found: ' + marker);
  lines.splice(idx + 1, 0, ...newLines);
  return lines.join(le);
}

// Replace exact line content
function replaceLine(txt, marker, newLine) {
  const le = eol(txt);
  const lines = txt.split(le);
  const idx = lines.findIndex(l => l.includes(marker));
  if (idx === -1) throw new Error('Marker not found: ' + marker);
  lines[idx] = newLine;
  return lines.join(le);
}

// ── 1. delivery.js ────────────────────────────
let d = read('js/delivery.js');
if (!d.includes('_socketBound')) {
  // Add _socketBound: false after "filtro: 'todos',"
  d = insertAfter(d, "filtro: 'todos',", ["  _socketBound: false,"]);
  // Add clearBadge + _bindSocket call after the view.innerHTML spinner line in render()
  d = insertAfter(d,
    "view.innerHTML = '<div class=\"text-center mt-20\"><i class=\"fas fa-spinner fa-spin fa-3x\"></i></div>';",
    [
      "    App.clearBadge('navBadgeDelivery');",
      "    this._bindSocket();"
    ]
  );
  // Insert _bindSocket method before setFiltro
  d = insertAfter(d, "  setFiltro(filtro) {", []); // find index first
  const le = eol(d);
  const lines = d.split(le);
  const idx = lines.findIndex(l => l.includes("  setFiltro(filtro) {"));
  const bindLines = [
    "  _bindSocket() {",
    "    if (this._socketBound) return;",
    "    if (!App || !App.socket) return;",
    "    this._socketBound = true;",
    "    App.socket.on('delivery:actualizar', () => {",
    "      if (App.currentView === 'delivery') this.render();",
    "    });",
    "  },",
    ""
  ];
  lines.splice(idx, 0, ...bindLines);
  d = lines.join(le);
  write('js/delivery.js', d);
  console.log('OK delivery.js');
} else {
  console.log('SKIP delivery.js');
}

// ── 2. dashboard.js ───────────────────────────
let dash = read('js/dashboard.js');
if (!dash.includes('_socketBound')) {
  // Add _socketBound after "insights: null,"
  dash = insertAfter(dash, "  insights: null,", ["  _socketBound: false,"]);
  // Add _bindSocket call in render() after spinner line
  dash = insertAfter(dash,
    "view.innerHTML = '<div class=\"text-center mt-20\"><i class=\"fas fa-spinner fa-spin fa-3x\"></i></div>';",
    ["    this._bindSocket();"]
  );
  // Insert _bindSocket before renderAlertas
  const le = eol(dash);
  const lines = dash.split(le);
  const idx = lines.findIndex(l => l.includes("  renderAlertas() {"));
  const bindLines = [
    "  _bindSocket() {",
    "    if (this._socketBound) return;",
    "    if (!App || !App.socket) return;",
    "    this._socketBound = true;",
    "    App.socket.on('dashboard:actualizar', () => {",
    "      if (App.currentView === 'dashboard') this.render();",
    "    });",
    "    App.socket.on('pedido:pagado', () => {",
    "      if (App.currentView === 'dashboard') this.render();",
    "    });",
    "  },",
    ""
  ];
  lines.splice(idx, 0, ...bindLines);
  dash = lines.join(le);
  write('js/dashboard.js', dash);
  console.log('OK dashboard.js');
} else {
  console.log('SKIP dashboard.js');
}

// ── 3. styles.css — append realtime + badge CSS
let css = read('css/styles.css');
if (!css.includes('realtime-dot')) {
  css += `
/* ===== REALTIME INDICATOR ===== */
.realtime-indicator {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 10px;
  background: rgba(255,255,255,0.06);
  border-radius: 20px;
  margin-bottom: 10px;
}
.realtime-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
  transition: background 0.4s;
}
.realtime-dot.online {
  background: #22c55e;
  box-shadow: 0 0 0 3px rgba(34,197,94,0.25);
  animation: pulse-green 2s infinite;
}
.realtime-dot.offline { background: #64748b; }
@keyframes pulse-green {
  0%   { box-shadow: 0 0 0 0   rgba(34,197,94,0.4); }
  70%  { box-shadow: 0 0 0 7px rgba(34,197,94,0); }
  100% { box-shadow: 0 0 0 0   rgba(34,197,94,0); }
}
.realtime-label {
  font-size: 11px;
  color: rgba(255,255,255,0.55);
  font-weight: 500;
}
.nav-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  background: var(--accent);
  color: #fff;
  border-radius: 9px;
  font-size: 10px;
  font-weight: 700;
  margin-left: auto;
  line-height: 1;
}
.realtime-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  color: #22c55e;
  background: rgba(34,197,94,0.1);
  border: 1px solid rgba(34,197,94,0.25);
  border-radius: 20px;
  padding: 3px 10px;
}
.toast { cursor: pointer; user-select: none; }
`;
  write('css/styles.css', css);
  console.log('OK styles.css');
} else {
  console.log('SKIP styles.css');
}

// ── 4. index.html — service worker registration
let html = read('index.html');
if (!html.includes('serviceWorker')) {
  html = html.replace(
    '<script src="js/app.js"></script>',
    '<script src="js/app.js"></script>\n  <script>\n    if (\'serviceWorker\' in navigator) {\n      window.addEventListener(\'load\', () => {\n        navigator.serviceWorker.register(\'/sw.js\')\n          .then(r => console.log(\'SW:\', r.scope))\n          .catch(e => console.warn(\'SW error:\', e));\n      });\n    }\n  </script>'
  );
  write('index.html', html);
  console.log('OK index.html');
} else {
  console.log('SKIP index.html');
}

console.log('\nAll done.');
