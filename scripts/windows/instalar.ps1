# GastroManager - instalador para Windows 10/11
# Ejecutar en PowerShell COMO ADMINISTRADOR, en la PC o mini PC del restaurante:
#   powershell -ExecutionPolicy Bypass -File instalar.ps1 -Cliente "la-buena-mesa" -Token "github_pat_..."
# -Token: token de GitHub de SOLO LECTURA para este repositorio (el repo es privado; ver docs/INSTALACION.md).
# Hace todo: Node.js y Git (con winget), descarga el sistema, crea la base, lo deja corriendo con pm2,
# lo arranca solo al iniciar Windows, abre el puerto para las tablets de la red local y
# (opcional) programa la actualización automática de madrugada.
# Se puede volver a ejecutar: no borra datos ni pisa la configuración existente.
param(
  [Parameter(Mandatory = $true)][string]$Cliente,          # nombre corto del local: carpeta en la nube y en el monitoreo
  [string]$Carpeta = 'C:\GastroManager',
  [string]$Repo = 'https://github.com/Andreadz27/gastromanager.git',
  [string]$Token,                                          # token de solo lectura (repositorio privado)
  [int]$Puerto = 3000,
  [switch]$ActualizacionAutomatica                         # actualiza todos los días a las 05:00 (con copia y vuelta atrás)
)
$ErrorActionPreference = 'Stop'
function Paso($t) { Write-Host "`n==> $t" -ForegroundColor Cyan }
function Refrescar-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Abre PowerShell como Administrador y vuelve a ejecutar el instalador.' }
if ($Cliente -notmatch '^[a-z0-9][a-z0-9-]{1,40}$') { throw 'El nombre del cliente va en minúsculas, sin espacios ni acentos (ej. la-buena-mesa).' }

Paso 'Node.js y Git'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements; Refrescar-Path }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { winget install --id Git.Git -e --accept-package-agreements --accept-source-agreements; Refrescar-Path }
$major = [int]((node -v).TrimStart('v').Split('.')[0])
if ($major -lt 22) { throw "GastroManager necesita Node.js 22 o superior (hay $(node -v)). Actualízalo: winget upgrade OpenJS.NodeJS.LTS" }

Paso "Sistema en $Carpeta"
# Con token, queda guardado en la dirección del repositorio de esta PC: así npm run actualizar puede bajar versiones nuevas
$origen = if ($Token) { $Repo -replace '^https://', "https://x-access-token:$Token@" } else { $Repo }
if (Test-Path (Join-Path $Carpeta '.git')) {
  if ($Token) { git -C $Carpeta remote set-url origin $origen }
  git -C $Carpeta pull --ff-only
} else {
  git clone $origen $Carpeta
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo descargar el sistema. Si el repositorio es privado, pasa -Token con un token de solo lectura.' }
}
Set-Location $Carpeta
npm ci --omit=dev --no-audit --no-fund
if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) { npm install -g pm2; Refrescar-Path }

Paso 'Configuración (.env)'
$envFile = Join-Path $Carpeta '.env'
if (-not (Test-Path $envFile)) {
  @"
# Configuración de esta instalación de GastroManager ($Cliente). Ver docs/INSTALACION.md
PORT=$Puerto
BACKUPS_CONSERVAR=30
# Copia diaria fuera del local (Cloudflare R2 u otro S3): completar para activarla (docs/INSTALACION.md)
BACKUP_S3_ENDPOINT=
BACKUP_S3_BUCKET=
BACKUP_S3_KEY_ID=
BACKUP_S3_SECRET=
BACKUP_S3_PREFIJO=$Cliente
# Monitoreo (healthchecks.io u otro): URL del check de este local
MONITOREO_URL=
# Dirección pública HTTPS (la da el túnel de Cloudflare: scripts\windows\tunel.ps1)
BASE_URL=
"@ | Set-Content -Path $envFile -Encoding UTF8
  Write-Host "Creado $envFile (completar copias en la nube y monitoreo)."
} else { Write-Host '.env ya existe: no se toca.' }

Paso 'Base de datos'
if (-not (Test-Path (Join-Path $Carpeta 'data\gastromanager.db'))) { npm run init-db } else { Write-Host 'La base ya existe: no se toca.' }

Paso 'Servidor con pm2'
pm2 delete gastromanager 2>$null | Out-Null
pm2 start ecosystem.config.js --env production
pm2 save

Paso 'Inicio automático con Windows'
$bat = Join-Path $Carpeta 'iniciar-gastromanager.bat'
$accion = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$bat`""
$cuando = New-ScheduledTaskTrigger -AtLogOn
$ajustes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName 'GastroManager' -Action $accion -Trigger $cuando -Settings $ajustes -RunLevel Highest -Force | Out-Null

if ($ActualizacionAutomatica) {
  Paso 'Actualización automática diaria (05:00)'
  $accionAct = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c cd /d `"$Carpeta`" && npm run actualizar" -WorkingDirectory $Carpeta
  Register-ScheduledTask -TaskName 'GastroManager - actualizar' -Action $accionAct -Trigger (New-ScheduledTaskTrigger -Daily -At 5am) -Settings $ajustes -RunLevel Highest -Force | Out-Null
}

Paso "Firewall: puerto $Puerto para tablets y celulares de la red del local"
if (-not (Get-NetFirewallRule -DisplayName 'GastroManager' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName 'GastroManager' -Direction Inbound -Protocol TCP -LocalPort $Puerto -Action Allow -Profile Private,Domain | Out-Null
}

$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -First 1).IPAddress
Write-Host "`nListo. GastroManager está corriendo." -ForegroundColor Green
Write-Host "  En esta PC:            http://localhost:$Puerto"
Write-Host "  Tablets y celulares:   http://${ip}:$Puerto  (misma red WiFi)"
Write-Host '  Usuario inicial:       admin@gastromanager.com / admin123 (pide cambiarla al entrar)'
Write-Host '  Siguiente paso:        completar .env y ejecutar scripts\windows\tunel.ps1 para el acceso remoto'
Write-Host '  Conviene fijar la IP de esta PC en el router para que las tablets la encuentren siempre.'
