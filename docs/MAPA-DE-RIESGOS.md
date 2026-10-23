# Mapa de riesgos de GastroManager

Qué partes se rompen más fácil, qué cambios las rompen y qué las protege hoy.
Actualizarlo cuando se toque una de estas partes o aparezca un bug nuevo.

## Cómo se protege el proyecto

| Protección | Dónde | Cuándo corre |
|---|---|---|
| Lint (errores reales, no estilo) | `eslint.config.js` → `npm run lint` | CI en cada push / PR |
| Nombres usados sin importar | `scripts/verificar-nombres.js` | CI y `npm test` |
| Tests de API, flujos, roles, seguridad, migraciones | `test/*.test.js` → `npm test` | CI (Linux y Windows) |
| Tests en navegador real | `test/e2e/` → `npm run test:e2e` | CI (Chrome en Linux, Edge en Windows) |
| El servidor arranca sobre una base nueva | paso "build" del CI | CI |
| Prueba de fuego (los tests detectan roturas) | `scripts/prueba-de-fuego.js` → `npm run prueba:fuego` | A mano, antes de una versión grande |
| Copia antes de migrar + migración en una transacción | `src/migraciones.js` (`migrarConRespaldo`) | Cada vez que arranca el servidor |
| Deploy de la demo solo con CI en verde | `render.yaml` (`autoDeployTrigger: checksPass`) | Render |
| Rutas de administrador decididas para la demo | `test/estructura.test.js` | CI |

**Prueba de fuego (9/10/2026):** 24 cambios a propósito en las partes críticas; antes de esta revisión
2 pasaban sin que ningún test fallara (cantidades negativas y descuento mayor al subtotal). Ya tienen su test.

## Partes frágiles

### 1. Cobro de pedidos — `src/servicios/pedidos.js` (`registrarPagoTx`) · riesgo ALTO
Pago, cierre del pedido, liberación de la mesa y descuento de stock son una sola transacción.
- **Lo rompe:** sacar el `AND estado = 'abierto'` del UPDATE (cobro doble), mover algo fuera de `transaccion()`,
  o hacer una llamada HTTP (Mercado Pago, AFIP, impresora) **dentro** de la transacción: bloquea a todos los demás.
- **Lo protege:** `pedidos.test.js`, `flujos.test.js`, `integraciones.test.js` (webhook idempotente).
- **Cobro en partes (`registrarCobroTx`):** un pedido puede tener pagos y seguir abierto (cuenta dividida). Lo que
  falta se calcula siempre como total − suma de `pagos` (`saldoPedido`), dentro de la transacción.
  **Lo rompe:** leer el saldo fuera de la transacción (dos cobros a la vez pagan de más), cancelar un pedido con
  pagos (plata en la caja sin venta) o un descuento que deje el total debajo de lo cobrado.
  **Lo protege:** `cobro-mesa.test.js`.
- **Factura en el cobro:** se emite después del COMMIT (`emitirFactura`, HTTP a AFIP). Si falla, el cobro no se deshace.
- **Mercado Pago · CORREGIDO (23/10/2026):** el webhook cerraba el pedido con cualquier pago aprobado, sin mirar el
  monto (un link viejo dejaba sin cobrar lo agregado después). Ahora entra como un cobro más (`registrarCobroTx`):
  nunca por más que el saldo, una sola vez por pago (`referencia = MP-<id>`), y si sobra o el pedido ya estaba
  cobrado queda una `alerta_mercadopago` en la auditoría para devolverle al cliente. Test en `integraciones.test.js`.
- **Propina:** es del personal. Suma al total cobrado, pero **no** se factura ni entra en ventas ni en el IVA débito
  (`facturacion.js`, `cobrosPorDia` en `contabilidad.js`); en el libro diario va a "Propinas a pagar al personal".
- **Importes en centavos:** `recalcularTotales` y `resolverItems` redondean (1,15 × 3 daba 3,4499999999999997 y
  así llegaba a ARCA). Test en `regresiones.test.js`.
