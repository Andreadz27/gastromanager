'use strict';
// Morfi Nube: npm run nube (PORT, NUBE_DATOS, NUBE_SECRETO, TRUST_PROXY=true detrás de un proxy con https)
const { app } = require('./app');
const { listo } = require('./db');

const PORT = Number(process.env.PORT) || 4000;
listo.then(() => app.listen(PORT, () => console.log(`[nube] Morfi Nube en http://localhost:${PORT}`)))
  .catch(e => { console.error('[nube] No se pudo abrir la base:', e); process.exit(1); });
