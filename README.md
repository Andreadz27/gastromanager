# GastroManager

Sistema de gestión gastronómica: POS, mesas, comandas de cocina, delivery, stock, caja con arqueo, contabilidad,
reportes y facturación electrónica (AFIP/ARCA), con integraciones de Mercado Pago y Tienda Nube.

## Requisitos

- Node.js 22 o superior (Node 20 ya no tiene soporte)
- Windows, Linux o macOS (la base es SQLite, no requiere servidor de base de datos)

## Instalación

```bash
npm install
npm run init-db     # crea data/gastromanager.db con datos iniciales
npm start           # http://localhost:3000
```

Usuario inicial: `admin@gastromanager.com` / `admin123`. El sistema obliga a cambiar la contraseña en el primer ingreso.

### Usuario de prueba

```bash
npm run usuario:prueba
# → prueba@gastromanager.com / Prueba2026!  (administrador, entra sin cambiar la clave)
npm run usuario:prueba -- --email qa@miresto.com --clave OtraClave123 --rol cajero --nombre "QA Caja"
```

Se puede correr con el servidor andando. Si el usuario ya existe, lo reactiva y le vuelve a poner la clave.
Usa la base de `GM_DATA_DIR` (por defecto `data/`). En una instalación de un cliente, desactivarlo al terminar
(Configuración → Usuarios).

En producción se usa PM2 (`ecosystem.config.js`):

```bash
pm2 start ecosystem.config.js --env production
pm2 save
```

## Configuración (variables de entorno)

| Variable | Para qué sirve | Por defecto |
|---|---|---|
| `PORT` | Puerto HTTP | `3000` |
| `GM_DATA_DIR` | Carpeta de datos (base, clave de sesión, copias) | `./data` |
| `SECRET_KEY` | Clave para firmar sesiones | Se genera sola en `data/.secret_key` |
| `ZONA_HORARIA` | Zona horaria del negocio para reportes | `America/Argentina/Buenos_Aires` |
| `BASE_URL` | URL pública HTTPS (necesaria para webhooks de Mercado Pago y Tienda Nube) | — |
| `CORS_ORIGINS` | Orígenes permitidos, separados por coma | `*` |
| `TRUST_PROXY` | Proxies de confianza (nginx, cloudflared) | `loopback` |
| `BACKUPS_CONSERVAR` | Cantidad de copias automáticas a conservar | `30` |
| `BACKUP_COPIA_DIR` | Carpeta extra para duplicar cada copia (ej. Google Drive / OneDrive) | — |

## Roles de usuario

| Rol | Puede |
|---|---|
| Administrador | Todo, incluida la contabilidad, usuarios, configuración, integraciones, impresoras y copias de seguridad |
| Encargado | Toda la operación, carta (productos, mesas, promociones, proveedores), historial de caja, rentabilidad y contabilidad |
| Cajero | Tomar pedidos, cobrar, descuentos, cancelar, caja, delivery, clientes, stock y reportes de ventas |
| Mozo | Tomar pedidos, agregar ítems, mesas, reservas y precuenta (no cobra, no descuenta, no cancela, no ve ventas) |
| Cocina | Pantalla de cocina y consulta de stock |

Los permisos se controlan en el servidor en cada acción (`src/permisos.js`); el menú muestra solo lo permitido.
Siempre tiene que quedar al menos un administrador activo.

## Contabilidad

Menú **Contabilidad** (administrador y encargado). Las ventas salen de los cobros: solo se cargan compras y gastos.

- **Gastos y compras:** fecha, categoría (mercadería, sueldos, alquiler, servicios, impuestos, comisiones,
  mantenimiento, publicidad, otros), proveedor y comprobante. Solo la factura A discrimina IVA; el total es
  neto + IVA + percepciones. Se cargan como pagados o a pagar con vencimiento.
