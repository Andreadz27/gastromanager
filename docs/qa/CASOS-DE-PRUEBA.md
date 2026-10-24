# Casos de prueba

Cada caso tiene un ID que aparece igual en el código y en el reporte. **Prioridad:** P1 = cobro, caja,
pedidos y permisos (si falla no se instala); P2 = el resto de lo que usa el local; P3 = detalles.
**Automatización:** dónde está el caso automatizado, o *Manual* si se prueba a mano en el local.

Datos de prueba: `qa/datos.js`. Base nueva en cada corrida (ver `ESTRATEGIA-DE-PRUEBAS.md`).

## Acceso (CP-ACC) · `qa/e2e/specs/01-acceso.spec.js`

| ID | Caso | Pasos | Resultado esperado | Prio. | Etiquetas |
|---|---|---|---|---|---|
| CP-ACC-01 | Ingreso correcto | Ingresar con el cajero | Entra; muestra "Vendedor Test" y el rol "Cajero" | P1 | humo, regresión |
| CP-ACC-02 | Contraseña incorrecta | Ingresar con una contraseña mala | "Credenciales incorrectas"; no entra | P1 | regresión |
| CP-ACC-03 | Salir | Ingresar, salir y recargar la página | Vuelve al ingreso; la sesión no quedó guardada | P1 | regresión |
| CP-ACC-04 | Secciones por rol | Ingresar como mozo, cocina y cajero | Cada uno arranca en su sección (Mesas, Cocina, Inicio) y no ve las ajenas (el mozo no ve Caja) | P1 | regresión |
| CP-ACC-05 | La API respeta los permisos | Pedir datos sin sesión, usuarios como cajero, abrir caja como mozo | 401, 403, 403 | P1 | humo, seguridad |

## Venta de mostrador (CP-VEN) · `qa/e2e/specs/02-venta.spec.js`

Corren en orden; si uno falla, los siguientes no corren.

| ID | Caso | Pasos | Resultado esperado | Prio. | Etiquetas |
|---|---|---|---|---|---|
| CP-VEN-01 | Abrir la caja | Caja → Abrir con $5.000 | "Caja abierta"; la API informa caja abierta con $5.000 | P1 | humo, regresión |
| CP-VEN-02 | Tomar un pedido | POS → 2 × Ensalada César → Para llevar, cliente y nota | "Pedido creado"; total $9.000 (precio de la carta, lo calcula el servidor) | P1 | humo, regresión |
| CP-VEN-03 | Llega a cocina | Ingresar como cocina | La comanda muestra "2× Ensalada César" y la nota; al tocar LISTO desaparece y queda la hora | P1 | humo, regresión |
| CP-VEN-04 | Cobro en efectivo | Pedidos → el pedido → Cobrar; recibe $10.000 | Vuelto $1.000; el pedido queda pagado | P1 | humo, regresión |
| CP-VEN-05 | Cierre de caja | Caja → Cerrar con el efectivo esperado | Esperado = $5.000 + $9.000; cierra con diferencia $0 | P1 | regresión |

## Carta del QR en el celular (CP-CAR) · `qa/e2e/specs/03-carta-celular.spec.js` (Pixel 7 emulado)

| ID | Caso | Pasos | Resultado esperado | Prio. | Etiquetas |
|---|---|---|---|---|---|
| CP-CAR-01 | Ver la carta | Abrir `/menu.html` | Se ven las categorías y "Ensalada César" a "$ 4.500" | P1 | celular, humo |
| CP-CAR-02 | Filtrar por categoría | Tocar "Bebidas" | Solo la sección Bebidas; no aparece la ensalada | P2 | celular |
| CP-CAR-03 | Entra en la pantalla | Abrir la carta en el celular | Sin desplazamiento horizontal | P2 | celular |
| CP-CAR-04 | Nada interno a la vista | Abrir la carta | No aparecen costo, stock ni "admin" | P1 | celular, seguridad |

