'use strict';
// Altas en Morfi Nube (se corre en el servidor de la nube):
//   node nube/alta.js local   --cuenta "La Buena Mesa" --nombre "Sucursal Centro" --cliente la-buena-mesa-centro [--plan pro]
//   node nube/alta.js usuario --cuenta "La Buena Mesa" --nombre "Ana" --email ana@x.com --password ********
//   node nube/alta.js soporte --nombre "Soporte Morfi" --email soporte@morfi.com.ar --password ********
//   node nube/alta.js plan    --cliente la-buena-mesa-centro --plan pro --vence 2026-12-31 [--extras asistente]
// El token del local se muestra UNA vez: va en el .env del local como NUBE_TOKEN (en la nube solo queda su hash).
// Planes: esencial, pro, cadenas (ver src/planes.js). Un local nuevo sin --plan arranca con 30 días de prueba.
// --vence es la fecha hasta la que está pagado (sin --vence: sin vencimiento). El local lo recibe en unos minutos.
const { altaLocal, altaUsuario, asignarPlan } = require('./app');
const { listo, cerrar } = require('./db');
const { PLANES } = require('../src/planes');

function opciones(args) {
  const o = {};
  for (let i = 0; i < args.length; i++) if (args[i].startsWith('--')) o[args[i].slice(2)] = args[++i];
  return o;
}

const describir = p => `${PLANES[p.plan].nombre}${JSON.parse(p.extras).length ? ' + ' + JSON.parse(p.extras).join(', ') : ''}` +
  (p.vence ? `, vence el ${p.vence}` : ', sin vencimiento');

async function main() {
  const [accion, ...resto] = process.argv.slice(2);
  const o = opciones(resto);
  await listo;
  if (accion === 'local') {
    if (!o.cuenta || !o.nombre || !o.cliente) throw new Error('Faltan --cuenta, --nombre o --cliente');
    const r = await altaLocal(o);
    console.log(`Local "${o.nombre}" creado en la cuenta "${o.cuenta}" (plan ${describir(r)}).`);
    console.log('Agregá en el .env del local (y reiniciá Morfi):');
    console.log(`  NUBE_URL=<la dirección de esta nube, con https>`);
    console.log(`  NUBE_TOKEN=${r.token}`);
  } else if (accion === 'usuario' || accion === 'soporte') {
    if (!o.nombre || !o.email || !o.password) throw new Error('Faltan --nombre, --email o --password');
    await altaUsuario({ ...o, rol: accion === 'soporte' ? 'soporte' : 'duenio' });
    console.log(`Usuario ${o.email} creado.`);
  } else if (accion === 'plan') {
    if (!o.cliente || !o.plan) throw new Error('Faltan --cliente o --plan');
    const r = await asignarPlan(o);
    console.log(`Local "${o.cliente}": plan ${describir(r)}. El local lo recibe en la próxima sincronización (unos minutos).`);
  } else {
    throw new Error('Uso: node nube/alta.js local|usuario|soporte|plan --opciones (ver el comienzo de nube/alta.js)');
  }
}

main().then(cerrar, async e => { console.error(e.message); await cerrar(); process.exit(1); });