- **Un pedido abierto por mesa:** `POST /api/pedidos` rechaza (409) una mesa con pedido abierto, y una mesa con
  pedido no se libera a mano ni al cancelar la reserva. Test en `regresiones.test.js`.

### Facturación AFIP — `src/servicios/facturacion.js` · riesgo MEDIO
- **Factura vigente** = factura A/B/C sin nota de crédito asociada (`comprobante_asociado_id`). La usan el control de
  duplicados, el botón *Facturar* y el ticket. **Lo rompe:** buscar "cualquier comprobante del pedido" (una nota de
  crédito bloquearía refacturar o saldría en el ticket).
- **Fecha del comprobante · CORREGIDO (22/10/2026):** usaba la hora del servidor; en Render (UTC) las facturas de
  después de las 21 h salían con la fecha de mañana. Ahora usa `fechaLocal()` (`ZONA_HORARIA`). Test en
  `afip.test.js` con servidores en UTC+14 y UTC-12.
- **Lo protege:** `afip.test.js` y el e2e, contra AfipSDK simulado.

### Facturas en espera (sin conexión) — `src/servicios/sin-conexion.js` · riesgo ALTO
- Sin conexión con ARCA (error de red, 5xx, 429) la factura queda en `facturas_pendientes` y se reintenta sola
  (al volver internet y cada 2 min). Si ARCA **contesta que no** (4xx, Resultado R) no se encola: lo ve una persona.
  **Lo rompe:** tratar como "falta de conexión" un error de validación (reintentaría para siempre) o al revés.
- **Duplicado por corte a mitad de camino:** si se corta después de pedir el CAE, ARCA pudo haberlo emitido. Se anota el
  número pedido (`numero_intentado`) y al reintentar `comprobanteYaEmitido` lo consulta (FECompConsultar): si existe con
  el mismo importe y receptor, se guarda ese en vez de pedir otro. **Lo rompe:** sacar esa consulta o no anotar el número.
- "Comprobante emitido y NO guardado" lleva `noReintentar`: nunca se encola.
- **Lo protege:** `sin-conexion.test.js` (ARCA caído, corte justo después de emitir, vuelta de internet, rechazo al
  reintentar). Probado que sin la recuperación el test falla.

### Fidelización — `src/servicios/fidelizacion.js` · riesgo ALTO (mueve plata)
- **Puntos:** el saldo (`clientes.puntos`) solo cambia con `moverPuntosTx` (deja movimiento). La pantalla de Clientes ya no
  edita puntos; los ajustes piden permiso `catalogo` y motivo. Se ganan en `cerrarPedidoTx` (consumo sin propina).
  **Lo rompe:** volver a permitir `puntos` en `PUT /api/clientes`.
- **Descuentos:** puntos y cupón van en `descuento_puntos` / `descuento_cupon`; `recalcularTotales` los resta y nunca deja el
  consumo bajo cero. Cancelar el pedido devuelve los puntos y libera el cupón (`revertirFidelizacionTx`).
- **Gift cards:** el saldo se descuenta con `UPDATE … WHERE saldo >= monto` dentro de la transacción del cobro: dos cajas a la
  vez no la usan de más. Venderla es deuda (2.1.04), usarla es venta. **Lo rompe:** registrar la venta de la gift card como venta.
- **Ciclo de módulos:** `pedidos.js` carga `fidelizacion.js` dentro de las funciones (fidelizacion.js usa pedidos.js).
- **Lo protege:** `fidelizacion.test.js` y el e2e.

### Personal y propinas — `src/servicios/personal.js` · riesgo MEDIO
- **Reparto de propinas:** el total sale de los pagos (mismo cálculo que contabilidad) y los montos los calcula el servidor;
  `repartirCentavos` hace que la suma dé exacto. Un período no se reparte dos veces (salvo anulando el reparto).
  **Lo rompe:** guardar montos que manda el navegador o cambiar la fórmula de propinas en un solo lado.
- **Pago de propinas:** en efectivo es un egreso de la caja vinculado al reparto; en el libro diario cancela "Propinas a
  pagar al personal" y **no** es gasto. **Lo rompe:** sacar la exclusión de `movimientosCajaSueltos` (se contaría dos veces).
