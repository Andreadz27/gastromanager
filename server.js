// =============================================
// GASTROMANAGER - Servidor Principal
// Punto de entrada: migra la base, inicia Socket.IO y el servidor HTTP.
// El código está en src/ (app.js, rutas/, servicios/).
// =============================================

const { server } = require('./src/app');
const { PORT } = require('./src/config');
const { ZONA_HORARIA } = require('./src/tiempo');
const { iniciarRealtime } = require('./src/realtime');
const { migrarEsquema } = require('./src/migraciones');
const { backupSiCorresponde } = require('./src/servicios/backups');

iniciarRealtime(server);

migrarEsquema().then(() => server.listen(PORT, () => {
  console.log('==========================================');
  console.log('  🍽️  GASTROMANAGER v2.0');
  console.log('  Sistema de Gestión Gastronómica');
  console.log('==========================================');
  console.log(`  Servidor corriendo en: http://localhost:${PORT}`);
  console.log(`  API disponible en: http://localhost:${PORT}/api`);
  console.log(`  Socket.IO realtime: activo`);
  console.log(`  Zona horaria: ${ZONA_HORARIA}`);
  console.log('==========================================');
  // Copias de seguridad automáticas
  backupSiCorresponde();
  setInterval(backupSiCorresponde, 60 * 60 * 1000).unref();
})).catch(err => {
  console.error('Error al migrar la base de datos:', err);
  process.exit(1);
});
