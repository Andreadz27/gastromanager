// Servidor de prueba para la suite de QA: Morfi sobre una base nueva en una carpeta temporal (nunca la del local),
// con los usuarios de qa/datos.js y sin el asistente de primera configuración.
'use strict';
const { iniciarServidor } = require('../test/helpers');
const { USUARIOS } = require('./datos');

async function levantar(envExtra = {}) {
  const s = await iniciarServidor(envExtra);
  for (const u of Object.values(USUARIOS)) {
    // El administrador viene en la base nueva y el cajero lo crea iniciarServidor
    if (u.email === 'admin@morfi.local' || u.email === 'vendedor@test.com') continue;
    const [st, r] = await s.llamar('POST', '/api/usuarios', { nombre: u.nombre, email: u.email, password: u.password, rol: u.rol }, s.tokenAdmin);
    if (st !== 201) throw new Error(`No se pudo crear ${u.email}: ${st} ${JSON.stringify(r)}`);
  }
  await s.q('UPDATE usuarios SET debe_cambiar_password = 0');
  await s.q('UPDATE configuracion SET setup_completado = 1');
  return s;
}

module.exports = { levantar };

// node qa/servidor.js: deja uno corriendo para usar desde Postman o Maestro (Ctrl+C lo apaga y borra la base)
if (require.main === module) {
  levantar({ PORT: process.env.PORT || '' }).then(s => {
    console.log(`Morfi de prueba en ${s.base}  (usuarios en qa/datos.js). Ctrl+C para terminar.`);
    const fin = () => s.cerrar().then(() => process.exit(0));
    process.on('SIGINT', fin);
    process.on('SIGTERM', fin);
  }).catch(e => { console.error(e.message); process.exit(1); });
}
