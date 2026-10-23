# Morfi

Sistema de gestión gastronómica: POS, mesas, comandas de cocina, delivery, stock, caja con arqueo, contabilidad,
reportes y facturación electrónica (AFIP/ARCA), con integraciones de Mercado Pago y Tienda Nube.

## Requisitos

- Node.js 22 o superior (Node 20 ya no tiene soporte)
- Windows, Linux o macOS (la base es SQLite, no requiere servidor de base de datos)

## Instalación

```bash
npm install
npm run init-db     # crea data/morfi.db con datos iniciales
npm start           # http://localhost:3000
```

Usuario inicial: `admin@morfi.local` / `admin123`. El sistema obliga a cambiar la contraseña en el primer ingreso.

### Usuario de prueba

```bash
npm run usuario:prueba
# → prueba@morfi.local / Prueba2026!  (administrador, entra sin cambiar la clave)
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

Se definen en el entorno o en un archivo `.env` en la carpeta del sistema (una `CLAVE=valor` por línea; lo crea el instalador).
Para instalar en un restaurante: **[docs/INSTALACION.md](docs/INSTALACION.md)** (instalador de Windows, copias en la nube, monitoreo, acceso remoto y actualizaciones).

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
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_KEY_ID`, `BACKUP_S3_SECRET`, `BACKUP_S3_PREFIJO` | Sube cada copia a un bucket S3 / Backblaze B2 (fuera del local) | — |
| `MONITOREO_URL`, `MONITOREO_MINUTOS` | Latido a un servicio de monitoreo (healthchecks.io); `/fail` si hay un problema | — , `5` |

## Roles de usuario

| Rol | Puede |
|---|---|
| Administrador | Todo, incluida la contabilidad, usuarios, configuración, integraciones, impresoras y copias de seguridad |
| Encargado | Toda la operación, carta (productos, mesas, promociones, proveedores), historial de caja, rentabilidad y contabilidad |
| Cajero | Tomar pedidos, cobrar, descuentos, cancelar, caja, delivery, clientes, stock y reportes de ventas |
| Mozo | Tomar pedidos, agregar ítems, mesas, reservas y precuenta (no descuenta, no cancela, no ve ventas). Cobra y factura sus mesas solo si se activa *Cobro en la mesa* |
| Cocina | Pantalla de cocina y consulta de stock |

Los permisos se controlan en el servidor en cada acción (`src/permisos.js`); el menú muestra solo lo permitido.
Siempre tiene que quedar al menos un administrador activo.

## Cobro en la mesa

Botón **Cobrar** del pedido (caja o celular del mozo): cobro, propina, cuenta dividida y factura AFIP/ARCA en un paso
(`POST /api/pedidos/:id/cobro`).

- **Dividir la cuenta:** en partes iguales o por montos; cada parte se registra como un pago. La mesa sigue abierta
  hasta cubrir el total; ahí se cierra, se libera la mesa y se descuenta el stock (una sola vez).
- **Varios medios en un cobro:** efectivo (con vuelto) + tarjeta, etc. El pedido queda con `metodo_pago = 'mixto'`.
- **Factura:** si AFIP está conectada, se emite al completar el total. Si AFIP falla, el cobro queda hecho y se
  reintenta desde el pedido.
- **QR de Mercado Pago:** muestra en pantalla el link de pago por lo que falta; el webhook cierra la cuenta solo.
- **Comprobante por WhatsApp** al cliente, desde el celular del mozo.
- **Mozos:** Configuración → *Cobro en la mesa*. Apagado por defecto. Solo pedidos de mesa (no mostrador ni delivery)
  y sin descuentos ni cancelaciones.
- Con una parte cobrada el pedido no se cancela y un descuento no puede dejar el total por debajo de lo cobrado.

## Facturación electrónica (AFIP/ARCA)

Se configura en **Integraciones → AFIP** (CUIT, punto de venta, alícuota y Access Token de AfipSDK).

- **Factura A, B o C** desde el pedido cobrado o en el mismo cobro. Se guardan el receptor (CUIT, razón social,
  condición de IVA) y los importes neto e IVA.
- **Padrón de ARCA:** al cargar el CUIT de una Factura A se traen la razón social y la condición de IVA
  (responsable inscripto, monotributo, exento...). La factura sale con esa condición y avisa si le corresponde B.
  Requiere habilitar el servicio *ws_sr_constancia_inscripcion* para la CUIT del local en ARCA.
  Las consultas se guardan 12 horas en memoria.
- **Nota de crédito:** *Anular con nota de crédito* en el comprobante del pedido (cajero, encargado, admin).
  Va por el total, asociada a la factura, con motivo y auditoría. Después el pedido se puede volver a facturar.
  No cambia el cobro: si se devuelve plata, se registra como egreso de caja.
- **Tests:** `afip.test.js` y el e2e prueban todo contra un AfipSDK simulado (`test/afip-simulado.js`,
  variable `GM_AFIP_API_URL`); nunca se conectan a ARCA.

## WhatsApp Business

API oficial de Meta (*Cloud API*). Se configura en **Integraciones → WhatsApp Business**: identificador del número,
token permanente, secreto de la app y token de verificación del webhook.

