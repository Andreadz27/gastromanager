# Planes de Morfi

Guía interna: qué vendemos, a cuánto, contra quién competimos y cómo se asigna el plan de cada local.
Los precios y módulos están en un solo archivo: `src/planes.js`. La landing (`landing/index.html`, sección `#precios`)
repite los precios a mano: si cambian, cambiarlos en los dos lugares.

## Los planes (precio final por mes, octubre 2026)

| | **Esencial** | **Pro** | **Cadenas** |
|---|---|---|---|
| Precio | $24.900 | $49.900 | $44.900 por local (desde 2) |
| Anual (2 meses gratis) | $249.000 | $499.000 | $449.000 por local |
| Para | Café, bar, rotisería, local chico | Restaurante con salón, delivery y equipo | Cadenas |
| Pedidos, mesas, cocina, caja, cobros | ✔ | ✔ | ✔ |
| Factura electrónica ARCA y ticket fiscal | ✔ | ✔ | ✔ |
| Funciona sin internet, copia cifrada en la nube | ✔ | ✔ | ✔ |
| Stock, reportes, arqueo ciego, PIN del encargado | ✔ | ✔ | ✔ |
| Carta QR y llamado al mozo desde la mesa | ✔ | ✔ | ✔ |
| Usuarios | ilimitados | ilimitados | ilimitados |
| Pedido y pago con Mercado Pago desde la mesa | | ✔ | ✔ |
| Carta online con link fijo, pedidos por WhatsApp/Instagram | | ✔ | ✔ |
| Apps de delivery (PedidosYa, Rappi) y Tienda Nube | | ✔ | ✔ |
| WhatsApp Business (comprobantes, avisos, reservas) | | ✔ | ✔ |
| Personal: fichadas, turnos, propinas | | ✔ | ✔ |
| Fidelización: puntos, cupones, gift cards | | ✔ | ✔ |
| "¿Cuánto gané hoy?" en el inicio | ✔ | ✔ | ✔ |
| Ganancias por día/semana/mes/año, plato, canal, horario y mozo; fugas; punto de equilibrio | | ✔ | ✔ |
| Recetas y costo de cada plato | | ✔ | ✔ |
| Contabilidad: gastos, IVA, resultados, libro diario | | ✔ | ✔ |
| Panel Morfi Nube en el celular | | ✔ | ✔ |
| Varias sucursales y precios centrales | | | ✔ |

**Extra:** Asistente IA por WhatsApp, +$19.900/mes sobre cualquier plan. El consumo de la IA va en la cuenta de
Anthropic del local (su propia clave), así el precio no depende de cuánto lo usen.

**Condiciones:** 30 días de prueba con todo, sin tarjeta. Semestral 10 % menos; anual, 2 meses gratis. Alta remota,
carga de la carta y capacitación sin cargo. Precios finales: si la facturación de Morfi pasa a discriminar IVA,
revisar si se mantienen como precio final.

## Contra quién competimos (precios relevados el 23/10/2026)

**Fudo** (fu.do/es-ar/precios), precio final por mes:

- Inicial $22.500, Avanzado $43.900, Pro $69.500. Usuarios ilimitados.
- Se cobran aparte: Gestión de Mesas +$8.500, Facturación Electrónica +$13.500, Delivery Apps +$19.500,
  Recepcionista IA +$55.000. Multi-sucursal: a cotizar. Descuento 10 % semestral, 15 % anual.
- Pedido desde la mesa: recién en Avanzado. Estado de resultados y arqueo ciego: solo en Pro.

**Maxirest** (maxirest.com.ar/precios): un solo plan de $89.000/mes (promoción de $66.750 los primeros 3 meses),
con mesas ilimitadas, facturación, implementación y soporte. Integraciones con marketplaces: gratis un tiempo y
después con costo.

### Lo que paga de verdad un restaurante

