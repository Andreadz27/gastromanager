# Instalar GastroManager en un restaurante

Modelo recomendado (ver el estudio "Dónde alojar el sistema"): el servidor corre **en el local**, así vende e imprime
aunque se corte internet; la nube guarda las copias y da acceso remoto.

## 1. Equipo recomendado

| Qué | Mínimo | Por qué |
|---|---|---|
| PC o mini PC | Windows 10/11, 4 GB de RAM, disco SSD | Queda prendida todo el turno; el SSD evita lentitud y fallas del disco |
| Conexión | Por cable a la red del local | Las tablets y las impresoras la encuentran siempre |
| IP fija en el router | Reservar la IP de la PC | Las tablets y las impresoras apuntan a esa dirección |
| UPS (batería) | Para la PC y el router | Un corte de luz no corta la caja ni corrompe la base |

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

El instalador deja el sistema corriendo, con inicio automático, y muestra la dirección para las tablets
(ej. `http://192.168.0.10:3000`). Se puede volver a ejecutar: no borra datos.

## 3. Copia diaria en la nube (Backblaze B2)

1. Crear una cuenta en [Backblaze](https://www.backblaze.com/cloud-storage) (los primeros 10 GB no tienen costo).
2. **Buckets → Create a Bucket**: privado, por ejemplo `gastromanager-copias` (uno para todos los clientes).
3. En el bucket, **Lifecycle Settings → Keep prior versions for this number of days: 30** (cuántos días se guardan).
4. **Application Keys → Add a New Application Key**: acceso solo a ese bucket, Read and Write.
5. Completar en `C:\GastroManager\.env`:

```
BACKUP_S3_ENDPOINT=https://s3.us-west-004.backblazeb2.com   (el "Endpoint" que muestra el bucket)
BACKUP_S3_BUCKET=gastromanager-copias
BACKUP_S3_KEY_ID=<keyID>
BACKUP_S3_SECRET=<applicationKey>
BACKUP_S3_PREFIJO=la-buena-mesa
```

6. `pm2 restart gastromanager --update-env`. Cada copia (al iniciar, cada 24 h y las manuales) se sube a
   `gastromanager-copias/la-buena-mesa/`. Sirve cualquier servicio compatible con S3 (Cloudflare R2, AWS S3, Wasabi).

**Restaurar desde la nube:** descargar la copia del bucket y seguir "Restaurar" en el README.

## 4. Monitoreo (aviso si un local se cae)

1. Crear una cuenta en [healthchecks.io](https://healthchecks.io) (tiene plan gratuito) y un check por local,
   con período de 5 minutos. Configurar el aviso por email o Telegram.
2. Copiar la URL del check (`https://hc-ping.com/...`) en `MONITOREO_URL` del `.env` y reiniciar.

El sistema avisa cada 5 minutos que está vivo. Si deja de avisar (PC apagada, sin internet) o avisa una falla
(base sin responder, sin copia en 26 horas, falló la subida a la nube), te llega la alerta.
Desde la red del local también se puede ver `http://<ip>:3000/api/salud`.

## 5. Acceso remoto y pagos online (Cloudflare Tunnel)

Necesario para que el dueño vea el sistema desde afuera y para recibir avisos de Mercado Pago y Tienda Nube.

1. Tener el dominio de la empresa (ej. `tudominio.com.ar`) administrado en [Cloudflare](https://dash.cloudflare.com) (gratis).
2. **Zero Trust → Networks → Tunnels → Create a tunnel** (tipo Cloudflared), con el nombre del local.
3. **Public hostname**: `la-buena-mesa.tudominio.com.ar` → `http://localhost:3000`. Copiar el token.
4. En la PC del local, PowerShell como Administrador:

```powershell
powershell -ExecutionPolicy Bypass -File C:\GastroManager\scripts\windows\tunel.ps1 -Token "<token>" -Direccion "https://la-buena-mesa.tudominio.com.ar"
```

No se abren puertos del router: la conexión sale del local hacia Cloudflare, con HTTPS.

## 6. Actualizar

- Automático: con `-ActualizacionAutomatica`, todos los días a las 05:00.
- A mano: doble clic en `scripts\windows\actualizar.bat`, o `npm run actualizar`.
- Solo revisar si hay versión nueva: `node scripts/actualizar.js --solo-revisar`.

Siempre hace una copia antes, baja solo lo que está en `main` (que pasó el CI) y, si la versión nueva no
arranca, vuelve sola a la anterior. Registro en `logs\actualizaciones.log`.
