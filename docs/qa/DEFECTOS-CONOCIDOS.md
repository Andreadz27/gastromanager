# Defectos conocidos

Defectos encontrados y todavía abiertos. Cada uno tiene un caso automatizado en
`qa/e2e/specs/05-defectos.spec.js`, marcado con `test.fail()`:

- Mientras el defecto siga abierto, el caso **falla como se espera** y la suite queda en verde.
- Cuando alguien lo arregla, el caso pasa y Playwright lo marca como error (*expected to fail*). Ese aviso
  significa: mover el defecto a **Cerrados**, quitar el `test.fail` y dejar el caso como prueba de regresión.

Para reportar uno nuevo: GitHub → Issues → **Defecto** (plantilla en `.github/ISSUE_TEMPLATE/defecto.yml`).

**Severidad:** crítica (para la venta o pierde datos) · alta (un circuito no funciona y no hay alternativa) ·
media (funciona mal, pero hay alternativa) · baja (molestia o dato poco prolijo).

## Abiertos

### DEF-001 · La API acepta pedidos con un tipo que no existe

| | |
|---|---|
| Severidad / prioridad | Baja / baja |
| Módulo | Pedidos (`POST /api/pedidos`) |
| Detectado | 24/10/2026, exploración de la API para la suite de QA |
| Caso automatizado | `DEF-001` en `05-defectos.spec.js` |

**Pasos:** iniciar sesión como cajero y enviar `POST /api/pedidos` con `{"tipo": "nave-espacial", "items": [{"producto_id": 1, "cantidad": 1}]}`.
**Esperado:** 400, "Tipo de pedido inválido" (los tipos válidos son `salon`, `takeaway` y `delivery`).
**Obtenido:** 201: el pedido se guarda con tipo `nave-espacial`.
**Impacto:** la pantalla siempre manda un tipo válido, así que solo pasa con una integración mal hecha. Si pasa,
ese pedido no aparece bien en Ganancias → Canales ni en los reportes por tipo.

### DEF-002 · Un pedido a una mesa que no existe da un mensaje confuso

| | |
|---|---|
| Severidad / prioridad | Baja / media |
| Módulo | Pedidos (`POST /api/pedidos`) |
| Detectado | 24/10/2026 |
| Caso automatizado | `DEF-002` |

**Pasos:** `POST /api/pedidos` con `{"tipo": "salon", "mesa_id": 99999, ...}`.
**Esperado:** 400, "La mesa no existe".
**Obtenido:** 409, "Ya existe un registro con esos datos o faltan datos obligatorios" (el error genérico de la base).
**Impacto:** si se borra una mesa mientras un mozo la tiene abierta en el celular, el mozo ve un mensaje que no
explica qué pasó.

### DEF-003 · Un pedido para llevar con mesa bloquea esa mesa

| | |
|---|---|
| Severidad / prioridad | Media / media |
| Módulo | Pedidos y Mesas |
| Detectado | 24/10/2026 |
| Caso automatizado | `DEF-003` |

**Pasos:**
1. `POST /api/pedidos` con `{"tipo": "takeaway", "mesa_id": 3, ...}` (para llevar, pero con mesa).
2. Abrir la mesa 3 desde el salón: `POST /api/pedidos` con `{"tipo": "salon", "mesa_id": 3, ...}`.

**Esperado:** el pedido para llevar se guarda sin mesa (o se rechaza) y la mesa 3 sigue libre.
**Obtenido:** el pedido para llevar queda asociado a la mesa 3 y el paso 2 responde 409: "La mesa ya tiene el
pedido P-… abierto". El mozo no puede abrir la mesa hasta que se cobre o se cancele un pedido que no es de ella.
**Impacto:** desde la pantalla del POS no pasa, porque al elegir "Para llevar" se oculta la mesa. Puede pasar con
integraciones o con cambios futuros del POS.

### DEF-004 · Se pueden crear mesas sin nombre o con capacidad negativa

| | |
|---|---|
| Severidad / prioridad | Baja / baja |
| Módulo | Mesas (`POST /api/mesas`) |
| Detectado | 24/10/2026 |
| Caso automatizado | `DEF-004` |

**Pasos:** como administrador, `POST /api/mesas` con `{"nombre": "", "capacidad": 4}` y con `{"nombre": "X", "capacidad": -4}`.
**Esperado:** 400 en los dos casos.
**Obtenido:** 201 en los dos: aparece en el plano una mesa sin nombre, o una con capacidad −4.

## Limitaciones conocidas (no son defectos: el sistema no lo promete)

- **Sin WiFi en el celular del mozo:** si el celular pierde la red del local, el pedido no se guarda en el
  celular para mandarlo después; hay que volver a cargarlo. La PC del local sí funciona sin internet.
- **Dividir la cuenta por ítem** desde la mesa: hoy se divide en partes iguales.
- **CAEA** (factura sin conexión con ARCA): no está; las facturas quedan pendientes y se reintentan solas.

## Defectos de las pruebas (no del sistema)

- **"USB en Windows…" (CI Windows):** a veces supera los 60 s del runner de GitHub y se cancela. Se
  resuelve con `gh run rerun <id> --failed`. No pasa en una PC normal.

## Cerrados

| ID | Defecto | Cerrado en |
|---|---|---|
| — | Todavía ninguno desde que se lleva este registro. Los defectos anteriores están en `test/regresiones.test.js`. | |
