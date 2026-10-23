# Instalar Morfi en un restaurante

Modelo recomendado (ver el estudio "Dónde alojar el sistema"): el servidor corre **en el local**, así vende e imprime
aunque se corte internet; la nube guarda las copias y da acceso remoto.

## 1. Equipo recomendado

| Qué | Mínimo | Por qué |
|---|---|---|
| PC o mini PC | Windows 10/11, 4 GB de RAM, disco SSD | Queda prendida todo el turno; el SSD evita lentitud y fallas del disco |
| Conexión | Por cable a la red del local | Las tablets y las impresoras la encuentran siempre |
| IP fija en el router | Reservar la IP de la PC **y la de cada impresora de red** | Los celulares y tablets entran por la IP de la PC; la PC manda las comandas a la IP de cada impresora |
| UPS (batería) | Para la PC y el router | Un corte de luz no corta la caja ni corrompe la base |
| BIOS: *Restore on AC power loss* = **Power On** | En la configuración de la PC | Si la luz se corta más que la UPS, la PC se prende sola al volver y Morfi arranca solo (no hace falta iniciar sesión) |
| Internet de respaldo (recomendado) | Router con chip 4G y *failover* (pasa solo al 4G si se corta la fibra), o un módem 4G conectado al router principal | Sin internet el local sigue vendiendo, pero Mercado Pago, la factura al momento, WhatsApp y los pedidos online esperan. Con el 4G no se nota el corte |
| Access point WiFi | Que llegue bien a todo el salón y la cocina | Si un celular pierde el WiFi del local, no puede tomar pedidos (el sistema está en la PC del local) |

## 2. Instalar (una vez por local, unos 15 minutos)

El repositorio es **privado**: cada instalación descarga el sistema con un token de GitHub de solo lectura.

**Una vez (para todos los locales):** en GitHub, **Settings → Developer settings → Personal access tokens →
Fine-grained tokens → Generate new token**: acceso solo al repositorio `gastromanager`, permiso
**Contents: Read-only**, vencimiento de 1 año. Guardarlo en un lugar seguro (no se vuelve a mostrar).
Antes de que venza, generar uno nuevo y volver a ejecutar el instalador en cada local con el token nuevo
(no borra datos).

**En cada local:** copiar `scripts\windows\instalar.ps1` a la PC (pendrive o WhatsApp), abrir
**PowerShell como Administrador** en esa carpeta y ejecutar:

```powershell
powershell -ExecutionPolicy Bypass -File instalar.ps1 -Cliente "la-buena-mesa" -Token "github_pat_..." -ActualizacionAutomatica
```

`-Cliente` = nombre corto del local, en minúsculas y sin espacios (se usa en la nube y en el monitoreo).
`-ActualizacionAutomatica` = actualiza todos los días a las 05:00, con copia previa y vuelta atrás si algo falla.

El instalador deja el sistema corriendo y muestra la dirección para las tablets (ej. `http://192.168.0.10:3000`).
Se puede volver a ejecutar: no borra datos.

**Celulares y tablets del personal:** en **Menú QR → Conectar celulares y tablets del personal** está el QR con la
dirección de la PC en el WiFi del local (sin las redes virtuales de Windows) y **Imprimir hoja para el personal**,
con los pasos y cómo agregarlo a la pantalla de inicio. Pegarla en la cocina o la caja. Los QR de la carta y de las
mesas también usan esa dirección cuando se arman desde la misma PC.

- **Arranca al encender la PC**, aunque nadie inicie sesión (tarea de Windows *Morfi*, cuenta SYSTEM).
  pm2 usa una carpeta compartida para toda la PC (`PM2_HOME=C:\ProgramData\Morfi\pm2`): `pm2 list` y
  `pm2 logs` desde una consola de administrador ven el mismo proceso.
