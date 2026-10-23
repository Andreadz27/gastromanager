# Instalar Morfi en un restaurante

Modelo recomendado (ver el estudio "Dónde alojar el sistema"): el servidor corre **en el local**, así vende e imprime
aunque se corte internet; la nube guarda las copias y da acceso remoto.

## 1. Equipo recomendado

| Qué | Mínimo | Por qué |
|---|---|---|
| PC o mini PC | Windows 10/11, 4 GB de RAM, disco SSD | Queda prendida todo el turno; el SSD evita lentitud y fallas del disco |
| Conexión | Por cable a la red del local | Las tablets y las impresoras la encuentran siempre |
| IP fija en el router | Reservar la IP de la PC | Las tablets y las impresoras apuntan a esa dirección |
| UPS (batería) | Para la PC y el router | Un corte de luz no corta la caja ni corrompe la base |
| BIOS: *Restore on AC power loss* = **Power On** | En la configuración de la PC | Si la luz se corta más que la UPS, la PC se prende sola al volver y Morfi arranca solo (no hace falta iniciar sesión) |

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

**PC nueva (se rompió la del local):** instalar con `instalar.ps1`, copiar al `.env` los datos `BACKUP_S3_*` y la
**misma** `BACKUP_CLAVE` del local (la del gestor de contraseñas, no la nueva que generó el instalador), y
restaurar con `--nube`. **Hacer este simulacro una vez antes del primer cliente.**

## 4. Monitoreo (aviso si un local se cae)

1. Crear una cuenta en [healthchecks.io](https://healthchecks.io) (tiene plan gratuito) y un check por local,
   con período de 5 minutos. Configurar el aviso por email o Telegram.
2. Copiar la URL del check (`https://hc-ping.com/...`) en `MONITOREO_URL` del `.env` y reiniciar.

El sistema avisa cada 5 minutos que está vivo. Si deja de avisar (PC apagada, sin internet) o avisa una falla
(base sin responder, sin copia en 26 horas, falló la subida a la nube), te llega la alerta.
Desde la red del local también se puede ver `http://<ip>:3000/api/salud`.

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
