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

### 2. Precios — `resolverItems` y la carta online (`src/rutas/publico.js`) · riesgo ALTO
El precio siempre sale de la base, nunca del navegador.
- **Lógica duplicada:** la carta online (pedido del cliente por QR) resuelve ítems por su cuenta en vez de usar
  `resolverItems`. Las reglas ya difieren: allá una cantidad negativa se convierte en 1 y no hay tope de 1000.
  Unificarlo cambia lo que ve el cliente → pendiente de decisión.
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

### 8. Demo pública — `src/demo.js` · riesgo MEDIO
Con usuarios y claves conocidos en internet. Lo peligroso se bloquea por lista.
- **Antes dependía de acordarse:** una ruta nueva de administrador no se bloqueaba sola. Ahora
  `estructura.test.js` falla hasta que se la bloquee o se la declare segura.

### 9. Número de pedido — `generarNumeroPedido` · riesgo BAJO (bug posible)
La fecha del número (`P-AAAAMMDD-…`) usa la hora del **servidor**, no `ZONA_HORARIA`. En Windows en Argentina da
igual; en Render (UTC) los pedidos después de las 21 h salen con la fecha de mañana. Cambia lo que ve el usuario
→ pendiente de decisión.

### 10. Copias de seguridad — `src/servicios/backups.js` · riesgo BAJO
- **Bugs corregidos:** dos copias en el mismo segundo daban error 500 (nombre repetido); una copia con el sistema en
  uso podía fallar. Tests en `fechas-backups.test.js` y `regresiones.test.js`.
- Las copias quedan en la misma computadora salvo que se configure `BACKUP_COPIA_DIR` (Drive/OneDrive): si se rompe
  el disco, se pierden base y copias.

## Lo que todavía depende de que nadie se equivoque

- **Scripts de una sola vez** en la raíz y en `scripts/` (`write_menu.js`, `check_db.js`, `patch-*.js`, `ps*.js`,
  `build-*.js`, `inspect_*.js`...): ya se aplicaron y algunos escriben en la base o en el código. Correr uno por error
  puede pisar datos. Conviene moverlos a `_retirado/` (no se hizo sin tu OK). El lint los ignora.
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
3. **Copias fuera de la PC del local:** definir `BACKUP_COPIA_DIR` apuntando a una carpeta de Google Drive / OneDrive.
