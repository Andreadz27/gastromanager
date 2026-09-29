'use strict';
// Patch 6: styles.css — agrega estilos para wizard y tarjetas de tipo de negocio
const fs = require('fs');
const file = require('path').join(__dirname, '..', 'public', 'css', 'styles.css');
let src = fs.readFileSync(file, 'utf8');
const E = src.includes('\r\n') ? '\r\n' : '\n';
if (src.includes('tipos-negocio-grid')) { console.log('styles.css ya aplicado'); process.exit(0); }

const CSS = `

/* ===== WIZARD MULTI-NEGOCIO ===== */
.wizard-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.wizard-modal {
  background: var(--white);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: 32px;
  max-width: 720px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
}

.wizard-header {
  text-align: center;
  margin-bottom: 28px;
}

.wizard-header h2 {
  font-size: 1.5rem;
  color: var(--text);
  margin-bottom: 8px;
}

.wizard-header p {
  color: var(--text-light);
}

.wizard-footer {
  text-align: center;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}

.tipos-negocio-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
  margin: 16px 0;
}

.wizard-card {
  border: 2px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 16px 12px;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s, transform 0.1s;
  background: var(--white);
}

.wizard-card:hover {
  border-color: var(--accent);
  background: #fff7f0;
  transform: translateY(-2px);
}

.wizard-card.activo {
  border-color: var(--accent);
  background: #fff7f0;
  box-shadow: 0 0 0 3px rgba(249,115,22,0.15);
}

.wizard-card-icon {
  font-size: 1.8rem;
  color: var(--accent);
  margin-bottom: 8px;
}

.wizard-card-label {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text);
  line-height: 1.3;
}
`;

fs.appendFileSync(file, CSS.replace(/\n/g, E), 'utf8');
console.log('OK styles.css');