- **Cuentas a pagar:** deudas por vencimiento y por proveedor. Al pagar en efectivo se puede sacar de la caja
  abierta: queda como egreso en el arqueo y no se cuenta dos veces.
- **Estado de resultados:** ventas netas de IVA − mercadería − gastos operativos (incluidos los egresos de caja
  sin comprobante). Compara el costo de mercadería real con el teórico (costo cargado en cada plato).
- **IVA del mes:** débito sobre lo cobrado con la tasa de Configuración, crédito de las facturas A. Con tasa 0
  (monotributo) no hay débito y los gastos se toman por su total.
- **Libro diario y sumas y saldos:** asientos en partida doble generados en cada consulta a partir de cobros,
  gastos y movimientos de caja (no se guardan, así siempre reflejan las correcciones). Exportables a Excel.
- Los gastos no se borran: se anulan y queda en la auditoría.

## Demo pública

`npm run demo:publica` sirve La Buena Mesa en `PORT` para que cualquiera la pruebe desde internet
(`render.yaml` la despliega en Render: New → Blueprint → este repositorio). Usa una carpeta temporal, nunca `data/`.

- La pantalla de ingreso muestra los usuarios de cada rol (clave `demo1234`).
- Los datos se regeneran cada `GM_DEMO_REINICIO_HORAS` horas (6 por defecto) sin cortar el servicio.
- Con `GM_DEMO=1` (lo pone el script) se bloquean usuarios y contraseñas, impresoras, integraciones,
  webhooks de pago y copias de seguridad, y la impresión se simula: con claves públicas nadie puede dejar
  afuera a los demás ni hacer que el servidor se conecte a otras direcciones (`src/demo.js`).

## Impresoras térmicas (comandas y tickets)

Se configuran en **Configuración → Impresoras térmicas**. Papel de 58 u 80 mm, comandos ESC/POS
(Epson TM y compatibles: Xprinter, 3nStar, Gadnic, Hasar, etc.).

- **Red (Ethernet/WiFi):** IP de la impresora, puerto 9100 por defecto (`192.168.0.50` o `192.168.0.50:9100`).
  Conviene fijarle la IP en el router para que no cambie.
- **USB:** la impresora tiene que estar instalada en Windows en la computadora donde corre el servidor
  (con el driver del fabricante o como "Generic / Text Only"). Se imprime en modo RAW. En Linux/Mac se usa `lp`.
- **Estaciones:** cada impresora de comandas puede filtrar por categorías (ej. Barra = Bebidas, Cocina = el resto).
- **Automático:** con "Impresión automática de comandas" activada, al crear un pedido sale la COMANDA; al agregar
  ítems, un AGREGADO; al cancelar, un ANULADO. Opcional: ticket al cobrar y apertura del cajón en pagos en efectivo.
- Si una impresora falla, aparece un aviso en todas las pantallas y queda en el registro; desde el pedido se puede
  reimprimir la comanda o el ticket. Sin impresoras configuradas se usa la impresión del navegador.

## Copias de seguridad

- Copia automática al iniciar y cada 24 horas en `data/backups/`.
- Desde **Configuración → Copias de seguridad** se crea una copia manual y se descarga.
- **Restaurar:** detener el servidor, reemplazar `data/gastromanager.db` por la copia (y borrar
  `gastromanager.db-wal` y `gastromanager.db-shm` si existen) y volver a iniciarlo.
- La base usa modo WAL: no copiar `gastromanager.db` a mano con el servidor en marcha; usar las copias del sistema.

## Actualizaciones y migraciones

Los cambios de esquema están en `src/migraciones.js` y se aplican solos al iniciar:

- Si hay migraciones nuevas, **antes** se hace una copia en `data/backups/` (es la marcha atrás).
- Todas corren en **una transacción**: si una falla, el servidor no arranca y la base queda como estaba.
- **Volver atrás:** detener el servidor, restaurar esa copia (ver arriba) e iniciar la versión anterior del código.
  Probado en `test/migraciones.test.js`.

