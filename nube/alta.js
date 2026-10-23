'use strict';
// Altas en Morfi Nube (se corre en el servidor de la nube):
//   node nube/alta.js local   --cuenta "La Buena Mesa" --nombre "Sucursal Centro" --cliente la-buena-mesa-centro
//   node nube/alta.js usuario --cuenta "La Buena Mesa" --nombre "Ana" --email ana@x.com --password ********
//   node nube/alta.js soporte --nombre "Soporte Morfi" --email soporte@morfi.com.ar --password ********
// El token del local se muestra UNA vez: va en el .env del local como NUBE_TOKEN (en la nube solo queda su hash).
const { altaLocal, altaUsuario } = require('./app');
const { listo, cerrar } = require('./db');

function opciones(args) {
  const o = {};
  for (let i = 0; i < args.length; i++) if (args[i].startsWith('--')) o[args[i].slice(2)] = args[++i];
  return o;
}

async function main() {
  const [accion, ...resto] = process.argv.slice(2);
  const o = opciones(resto);
  await listo;
  if (accion === 'local') {
    if (!o.cuenta || !o.nombre || !o.cliente) throw new Error('Faltan --cuenta, --nombre o --cliente');
    const r = await altaLocal(o);
    console.log(`Local "${o.nombre}" creado en la cuenta "${o.cuenta}".`);
    console.log('Agregá en el .env del local (y reiniciá Morfi):');
    console.log(`  NUBE_URL=<la dirección de esta nube, con https>`);
    console.log(`  NUBE_TOKEN=${r.token}`);
  } else if (accion === 'usuario' || accion === 'soporte') {
    if (!o.nombre || !o.email || !o.password) throw new Error('Faltan --nombre, --email o --password');
    await altaUsuario({ ...o, rol: accion === 'soporte' ? 'soporte' : 'duenio' });
    console.log(`Usuario ${o.email} creado.`);
  } else {
    throw new Error('Uso: node nube/alta.js local|usuario|soporte --opciones (ver el comienzo de nube/alta.js)');
  }
}

main().then(cerrar, async e => { console.error(e.message); await cerrar(); process.exit(1); });