- **Fichadas:** no se cargan horarios futuros (una salida a futuro bloqueaba fichar). El doble toque en el mismo minuto no hace nada.
- **Lo protege:** `personal.test.js` y el e2e.

### Pago desde la mesa — `src/servicios/pago-mesa.js` · riesgo ALTO
- El pago se acredita **solo** consultando la API de Mercado Pago (webhook o `/verificar` al volver); se controla que el
  `external_reference` sea `<pedido>-T<intento>` de esa mesa. Idempotente por `MP-<payment_id>`.
  **Lo rompe:** aceptar datos del pago que manda el celular. **Lo protege:** `pago-mesa.test.js` y el e2e.

### 2. Precios — `resolverItems` y la carta online (`src/rutas/publico.js`) · riesgo ALTO
El precio siempre sale de la base, nunca del navegador.
- **Carta online · CORREGIDO (23/10/2026):** ahora usa `resolverItems`, con topes (30 ítems, 50 unidades por
  producto) y sin productos de precio 0. Antes un script podía mandar a imprimir 999.999.999 unidades.
- **Lo protege:** `pedidos.test.js` (precio de la base), `flujos.test.js` (carta online), prueba de fuego.

### 3. Arqueo de caja — `src/rutas/caja.js` (`resumenCaja`) · riesgo ALTO
Las ventas del turno se buscan por **rango de fechas** de `pagos.fecha` entre apertura y cierre, no por caja.
- **Lo rompe:** cambiar el formato de fecha de `pagos` o de `caja` (texto UTC de SQLite), permitir dos cajas abiertas,
  o registrar cobros con otra hora.
- **Lo protege:** `caja.test.js` (esperado, diferencia, una sola caja abierta), `contabilidad.test.js`.

### 4. Permisos — `src/permisos.js` + `requiere()` en cada ruta · riesgo ALTO
- **Lo rompe:** una ruta nueva sin `autenticar` o sin `requiere(...)`, o agregar un permiso a un rol sin querer.
- **Lo protege:** `roles.test.js`, `estructura.test.js` (rutas sin sesión), e2e (menú por rol).
- **Ojo:** una ruta con `autenticar` pero **sin** `requiere(...)` queda abierta a cualquier rol y ningún test lo avisa.

### 5. Migraciones — `src/migraciones.js` · riesgo MEDIO
Corren al iniciar, en una transacción, con copia previa si el archivo cambió.
- **Lo rompe:** agregar una columna `NOT NULL` sin `DEFAULT`, borrar o renombrar columnas (SQLite no lo hace en todas
  las versiones), o poner `PRAGMA journal_mode` / `VACUUM` dentro (no se pueden en una transacción).
- **Marcha atrás:** detener el servidor, reemplazar `data/gastromanager.db` por la copia `backups/` más reciente
  anterior a la actualización (borrar `-wal` y `-shm`) e iniciar la versión anterior del código. Probado en `migraciones.test.js`.

### 6. Base y transacciones — `src/db.js` · riesgo MEDIO
Dos conexiones: una compartida (lecturas) y una para transacciones en cola (de a una).
- **Lo rompe:** usar `db` directo dentro de una transacción (queda fuera de ella), o `VACUUM` en la conexión compartida
  (fallaba con consultas en curso; las copias ahora usan conexión propia).
- **Bug encontrado y corregido:** al iniciar, las transacciones podían arrancar antes de activar el modo WAL y el
  servidor se caía (“cannot change into wal mode from within a transaction”). Ahora esperan a `listo`.

### 7. Frontend sin build — `public/js/*.js` · riesgo MEDIO
Los archivos comparten funciones globales (`API`, `App`, `fmtFecha`...). Renombrar una en `api.js` rompe otras
pantallas en silencio; no hay tipos ni lint de nombres en el frontend.
- **Lo protege:** e2e (sin errores de JavaScript en las pantallas que recorre). Las pantallas que el e2e no recorre
  (contabilidad, reportes, stock, proveedores, delivery) no tienen red.