## Estructura

```
server.js              Punto de entrada: migra la base, Socket.IO y servidor HTTP
init-db.js             Crea la base con datos iniciales (idempotente)
src/
  app.js               Express: seguridad (helmet/CSP, CORS), estáticos, rutas y 404
  config.js            Variables de entorno, clave de sesión
  db.js                SQLite (WAL), run/get/all y transacciones
  migraciones.js       Cambios de esquema que se aplican al iniciar
  auth.js              Sesiones JWT, roles
  realtime.js          Socket.IO (eventos emitidos después de cada COMMIT)
  tiempo.js            Zona horaria del negocio
  util.js              Errores HTTP y helpers
  rutas/               Un módulo por área (pedidos, caja, delivery, integraciones...)
  servicios/           Lógica compartida (cobros, integraciones, copias de seguridad)
public/                Frontend (HTML/CSS/JS sin build)
scripts/               Scripts de datos de demostración y mantenimiento
test/                  Tests de integración (npm test)
```

## Tests

```bash
npm test          # API, flujos, integraciones simuladas y chequeos de código (~10 s)
npm run test:e2e  # en un navegador real: Edge en Windows, Chrome en Linux/Mac (~20 s)
npm run test:todo # ambos
npm run lint      # errores reales de código (ESLint)
npm run check     # lint + nombres sin importar + tests: correrlo antes de cada commit
npm run prueba:fuego  # rompe a propósito cada parte crítica y comprueba que algún test falla (~5-10 min)
```

**CI:** `.github/workflows/ci.yml` corre lint, tests, tests en navegador y un arranque del servidor en Linux
(Node 22 y 24) y en Windows, en cada push y pull request. La demo de Render solo se despliega si el CI pasó.
Las partes frágiles y qué las rompe están en `docs/MAPA-DE-RIESGOS.md`.

Cada archivo de test levanta el servidor real sobre una base nueva en una carpeta temporal (no toca `data/`).
Mercado Pago, Tienda Nube y las impresoras se prueban contra servidores simulados; AFIP solo en sus validaciones.

| Archivo | Qué valida |
|---|---|
| `flujos.test.js` | Un turno completo (caja, mesa, cocina, cobro, reportes), reservas, carta online, delivery, ABM y configuración |
| `pedidos.test.js` | Precios desde la base, transacciones, concurrencia, cobros sin duplicar, stock |
| `caja.test.js` | Arqueo: ventas por medio de pago, movimientos, efectivo esperado y diferencias |
| `contabilidad.test.js` | Gastos, pagos desde la caja, estado de resultados, IVA, libro diario balanceado, anulaciones |
| `demo.test.js` | Modo demo pública: acciones bloqueadas y el resto del sistema funcionando |
| `roles.test.js` | Qué puede y qué no puede hacer cada rol |
| `seguridad.test.js` | Sesiones, límites de login, Socket.IO, secretos, webhooks, CSP |
| `integraciones.test.js` | Mercado Pago (link y webhook) y Tienda Nube (sync y webhook) contra APIs simuladas |
| `impresion.test.js` | Comandas por estación, agregados, anulaciones, tickets y cajón (impresoras simuladas) |
| `productos.test.js`, `fechas-backups.test.js` | Validaciones, ediciones parciales, zona horaria y copias de seguridad |
| `estructura.test.js` | Imports faltantes, rutas sin sesión, credenciales en el frontend, rutas de admin decididas para la demo |
| `migraciones.test.js` | Migración fallida sin cambios a medias, copia previa y restauración (rollback) |
| `regresiones.test.js` | Bugs que ya pasaron: configuración parcial, edición de productos, copia con el sistema en uso |
| `usuario-prueba.test.js` | `npm run usuario:prueba`: ingreso directo, sin duplicados, roles y validaciones |
| `e2e/navegador.test.js` | Login, cambio de contraseña, menú por rol, venta completa por pantalla, XSS, impresoras |
