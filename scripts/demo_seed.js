// demo_seed.js — seed completo para presentacion demo
const { login, get, post, put, del } = require('./seed-helpers');
const { PRODUCTOS, CLIENTES, USUARIOS } = require('./seed-data');

async function seed() {
  console.log('\n=== DEMO SEED — GastroManager ===\n');
  const T = await login();
  console.log('[OK] Login');

  // 1 — Config negocio
  await put(T, '/api/config', {
    nombre_negocio: 'La Buena Mesa',
    direccion: 'Av. Corrientes 1234, CABA',
    telefono: '11 4567-8900',
    email: 'contacto@labuenamese.com.ar',
    cuit: '20-12345678-9',
    tasa_iva: 21, moneda: 'ARS',
    tipo_negocio: 'restaurante_mediano',
    modulos_activos: ['pos','mesas','pedidos','delivery','cocina','productos','stock','proveedores','clientes','caja','reportes'],
    setup_completado: 1
  });
  console.log('[OK] Negocio: La Buena Mesa');

  // 2 — Limpiar productos viejos
  const viejos = await get(T, '/api/productos');
  if (Array.isArray(viejos) && viejos.length) {
    for (const p of viejos) await del(T, '/api/productos/' + p.id);
    console.log('[OK] Eliminados ' + viejos.length + ' productos anteriores');
  }

  // 3 — Crear productos. seed-data usa { precio, categoria, stock }; la API espera
  // { precio_venta, categoria_id, stock_actual } (antes quedaban en $0 y sin categoría).
  const CATEGORIAS = { Principales: 'Platos Principales' };
  const cats = await get(T, '/api/categorias');
  const idCategoria = async nombreSeed => {
    const nombre = /^(Vino|Botella vino|Cerveza)/i.test(nombreSeed.producto) ? 'Bebidas Alcohólicas'
      : (CATEGORIAS[nombreSeed.categoria] || nombreSeed.categoria);
    let cat = cats.find(c => c.nombre === nombre);
    if (!cat) {
      const r = await post(T, '/api/categorias', { nombre, orden: cats.length + 1 });
      cat = { id: r.id, nombre };
      cats.push(cat);
    }
    return cat.id;
  };
  const ids = {};
  for (const p of PRODUCTOS) {
    const r = await post(T, '/api/productos', {
      nombre: p.nombre,
      descripcion: p.descripcion || '',
      categoria_id: await idCategoria({ producto: p.nombre, categoria: p.categoria }),
      precio_venta: p.precio,
      tracking_stock: 1,
      stock_actual: p.stock,
      stock_minimo: Math.ceil(p.stock * 0.2),
      activo: p.activo
    });
    if (r && r.id) { ids[p.nombre] = r.id; process.stdout.write('.'); }
    else { process.stdout.write('x'); console.log(' WARN:', p.nombre, JSON.stringify(r)); }
  }
  console.log('\n[OK] ' + PRODUCTOS.length + ' productos creados');

  // 4 — Clientes
  for (const c of CLIENTES) {
    await post(T, '/api/clientes', c);
    process.stdout.write('.');
  }
  console.log('\n[OK] ' + CLIENTES.length + ' clientes creados');

  // 5 — Usuarios extra
  for (const u of USUARIOS) {
    const r = await post(T, '/api/usuarios', u);
    if (r && r.id) process.stdout.write('.');
    else process.stdout.write('x');
  }
  console.log('\n[OK] Usuarios: Lucas Mozo, Valeria Cocina, Roberto Caja');

  // 6 — Pedidos demo
  const i = ids; // alias corto

  // Mesa 1 — almuerzo de pareja
  await post(T, '/api/pedidos', { tipo: 'salon', mesa_id: 1, notas: '',
    items: [
      { producto_id: i['Bife de chorizo'],      cantidad: 2, precio_unitario: 9800, notas: 'Uno bien cocido' },
      { producto_id: i['Provoleta parrilla'],   cantidad: 1, precio_unitario: 3100, notas: '' },
      { producto_id: i['Vino por copa'],        cantidad: 3, precio_unitario: 2200, notas: '' },
      { producto_id: i['Agua mineral 500ml'],   cantidad: 2, precio_unitario:  800, notas: '' },
    ]
  });

  // Mesa 3 — grupo de 6
  await post(T, '/api/pedidos', { tipo: 'salon', mesa_id: 3, notas: 'Mesa de 6 personas',
    items: [
      { producto_id: i['Tabla de fiambres'],      cantidad: 1, precio_unitario: 4200, notas: '' },
      { producto_id: i['Empanadas x4'],           cantidad: 2, precio_unitario: 2800, notas: '' },
      { producto_id: i['Bondiola braseada'],      cantidad: 2, precio_unitario: 8400, notas: '' },
      { producto_id: i['Risotto de hongos'],      cantidad: 1, precio_unitario: 7800, notas: 'Sin parmesano' },
      { producto_id: i['Pollo a la portuguesa'],  cantidad: 1, precio_unitario: 7200, notas: '' },
      { producto_id: i['Botella vino tinto'],     cantidad: 1, precio_unitario: 7500, notas: '' },
      { producto_id: i['Cerveza artesanal pinta'],cantidad: 3, precio_unitario: 2400, notas: '' },
    ]
  });

  // Mesa 5 — con postre
  await post(T, '/api/pedidos', { tipo: 'salon', mesa_id: 5, notas: '',
    items: [
      { producto_id: i['Hamburguesa artesanal'], cantidad: 2, precio_unitario: 6200, notas: '' },
      { producto_id: i['Ensalada Cesar'],        cantidad: 1, precio_unitario: 4800, notas: '' },
      { producto_id: i['Lava cake chocolate'],   cantidad: 2, precio_unitario: 3200, notas: '' },
      { producto_id: i['Limonada artesanal'],    cantidad: 2, precio_unitario: 1400, notas: '' },
    ]
  });

  // Delivery — cliente registrado
  await post(T, '/api/pedidos', {
    tipo: 'delivery', notas: 'Timbre 3B - dejar en porteria si no hay respuesta',
    cliente_nombre: 'Maria Gonzalez', cliente_telefono: '11 5234-6789',
    direccion_entrega: 'Av. Santa Fe 2345, CABA',
    items: [
      { producto_id: i['Bondiola braseada'],  cantidad: 1, precio_unitario: 8400, notas: '' },
      { producto_id: i['Papas fritas'],       cantidad: 1, precio_unitario: 1800, notas: '' },
      { producto_id: i['Tiramisu casero'],    cantidad: 1, precio_unitario: 2900, notas: '' },
      { producto_id: i['Agua mineral 500ml'], cantidad: 2, precio_unitario:  800, notas: '' },
    ]
  });

  // Mostrador — para llevar
  await post(T, '/api/pedidos', { tipo: 'mostrador', notas: 'Para llevar',
    items: [
      { producto_id: i['Empanadas x4'], cantidad: 2, precio_unitario: 2800, notas: '' },
      { producto_id: i['Jugo natural'], cantidad: 1, precio_unitario: 1600, notas: '' },
    ]
  });

  console.log('[OK] 5 pedidos: Mesa 1, Mesa 3, Mesa 5, Delivery, Mostrador');

  console.log('\n=============================');
  console.log(' DEMO LISTA');
  console.log(' URL:   http://192.168.1.2:3000/');
  console.log(' Admin: admin@gastromanager.com / admin123');
  console.log(' Mozo:  lucas@labuenamese.com.ar / demo1234');
  console.log('=============================\n');
  process.exit(0);
}

seed().catch(e => { console.error('\n[ERROR]', e.message); process.exit(1); });