- Se encontró y borró un método `togglePlataforma` duplicado en `config.js`.
- **Doble envío:** las acciones que crean algo (confirmar pedido, agregar ítem, movimientos de caja y stock, pagar
  un gasto) pasan por `App.sinDobleEnvio`. Una acción nueva de ese tipo tiene que usarlo. Test e2e.
- **Service worker (`sw.js`):** primero la red; la caché solo sin conexión. Volver a cache-first deja a los celulares
  con el JS viejo después de cada actualización. Test en `estructura.test.js`.
- **Cocina:** "LISTO" guarda `pedidos.listo_en` y la comanda sale de la pantalla; agregar un ítem la vuelve a mostrar.

### 8. Demo pública — `src/demo.js` · riesgo MEDIO
Con usuarios y claves conocidos en internet. Lo peligroso se bloquea por lista.
- **Antes dependía de acordarse:** una ruta nueva de administrador no se bloqueaba sola. Ahora
  `estructura.test.js` falla hasta que se la bloquee o se la declare segura.
- **CORREGIDO (23/10/2026):** Express no distingue mayúsculas y la lista sí: `/API/Usuarios` se salteaba el bloqueo.
  Ahora se compara en minúsculas. Test en `demo.test.js`.

### 9. Número de pedido — `generarNumeroPedido` · CORREGIDO (13/10/2026)
Usaba la hora del servidor: en Render (UTC) los pedidos de después de las 21 h salían con la fecha de mañana.
Ahora usa `ZONA_HORARIA`. Test en `regresiones.test.js` con servidores en UTC+14 y UTC-12.

### 9b. "Hoy" en el navegador — `hoyLocal()` en `public/js/api.js` · CORREGIDO (22/10/2026)
Usaba la zona horaria **del dispositivo** y el servidor filtra con `ZONA_HORARIA`: en un dispositivo con otra zona
(o en el CI, en UTC), después de las 21 h de Argentina la lista de Pedidos salía vacía. Ahora la sesión trae
`zona_horaria` y `hoyLocal()` la usa. Test e2e con navegadores en UTC+14 y UTC-12. **Lo rompe:** volver a armar la
fecha con `new Date()` en el navegador (ojo con `toISOString().slice(0, 10)`, que además es UTC).

### 9c. WhatsApp — `src/servicios/whatsapp.js` · riesgo MEDIO
Manda mensajes a teléfonos reales.
- **Lo rompe:** enviar desde dentro de `transaccion()` (HTTP a Meta), sacar el control de "una sola vez" (`unico`,
  por `motivo` + `referencia`) de los avisos automáticos, aceptar el webhook sin firma, o una ruta nueva bajo
  `/api/whatsapp/` sin bloquear en la demo (hoy se bloquea todo POST ahí, salvo que se cambie `src/demo.js`).
- **Recordatorios:** comparan `fecha || ' ' || hora` de la reserva (texto en hora del negocio) con la hora local
  calculada con `offsetZonaMin()`. Cambiar el formato de fecha u hora de las reservas los rompe.
- **Lo protege:** `whatsapp.test.js` (API de Meta simulada), `estructura.test.js` (rutas públicas), e2e.

### 9d. Recetas — `src/servicios/recetas.js` · riesgo MEDIO
El descuento de stock del cobro pasa por `descontarStockItemTx` (dentro de la transacción del cobro).
- **Lo rompe:** descontar fuera de `cerrarPedidoTx` (con cuenta dividida se descontaría en cada parte), permitir
  recetas anidadas (ciclos), o editar `productos.costo` de un plato con receta sin recalcular.
- **Ojo:** el costo teórico de Contabilidad usa el costo *actual* de cada producto, no el del día de la venta.
- **Lo protege:** `recetas.test.js`, e2e.

### 9e. PIN de autorización y arqueo ciego — `src/servicios/autorizacion.js` · riesgo ALTO
- **Lo rompe:** una acción sensible nueva sin `requiereAutorizacion`/`autorizar`, mostrar `efectivo_esperado` o
  `diferencia` al cajero con arqueo ciego (`resumenParaUsuario` en `caja.js`), o guardar el PIN sin hash.