- **Comprobante:** botón *WhatsApp* en el pedido cobrado y al terminar el cobro en la mesa. Sin WhatsApp Business
  conectado, abre WhatsApp en el dispositivo con el texto listo (como antes).
- **Pedido listo / en camino:** al marcar *listo* en cocina un pedido para llevar, o *en camino* un delivery, se avisa
  al teléfono del pedido. Una sola vez por pedido. Se activa con *Avisos de pedidos*.
- **Recordatorio de reservas:** cada 5 minutos se buscan reservas confirmadas que empiezan dentro de las próximas
  N horas (hora del negocio) y se manda un recordatorio a cada una, una sola vez.
- **Plantillas:** Meta solo deja iniciar conversaciones con plantillas aprobadas. Crear en WhatsApp Manager (categoría
  Utilidad, idioma `es_AR`) las tres que muestra la pantalla, con esas variables. Los nombres se pueden cambiar.
- **Webhook:** `https://<BASE_URL>/api/whatsapp/webhook`. Verifica la firma de Meta (`X-Hub-Signature-256` con el
  secreto de la app); sin secreto no acepta nada. Registra entregado / leído y los mensajes de los clientes.
- **Teléfonos:** se aceptan como los escribe la gente (`011 15-1234-5678`, `+54 9 11...`) y se pasan a `549...`.
- Todo envío queda en `whatsapp_mensajes` (con error si falló). En la demo pública no se envía nada.

## Recetas e insumos

Botón **Receta** en cada producto (Productos): ingredientes con la cantidad en su unidad (ej. 0.15 kg de carne).

- Al cobrar un plato con receta se descuenta el stock de sus ingredientes (no el del plato). Sin receta, el producto
  descuenta su propio stock como siempre. Con la cuenta dividida, se descuenta una sola vez, al cerrar.
- El **costo del plato** es la suma de sus ingredientes y se actualiza solo cuando cambia el costo de un ingrediente.
  Lo usan la rentabilidad (Reportes) y el costo teórico del estado de resultados (Contabilidad).
- Sin recetas anidadas: un plato con receta no puede ser ingrediente, y un ingrediente no puede tener receta.

## Control de caja: PIN y arqueo ciego

En **Configuración** (los dos apagados por defecto):

- **PIN de autorización:** descuentos (también al crear el pedido), cancelar pedidos, anular facturas y egresos de caja
  de cajeros y mozos necesitan el PIN de un encargado o administrador. Con el PIN, un mozo también puede hacerlas.
  Cada encargado define su PIN en **Mi PIN** (con su contraseña; 4 a 6 números, distinto al de los demás).
  Cada autorización queda en la auditoría. 5 PIN incorrectos seguidos bloquean a ese usuario 5 minutos.
- **Arqueo ciego:** el cajero no ve ventas por medio de pago, efectivo esperado ni diferencia; cuenta y declara.
  El encargado ve el arqueo completo en el historial de caja.

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
- Con `BACKUP_S3_*` cada copia se sube a la nube, cifrada con `BACKUP_CLAVE` (ver `docs/INSTALACION.md`).
- **Restaurar:** `pm2 stop morfi`, `npm run restaurar -- --listar` y `npm run restaurar -- <copia>`
  (o `--nube <copia>`), y `pm2 start morfi`. Verifica la copia y guarda la base actual antes de reemplazarla.
- La base usa modo WAL: no copiar `morfi.db` a mano con el servidor en marcha; usar las copias del sistema.

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
npm run actualizar    # baja la última versión de main con copia previa y vuelta atrás automática
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
| `cobro-mesa.test.js` | Cuenta dividida, pagos mixtos, sin cobrar de más (también en simultáneo), propina, factura que falla sin perder el cobro, mozos y arqueo |
| `afip.test.js` | Facturas, notas de crédito asociadas y refacturar, padrón (RI, monotributo, consumidor final), CUIT inválido, rechazo de ARCA y permisos, contra AfipSDK simulado |
| `whatsapp.test.js` | Teléfonos, comprobante, rechazo de Meta, avisos de pedido sin repetir, recordatorios de reservas, webhook firmado y estados en orden, permisos, contra API de Meta simulada |
| `recetas.test.js` | Costo por receta y margen, descuento de ingredientes al cobrar (una vez con cuenta dividida), costo que sigue al ingrediente, validaciones, costo teórico |
| `control-caja.test.js` | PIN (alta, unicidad, bloqueo por intentos), autorización de descuentos, cancelaciones, egresos y anulaciones, arqueo ciego |
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
| `nube-monitoreo.test.js` | Firma SigV4 (vector oficial de AWS), subida de copias a S3, `/api/salud` y latido |
| `actualizar.test.js` | Actualización: copia previa, solo avance rápido, nunca pisa cambios locales |
| `usuario-prueba.test.js` | `npm run usuario:prueba`: ingreso directo, sin duplicados, roles y validaciones |
| `e2e/navegador.test.js` | Login, cambio de contraseña, menú por rol, venta completa por pantalla, XSS, impresoras |