- **Clave de las copias:** la genera el instalador (`BACKUP_CLAVE` en el `.env`) y la muestra en rojo al final.
  **Guardala en tu gestor de contraseñas con el nombre del cliente.** Si la PC se rompe, sin esa clave las copias
  de la nube no se pueden abrir.
- Al terminar lista en amarillo lo que falta configurar (copia en la nube, monitoreo, acceso remoto).
  **El local no está listo para entregar hasta que esa lista quede vacía.**
- Rota los logs de pm2 (`pm2-logrotate`: 10 archivos de 10 MB).

## 3. Copia diaria en la nube (Cloudflare R2)

Se usa la misma cuenta de Cloudflare del túnel. R2 no cobra la descarga de las copias y tiene un uso mensual
gratuito; por encima, se paga por GB guardado.

**Un bucket y un token por cliente.** La clave queda en el `.env` del local: con un bucket compartido, cualquiera
con acceso a esa PC podría leer o borrar las copias de todos los demás clientes. (R2 limita los tokens por bucket,
no por carpeta.)

1. En [Cloudflare](https://dash.cloudflare.com): **R2 Object Storage → Create bucket**, con el nombre del cliente:
   `gm-la-buena-mesa`.
2. En el bucket, **Settings → Object lifecycle rules → Add rule**: borrar objetos a los **30 días**.
3. **R2 → Manage API tokens → Create API token**: permiso **Object Read & Write**, **solo para ese bucket**.
   Copiar **Access Key ID**, **Secret Access Key** y el endpoint `https://<account-id>.r2.cloudflarestorage.com`.
4. Completar en `C:\Morfi\.env` (`BACKUP_CLAVE` ya la puso el instalador):

```
BACKUP_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
BACKUP_S3_BUCKET=gm-la-buena-mesa
BACKUP_S3_KEY_ID=<Access Key ID>
BACKUP_S3_SECRET=<Secret Access Key>
BACKUP_S3_PREFIJO=la-buena-mesa
```

5. `pm2 restart morfi --update-env`. Cada copia (al iniciar, cada 24 h y las manuales) se sube
   **cifrada** a `gm-la-buena-mesa/la-buena-mesa/` (archivos `.db.cifrado`).
6. Comprobar: `npm run restaurar -- --listar` muestra las copias locales y las de la nube.

También sirve cualquier otro servicio compatible con S3 (Backblaze B2, AWS S3, Wasabi): cambian solo esos datos.
Si un local decide no tener copia fuera de la PC (no recomendado), poner `BACKUP_SOLO_LOCAL=1`. Si no,
`/api/salud` y el Dashboard del administrador marcan la falta como un problema.

## 3b. Restaurar una copia

En la carpeta de la instalación (PowerShell como Administrador):

```powershell
pm2 stop morfi
npm run restaurar -- --listar                                         # ver las copias
npm run restaurar -- morfi_2026-10-23_050000.db               # una copia de esta PC
npm run restaurar -- --nube morfi_2026-10-23_050000.db.cifrado  # una de la nube
pm2 start morfi
```

Antes de reemplazar nada, verifica que la copia sea una base sana y guarda la base actual en
`data\backups\antes-de-restaurar_...db` (si te equivocaste de copia, se restaura esa).

### PC de reemplazo (se rompió la del local), en un paso

Con la clave de las copias del gestor de contraseñas y los datos del bucket del local, en la PC nueva
(PowerShell como Administrador):

```powershell
powershell -ExecutionPolicy Bypass -File instalar.ps1 -Cliente "la-buena-mesa" -Token "github_pat_..." -RestaurarDeLaNube `
  -ClaveCopias "<64 caracteres>" -S3Endpoint "https://<cuenta>.r2.cloudflarestorage.com" -S3Bucket "gm-la-buena-mesa" `
  -S3KeyId "<Access Key ID>" -S3Secret "<Secret Access Key>"
```

Instala todo, deja configuradas las copias en la nube con la **misma** clave, baja la copia más nueva, la verifica
antes de usarla y arranca el sistema con los usuarios y datos del local. Antes de instalar nada revisa que estén
todos los datos (no hay que descubrir a mitad de camino que faltaba uno). Después:

1. En el router, darle a esta PC **la misma IP** que tenía la anterior: así los celulares y las tablets la
   encuentran sin tocar nada (las impresoras de red no cambian: la PC les manda a sus IP, que vienen en la copia).
   Las impresoras **USB** hay que instalarlas en la PC nueva con el mismo nombre.
2. Revisar en **Pedidos** las ventas del último día: lo vendido después de la última copia (se hace cada 24 h y al
   iniciar) no está.

También existe `npm run restaurar -- --nube --ultima` para hacerlo a mano.
**Hacer este simulacro una vez antes del primer cliente**, en una PC cualquiera.

## 4. Monitoreo (aviso si un local se cae)

1. Crear una cuenta en [healthchecks.io](https://healthchecks.io) (tiene plan gratuito) y un check por local,
   con período de 5 minutos. Configurar el aviso por email o Telegram.
2. Copiar la URL del check (`https://hc-ping.com/...`) en `MONITOREO_URL` del `.env` y reiniciar.

El sistema avisa cada 5 minutos que está vivo. Si deja de avisar (PC apagada, sin internet) o avisa una falla
(base sin responder, sin copia en 26 horas, falló la subida a la nube), te llega la alerta.
Desde la red del local también se puede ver `http://<ip>:3000/api/salud`.

### 4b. Morfi Nube (panel del dueño y de soporte)

Un servidor chico en internet (uno solo para todos los clientes) recibe las ventas cerradas y el estado de cada local.
El dueño ve desde el celular las ventas de hoy, de la semana o del mes, por local y en total, lo más vendido y si
cada local anda bien. Vos (soporte) ves todos los locales de todos los clientes, los que tienen problemas primero:
sin noticias hace más de 15 minutos, sin copia de seguridad, facturas que ARCA rechazó o que esperan conexión.

- Se mandan números de pedido, productos e importes. **No** se mandan nombres, teléfonos ni CUIT de los clientes.
- El local no depende de la nube: si se cae o no hay internet, se sigue cobrando y lo pendiente se manda al volver.

**Montar la nube (una vez):** cualquier servidor con Node 22 (un VPS de Hetzner o DigitalOcean, o Render/Railway con
disco persistente). Copiar el repositorio, `npm ci --omit=dev` y arrancar con `npm run nube` (PM2 o el servicio del
proveedor). Variables: `PORT`, `NUBE_DATOS` (carpeta persistente de la base), `NUBE_SECRETO` (48 caracteres al azar)
y `TRUST_PROXY=true` si va detrás de un proxy con https. Siempre con https (Cloudflare o el del proveedor).
Hacer copia de la carpeta `NUBE_DATOS`: si se pierde, los locales vuelven a mandar lo que tengan sin enviar, no el historial.

**Altas (en el servidor de la nube):**

```
node nube/alta.js soporte --nombre "Soporte Morfi" --email vos@tu-dominio --password ********
node nube/alta.js local   --cuenta "La Buena Mesa" --nombre "Centro" --cliente la-buena-mesa-centro
node nube/alta.js usuario --cuenta "La Buena Mesa" --nombre "Ana" --email ana@labuenamesa.com --password ********
```

El alta del local muestra **una sola vez** su `NUBE_TOKEN`. En el `.env` del local poner `NUBE_URL=https://<tu nube>` y
`NUBE_TOKEN=...` y reiniciar Morfi. A los 2 minutos manda todo su historial de ventas (en tandas) y queda al día.
Una cadena con varias sucursales es una cuenta con varios locales: el dueño las ve juntas.

**Carta y pedidos online con link fijo:** con Morfi Nube configurada, la carta online de cada local queda en
`https://<tu nube>/l/<cliente>` (el mismo nombre de cliente del alta). Ese link no cambia aunque cambie la PC, la
conexión o se caiga el túnel: es el que va en Instagram, Google Maps, el QR de la vidriera y la landing. El sistema
del local lo usa solo en Menú QR para los links de WhatsApp e Instagram.

- La carta se actualiza sola en la nube a los 2 minutos de cambiar un precio o un producto.
- El pedido queda en la nube y el local lo trae en unos 10 segundos: sale la comanda y el aviso en pantalla como
  cualquier pedido online. El cliente ve en su celular cuando el local lo recibió y con qué número.
- El precio que vale es el del local. Si un producto se dio de baja, el pedido se rechaza y el cliente lo ve.
- **Si el local no está conectado** (sin internet o PC apagada), la carta se sigue viendo pero no toma pedidos:
  muestra el teléfono del local. Así nadie pide algo que nadie ve en la cocina.
- Nombre, teléfono y dirección del cliente quedan en la nube solo hasta que el local recibe el pedido.
- El pedido desde la mesa (QR de cada mesa) sigue yendo directo al local por el WiFi.

**Precios centrales (cadenas):** en el panel, la pestaña *Precios* (solo el dueño, no soporte) muestra cada producto con el
precio en cada sucursal y marca los que difieren. "Cambiar" pone un precio nuevo en todas o en las sucursales que se
elijan. Cada local lo aplica en unos 10 segundos (sin internet, cuando vuelve) y lo deja en su auditoría
("desde Morfi Nube", con el nombre de quien lo cambió). Los productos se reconocen por nombre: conviene que se llamen
igual en todas las sucursales. Si una sucursal no puede aplicarlo (dio de baja el producto), el panel lo avisa.

## 5. Acceso remoto y pagos online (Cloudflare Tunnel)

Necesario para que el dueño vea el sistema desde afuera y para recibir avisos de Mercado Pago y Tienda Nube.

1. Tener el dominio de la empresa (ej. `tudominio.com.ar`) administrado en [Cloudflare](https://dash.cloudflare.com) (gratis):
   **Add a domain**, y en NIC Argentina cambiar los servidores DNS del dominio por los dos que indica Cloudflare.
2. **Zero Trust → Networks → Tunnels → Create a tunnel** (tipo Cloudflared), con el nombre del local.
3. **Public hostname**: `la-buena-mesa.tudominio.com.ar` → `http://localhost:3000`. Copiar el token.
4. En la PC del local, PowerShell como Administrador:

```powershell
powershell -ExecutionPolicy Bypass -File C:\Morfi\scripts\windows\tunel.ps1 -Token "<token>" -Direccion "https://la-buena-mesa.tudominio.com.ar"
```

No se abren puertos del router: la conexión sale del local hacia Cloudflare, con HTTPS.

## 6. Actualizar

- Automático: con `-ActualizacionAutomatica`, todos los días a las 05:00. Si a esa hora la PC estaba apagada,
  **no** se actualiza al prenderla (sería en pleno servicio): espera a la madrugada siguiente.
- A mano: doble clic en `scripts\windows\actualizar.bat`, o `npm run actualizar`.
- Solo revisar si hay versión nueva: `node scripts/actualizar.js --solo-revisar`.

Siempre hace una copia antes y baja solo lo que está en `main` (que pasó el CI). Si cambian las dependencias,
detiene el servidor para instalarlas (Windows no deja reemplazar archivos en uso). Si algo falla (dependencias,
pm2 o la versión nueva no arranca), vuelve sola a la versión anterior con sus dependencias.
Registro en `logs\actualizaciones.log` (se recorta solo pasado 1 MB).

**Ojo:** mergear a `main` es entregar. Los locales con actualización automática reciben la versión nueva a las
05:00 del día siguiente. Las opciones nuevas llegan **apagadas**: nada cambia para el local hasta configurarlas.

## 7. Puesta a punto de cada negocio (primer día, con el dueño)

Entrar como administrador. Cada punto es opcional según lo que contrate el local.

| # | Qué | Dónde | Necesita |
|---|---|---|---|
| 1 | Tipo de negocio, datos, CUIT y alícuota de IVA | Configuración | — |
| 2 | Usuarios por rol (encargado, cajeros, mozos, cocina) | Usuarios | Mail de cada uno |
| 3 | Carta: productos, precios y categorías | Productos | Lista de precios |
| 4 | **Insumos y recetas**: cargar insumos con costo, unidad y stock, y la receta de cada plato | Productos → Receta | Costos de mercadería |
| 5 | Impresoras de comandas y tickets | Configuración → Impresoras | IP o USB de cada una |
| 6 | **Factura electrónica**: CUIT, punto de venta, Access Token de AfipSDK y certificado | Integraciones → AFIP | Clave fiscal del dueño; punto de venta "Web Services" dado de alta en ARCA |
| 7 | **Padrón de ARCA** (datos del cliente en la Factura A) | ARCA → Administrador de relaciones | Habilitar *ws_sr_constancia_inscripcion* para la CUIT |
| 8 | Mercado Pago (QR y links de pago) | Integraciones → Mercado Pago | Acceso remoto (punto 5) para el cierre automático |
| 9 | **WhatsApp Business**: número, token, secreto, plantillas y webhook | Integraciones → WhatsApp | App en Meta for Developers, número verificado, 3 plantillas aprobadas, acceso remoto |
| 10 | **Cobro en la mesa** (los mozos cobran y facturan desde el celular) | Configuración | Mozos con celular en la red del local |
| 11 | **PIN de autorización** y **arqueo ciego** | Configuración; cada encargado en *Mi PIN* | Que cada encargado elija su PIN |

**Prueba antes de abrir:** una venta completa de punta a punta (pedido → cocina → cobro → factura si corresponde →
ticket), abrir y cerrar la caja, y revisar que el stock de un plato con receta baje en sus ingredientes.
Para la factura, primero en modo **homologación** (pruebas) y recién después en **producción**.

**Al terminar:** desactivar los usuarios de prueba (Configuración → Usuarios) y verificar que la copia en la nube
y el monitoreo estén funcionando (puntos 3 y 4).

## 8. Plan ante cortes (dejárselo al dueño)

| Qué pasa | Qué sigue andando | Qué hacer |
|---|---|---|
| **Se corta internet** | Pedidos, mesas, cocina, impresoras y cobros en efectivo o con posnet (el posnet tiene su propio chip). Arriba aparece el aviso "Sin internet" | Nada. Las facturas quedan **en espera** y se emiten solas al volver (sin duplicarse). Mercado Pago, WhatsApp y los pedidos online vuelven con internet. Con router 4G de respaldo no se nota |
| **Se corta la luz** | Con UPS: todo, el tiempo que dure la batería | Si la luz vuelve después de que se apagó la PC, se prende sola (BIOS) y Morfi arranca solo. No hace falta tocar nada |
| **Un celular no carga Morfi** | El resto de los equipos | Que esté en el **WiFi del local** (no en datos móviles) y entre con la dirección de la hoja del personal. Si nadie entra, revisar que la PC esté prendida |
| **Cambió la IP de la PC** (no se reservó en el router) | La PC misma | Menú QR → Conectar celulares muestra la dirección nueva. Reservarla en el router e imprimir la hoja de nuevo; en Configuración → Impresoras no hace falta tocar nada (la PC es la que les manda) |
| **Se rompe la PC** | Nada hasta reemplazarla | Otra PC y `instalar.ps1 -RestaurarDeLaNube` (sección 3b): 15 a 30 minutos. Mientras tanto, comandas a mano |
| **ARCA está caído** (con internet) | Todo menos la factura al momento | Las facturas quedan en espera y se reintentan solas; si ARCA rechaza alguna, aparece en Integraciones → AFIP |