- **Bloqueo por intentos:** en memoria (se reinicia con el servidor). Con PIN de 4 dígitos, 5 intentos cada 5 minutos.
  El intento se cuenta **antes** de comparar (si no, muchos pedidos en paralelo pasaban todos antes del primer fallo),
  y elegir PIN ("ya lo usa otra persona") cuenta igual. Test en `control-caja.test.js`.
- **Lo protege:** `control-caja.test.js` y e2e (PIN encima del formulario, caja ciega).

### 10. Copias de seguridad — `src/servicios/backups.js` · riesgo BAJO
- **Bugs corregidos:** dos copias en el mismo segundo daban error 500 (nombre repetido); una copia con el sistema en
  uso podía fallar. Tests en `fechas-backups.test.js` y `regresiones.test.js`.
- Con `BACKUP_S3_*` cada copia se sube a la nube (R2 / Backblaze B2 / S3), **cifrada** si hay `BACKUP_CLAVE`
  (AES-256-GCM; la base lleva el certificado de ARCA y los tokens). Sin la clave no se restaura: el instalador la
  muestra para guardarla fuera del local. En producción, sin copia en la nube `/api/salud` da 503 y el Dashboard del
  administrador lo muestra (salvo `BACKUP_SOLO_LOCAL=1`). Test en `nube-monitoreo.test.js`.
- **Restaurar:** `scripts/restaurar.js` (local o `--nube`). Se niega con el servidor andando, verifica la copia
  (`integrity_check` y tablas) antes de tocar nada y guarda la base actual. Test en `restaurar.test.js`.

### 11. Actualizador — `scripts/actualizar.js` · riesgo ALTO
- **Lo rompe:** correr `npm ci` con el servidor andando (en Windows el `.node` de sqlite3 está en uso y npm falla a
  la mitad) o dejar un paso después del `merge` fuera del `try` (sin vuelta atrás: código nuevo con dependencias a
  medio instalar). **Lo protege:** `actualizar.test.js` (falla simulada de npm → vuelve a la versión anterior).
- La parte real de npm y pm2 solo se prueba en una PC con Windows: probar el instalador y una actualización con
  cambio de dependencias en una VM limpia antes del primer cliente.

## Lo que todavía depende de que nadie se equivoque

- **Arranque como SYSTEM con `PM2_HOME` compartido** (`instalar.ps1`): no lo cubre ningún test automático. Probarlo en
  una VM limpia (reiniciar sin iniciar sesión y abrir `/api/salud` desde otro equipo; `pm2 list` desde un
  administrador tiene que mostrar el proceso).
- **Contraseñas viejas en texto plano:** el login todavía las acepta y las convierte a hash. Se puede quitar cuando
  ninguna instalación tenga usuarios de antes de 2026-09.
- **Validación en los bordes:** cada ruta valida a mano; no hay un esquema compartido entre frontend y backend.
  `public/js/api.js` es el único cliente de la API: cualquier cambio de nombres de campos se hace en los dos lados.
- **Tipado:** es JavaScript sin tipos. Un siguiente paso barato es `// @ts-check` + JSDoc en `src/servicios/`.
- **Borrar `data/.secret_key`** cierra la sesión de todos (se genera una nueva).
- **Impresión USB** solo se prueba de verdad en Windows con la impresora instalada.

## Lo que hay que configurar a mano

1. **Proteger `main` en GitHub:** Settings → Branches → Add rule → `main` → *Require a pull request* +
   *Require status checks to pass* (elegir los jobs de **CI**) → *Do not allow bypassing*.
2. **Render:** si el servicio ya existía, en Settings → Build & Deploy → Auto-Deploy elegir *After CI Checks Pass*
   (el `render.yaml` lo pide para servicios nuevos).
3. **Copias fuera de la PC del local:** configurar `BACKUP_S3_*` en el `.env` de cada local (docs/INSTALACION.md).