## Ganancias (CP-GAN) · `qa/e2e/specs/04-ganancias.spec.js`

| ID | Caso | Pasos | Resultado esperado | Prio. | Etiquetas |
|---|---|---|---|---|---|
| CP-GAN-01 | "¿Cuánto gané hoy?" | Cobrar un pedido con tarjeta; ingresar como administrador | Las ventas suben; la comisión sube 3 % de lo cobrado; la tarjeta del inicio se ve | P2 | regresión |
| CP-GAN-02 | Pestañas de Ganancias | Recorrer las 6 pestañas | Ninguna muestra error | P2 | regresión |

## API (CP-API) · `qa/api/morfi.postman_collection.json`

Una carpeta por grupo; cada pedido tiene sus verificaciones (`pm.test`). Además, en todos: responde en menos de 2 s
y el JSON se puede leer.

| ID | Carpeta | Qué verifica | Prio. |
|---|---|---|---|
| CP-API-01 | 01 · Salud y carta pública | Servidor y base OK; la carta pública tiene categorías y precios válidos y **no expone el costo** | P1 |
| CP-API-02 | 02 · Autenticación | Login de cada rol devuelve token y no la contraseña; mismo mensaje para email inexistente y contraseña mala; cuerpo no JSON → 400 (no 500); `/me` con los permisos del rol | P1 |
| CP-API-03 | 03 · Seguridad y permisos | Sin sesión o con token falso → 401; cajero sin usuarios ni plan, mozo sin caja → 403 | P1 |
| CP-API-04 | 04 · Catálogo | Productos y categorías; alta sin nombre o con precio negativo → 400 | P2 |
| CP-API-05 | 05 · Venta y cobro | Caja (no se abre dos veces); pedido con total del servidor (ignora el precio que manda el navegador); sin ítems, cantidad 0 o producto inexistente → 400; llega a cocina; medio de pago inválido y tarjeta por más del saldo → 400; cobro en dos partes (efectivo + Mercado Pago); cobrar dos veces → 409; caja cuadra y cierra con diferencia 0 | P1 |
| CP-API-06 | 06 · Plan y ganancias | Base nueva = prueba de 30 días con todo; ofrece solo los planes a la venta; ganancias de hoy con comisión de Mercado Pago; el cajero no ve el detalle | P2 |

## Celular real (CP-MOB) · `qa/mobile/flujos/` (Maestro, Android con Chrome)

| ID | Caso | Pasos | Resultado esperado | Prio. | Etiquetas |
|---|---|---|---|---|---|
| CP-MOB-01 | Carta del QR | Abrir la carta en Chrome; tocar "Postres" | Se ve la ensalada a $4.500; con Postres ya no | P1 | humo, celular |
| CP-MOB-02 | El mozo ingresa | Ingresar con el mozo desde el celular | Ve su nombre y las mesas; no ve Caja | P1 | humo, celular |
| CP-MOB-03 | Contraseña mal | Ingresar con contraseña incorrecta | "Credenciales incorrectas"; no entra | P2 | celular |

## Manuales (en el local, antes de instalar una versión que toque estas partes)

| ID | Caso | Resultado esperado | Prio. |
|---|---|---|---|
| CP-MAN-01 | Imprimir comanda y ticket en la impresora térmica del local | Sale completo, con acentos y el QR fiscal legible | P1 |
| CP-MAN-02 | Factura B real en ARCA producción y nota de crédito | CAE obtenido; el QR del ticket abre la factura en ARCA | P1 |
| CP-MAN-03 | Pago real desde la mesa con Mercado Pago (monto chico) | El mozo recibe el aviso; la mesa queda pagada; se ve en el arqueo | P1 |
| CP-MAN-04 | Cortar internet durante el servicio | Se sigue vendiendo y cobrando; las facturas quedan pendientes y salen al volver | P1 |
| CP-MAN-05 | Celular del mozo en el WiFi del local (QR "Conectar celulares") | Entra sin escribir la dirección | P2 |
