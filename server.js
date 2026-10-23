// =============================================
// GASTROMANAGER - Servidor Principal
// Punto de entrada: migra la base, inicia Socket.IO y el servidor HTTP.
// El código está en src/ (app.js, rutas/, servicios/).
// =============================================

require('./src/env'); // .env de la instalación
const { server } = require('./src/app');
const { PORT } = require('./src/config');
const { ZONA_HORARIA } = require('./src/tiempo');
const { iniciarRealtime } = require('./src/realtime');
const { migrarConRespaldo } = require('./src/migraciones');
const { backupSiCorresponde, crearBackup } = require('./src/servicios/backups');
const { iniciarMonitoreo } = require('./src/servicios/monitoreo');
const { iniciarRecordatoriosWhatsApp } = require('./src/servicios/whatsapp');
const { iniciarModoSinConexion } = require('./src/servicios/sin-conexion');

iniciarRealtime(server);

// Copia previa si hay migraciones nuevas + migraciones en una sola transacción (ver src/migraciones.js)
migrarConRespaldo({ respaldar: crearBackup }).then(() => server.listen(PORT, () => {
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
  // Latido al servicio de monitoreo (si MONITOREO_URL está configurada)
  iniciarMonitoreo();
  // Recordatorios de reservas por WhatsApp (si está activado en Integraciones)
  iniciarRecordatoriosWhatsApp();
  // Aviso de "sin internet" y facturas en espera que se emiten solas al volver la conexión
  iniciarModoSinConexion();
})).catch(err => {
  console.error('Error al migrar la base de datos:', err);
  process.exit(1);
});