| Caso | Fudo | Maxirest | Morfi |
|---|---|---|---|
| Bar chico con mesas y factura | Inicial + Mesas + Facturación = **$44.500** | $89.000 | Esencial **$24.900** |
| Restaurante con mesas, factura, stock y recetas | Avanzado + Mesas + Facturación = **$65.900** | $89.000 | Pro **$49.900** |
| Lo anterior + apps de delivery | **$85.400** | $89.000 + marketplaces | Pro **$49.900** |
| Todo + resultados y arqueo ciego | Pro + Mesas + Fact. + Delivery = **$111.000** | $89.000 | Pro **$49.900** |
| Atención por IA | +$55.000 | no publicado | +$19.900 |

Argumento de venta: en Morfi, mesas y factura electrónica vienen en el plan más barato; Pro cuesta menos que el
plan intermedio de Fudo con sus módulos, y además funciona sin internet, cosa que ninguno de los dos ofrece.
En la landing pública no se nombra a la competencia ("otros sistemas"): sus precios cambian y la comparación con
nombre propio tiene que estar siempre actualizada y ser exacta.

Revisar estos precios cada 2 o 3 meses (inflación) y actualizar `src/planes.js` y la landing.

## Cómo funciona en el sistema

- **Instalación nueva:** 30 días de prueba con todo. Después, Esencial, hasta que llegue una licencia.
- **Instalación que ya vendía antes de los planes** (por ejemplo, el primer restaurante): sigue con todo hasta que
  se le asigne un plan desde la nube.
- **Con licencia:** plan contratado hasta el vencimiento. Desde 7 días antes se avisa al administrador. Vencido, hay
  10 días de gracia con todo y después quedan solo los módulos de Esencial. **Nunca se cortan** ventas, caja,
  cocina, cobros ni facturación, y no se borra nada: al pagar vuelve todo.
- El servidor bloquea cada operación de un módulo que el plan no incluye (respuesta 402). En la pantalla, esas
  secciones del menú tienen un candado y explican qué plan las incluye. El QR de la mesa queda en "ver la carta y
  llamar al mozo", y el cliente no ve ningún mensaje sobre planes.
- La licencia es un texto firmado (Ed25519). El local la verifica con `src/licencia-publica.pem`; cambiar la base
  a mano no sirve.

## Asignar o cambiar un plan (soporte)

En el servidor de Morfi Nube:

```bash
# Local nuevo: arranca en prueba 30 días (o con --plan directamente)
node nube/alta.js local --cuenta "La Buena Mesa" --nombre "Centro" --cliente la-buena-mesa-centro
# Al cobrar: plan y fecha hasta la que está pagado
node nube/alta.js plan --cliente la-buena-mesa-centro --plan pro --vence 2026-12-31
# Con el asistente IA
node nube/alta.js plan --cliente la-buena-mesa-centro --plan pro --vence 2026-12-31 --extras asistente
# Sin vencimiento (cortesía, local propio)
node nube/alta.js plan --cliente mi-restaurante --plan pro
```

El local recibe el plan en la próxima sincronización (cada 2 minutos). Planes: `esencial`, `pro`, `cadenas`, `prueba`.

**Clave de licencias:** la nube firma con la clave privada de `NUBE_CLAVE_LICENCIAS` (el contenido PEM, o la ruta al
archivo). La clave se generó el 23/10/2026 y está **fuera del repositorio** en
`Documents\Morfi-claves\licencias-privada.pem` de la PC de desarrollo. Guardar una copia en un lugar seguro
(gestor de contraseñas). Si se pierde, hay que generar un par nuevo, reemplazar `src/licencia-publica.pem` y
actualizar todos los locales. Sin la clave configurada, la nube no firma y cada local sigue con la última licencia
que recibió.

**Local sin Morfi Nube:** soporte genera la licencia en la nube y el administrador del local la pega en
*Tu plan → Licencia*.

**Contacto de ventas:** WhatsApp **11 2390-0155** (`5491123900155`, por defecto en `src/planes.js`). Lo usan el botón
"Quiero este plan" de *Tu plan* y los botones de la landing (precios y contacto), con el mensaje ya escrito.
Para que un local muestre otro contacto (por ejemplo, un revendedor): `MORFI_VENTAS_WHATSAPP` (solo números, con 549)
o `MORFI_VENTAS_EMAIL` en su `.env`. Si se cambia el número de Morfi: `src/planes.js` y `landing/index.html`.
