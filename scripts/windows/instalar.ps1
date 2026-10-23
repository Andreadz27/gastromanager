# Morfi (antes GastroManager) - instalador para Windows 10/11
# Ejecutar en PowerShell COMO ADMINISTRADOR, en la PC o mini PC del restaurante:
#   powershell -ExecutionPolicy Bypass -File instalar.ps1 -Cliente "la-buena-mesa" -Token "github_pat_..."
# -Token: token de GitHub de SOLO LECTURA para este repositorio (el repo es privado; ver docs/INSTALACION.md).
# Hace todo: Node.js y Git (con winget), descarga el sistema, crea la base, lo deja corriendo con pm2,
# lo arranca solo AL ENCENDER la PC (aunque nadie inicie sesión: si se corta la luz, vuelve solo),
# abre el puerto para las tablets de la red local y (opcional) programa la actualización automática de madrugada.
# Se puede volver a ejecutar: no borra datos ni pisa la configuración existente.
#
# PC DE REEMPLAZO (se rompió la del local), todo en un paso: la clave de las copias del gestor de contraseñas y los
# datos del bucket del local. Instala, baja la copia más nueva de la nube, la verifica y deja el local andando:
#   powershell -ExecutionPolicy Bypass -File instalar.ps1 -Cliente "la-buena-mesa" -Token "github_pat_..." -RestaurarDeLaNube `
#     -ClaveCopias "<64 caracteres>" -S3Endpoint "https://<cuenta>.r2.cloudflarestorage.com" -S3Bucket "gm-la-buena-mesa" `
#     -S3KeyId "<Access Key ID>" -S3Secret "<Secret Access Key>"
param(
  [Parameter(Mandatory = $true)][string]$Cliente,          # nombre corto del local: carpeta en la nube y en el monitoreo
  [string]$Carpeta,                                        # por defecto C:\Morfi (o C:\GastroManager si ya estaba instalado así)
  # Dirección de antes del cambio de nombre: GitHub la redirige si el repositorio se renombra, así sirve en los dos casos
  [string]$Repo = 'https://github.com/Andreadz27/gastromanager.git',
  [string]$Token,                                          # token de solo lectura (repositorio privado)
  [int]$Puerto = 3000,
  [switch]$ActualizacionAutomatica,                        # actualiza todos los días a las 05:00 (con copia y vuelta atrás)
  # Copias en la nube del local (también sirven sin -RestaurarDeLaNube, para dejarlas configuradas al instalar)
  [switch]$RestaurarDeLaNube,                              # PC de reemplazo: restaura la copia más nueva de la nube
  [string]$ClaveCopias,                                    # BACKUP_CLAVE del local (la del gestor de contraseñas)
  [string]$S3Endpoint,
  [string]$S3Bucket,
  [string]$S3KeyId,
  [string]$S3Secret
)
$ErrorActionPreference = 'Stop'
function Paso($t) { Write-Host "`n==> $t" -ForegroundColor Cyan }
function Refrescar-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }
# Los programas externos (git, npm, pm2) no cortan el script al fallar: hay que mirar el código de salida
function Revisar($que) { if ($LASTEXITCODE -ne 0) { throw "Falló: $que (código $LASTEXITCODE). Revisá el mensaje de arriba y volvé a ejecutar el instalador." } }
# Comando externo que puede escribir avisos en stderr sin que sea un error (en PowerShell 5.1 eso corta el script)
function Tolerante([scriptblock]$b) { $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; try { & $b 2>&1 | Out-Null } catch {} finally { $ErrorActionPreference = $prev } }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Abre PowerShell como Administrador y vuelve a ejecutar el instalador.' }
if ($Cliente -notmatch '^[a-z0-9][a-z0-9-]{1,40}$') { throw 'El nombre del cliente va en minúsculas, sin espacios ni acentos (ej. la-buena-mesa).' }
# Se revisa todo antes de instalar nada: a mitad de camino, con el local cerrado, no hay que descubrir que faltaba un dato
if ($ClaveCopias -and $ClaveCopias -notmatch '^[0-9a-fA-F]{64}$') { throw 'La clave de las copias tiene 64 caracteres (0-9 y a-f): copiala completa del gestor de contraseñas.' }
$datosNube = @($S3Endpoint, $S3Bucket, $S3KeyId, $S3Secret) | Where-Object { $_ }
if ($datosNube.Count -and $datosNube.Count -lt 4) { throw 'Para las copias en la nube van los cuatro datos: -S3Endpoint, -S3Bucket, -S3KeyId y -S3Secret.' }
if ($RestaurarDeLaNube -and (-not $ClaveCopias -or $datosNube.Count -lt 4)) {
  throw 'Para restaurar de la nube hacen falta -ClaveCopias y los cuatro datos -S3* del bucket del local (docs/INSTALACION.md, "PC de reemplazo").'
}

Paso 'Node.js y Git'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements; Revisar 'instalar Node.js'; Refrescar-Path }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { winget install --id Git.Git -e --accept-package-agreements --accept-source-agreements; Revisar 'instalar Git'; Refrescar-Path }
$major = [int]((node -v).TrimStart('v').Split('.')[0])
if ($major -lt 22) { throw "Morfi necesita Node.js 22 o superior (hay $(node -v)). Actualízalo: winget upgrade OpenJS.NodeJS.LTS" }

# Una instalación de antes del cambio de nombre sigue en su carpeta (no se arma otra al lado)
if (-not $Carpeta) { $Carpeta = if (Test-Path 'C:\GastroManager\.git') { 'C:\GastroManager' } else { 'C:\Morfi' } }

Paso "Sistema en $Carpeta"
# Con token, queda guardado en la dirección del repositorio de esta PC: así npm run actualizar puede bajar versiones nuevas
$origen = if ($Token) { $Repo -replace '^https://', "https://x-access-token:$Token@" } else { $Repo }
if (Test-Path (Join-Path $Carpeta '.git')) {
  if ($Token) { git -C $Carpeta remote set-url origin $origen; Revisar 'guardar el token' }
  git -C $Carpeta pull --ff-only; Revisar 'bajar la última versión (git pull)'
} else {
  git clone $origen $Carpeta
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo descargar el sistema. Si el repositorio es privado, pasa -Token con un token de solo lectura.' }
}
# Las tareas corren como SYSTEM y la carpeta es del administrador: git las rechaza por "dubious ownership" si no se autoriza
git config --system --add safe.directory ($Carpeta -replace '\\', '/'); Revisar 'autorizar la carpeta en git'
Set-Location $Carpeta

Paso 'pm2 compartido para toda la PC'
# Un solo PM2_HOME para la máquina: el pm2 que arranca con Windows (SYSTEM) y el del administrador son el mismo
# Si la PC ya tenía uno (instalación de antes del cambio de nombre), se mantiene: ahí están los procesos guardados
$pm2Home = [Environment]::GetEnvironmentVariable('PM2_HOME', 'Machine')
if (-not $pm2Home) { $pm2Home = Join-Path $env:ProgramData 'Morfi\pm2' }
if ($env:PM2_HOME -ne $pm2Home -and (Get-Command pm2 -ErrorAction SilentlyContinue)) {
  Tolerante { pm2 kill }   # el pm2 de una instalación anterior (en la carpeta del usuario): si no, quedarían dos
}
New-Item -ItemType Directory -Force -Path $pm2Home | Out-Null
[Environment]::SetEnvironmentVariable('PM2_HOME', $pm2Home, 'Machine')
$env:PM2_HOME = $pm2Home

npm ci --omit=dev --no-audit --no-fund; Revisar 'instalar dependencias (npm ci)'
if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) { npm install -g pm2; Revisar 'instalar pm2'; Refrescar-Path }
$pm2Cmd = (Get-Command pm2.cmd -ErrorAction SilentlyContinue).Source
if (-not $pm2Cmd) { throw 'No se encontró pm2.cmd después de instalarlo.' }

Paso 'Configuración (.env)'
$envFile = Join-Path $Carpeta '.env'
if (-not (Test-Path $envFile)) {
  @"
# Configuración de esta instalación de Morfi ($Cliente). Ver docs/INSTALACION.md
PORT=$Puerto
BACKUPS_CONSERVAR=30
# Copia diaria fuera del local (Cloudflare R2 u otro S3): completar para activarla (docs/INSTALACION.md, un bucket por cliente)
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
} else { Write-Host '.env ya existe: no se toca (salvo agregar la clave de las copias si falta).' }

# Pone CLAVE=valor en el .env (reemplaza la línea si ya estaba)
function Fijar-Env($clave, $valor) {
  $lineas = @(Get-Content $envFile | Where-Object { $_ -notmatch "^\s*$clave\s*=" })
  ($lineas + "$clave=$valor") | Set-Content -Path $envFile -Encoding UTF8
}
if ($datosNube.Count -eq 4) {
  Fijar-Env 'BACKUP_S3_ENDPOINT' $S3Endpoint
  Fijar-Env 'BACKUP_S3_BUCKET' $S3Bucket
  Fijar-Env 'BACKUP_S3_KEY_ID' $S3KeyId
  Fijar-Env 'BACKUP_S3_SECRET' $S3Secret
}
if ($ClaveCopias) {
  # Una clave distinta de la que ya tenía esta PC dejaría ilegibles sus copias de la nube: no se pisa sin revisar
  $actual = Select-String -Path $envFile -Pattern '^\s*BACKUP_CLAVE\s*=\s*([0-9a-fA-F]{64})' | Select-Object -First 1
  if ($actual -and $actual.Matches[0].Groups[1].Value.ToLower() -ne $ClaveCopias.ToLower()) {
    throw "Esta PC ya tiene otra clave de copias en $envFile. Revisá cuál es la correcta antes de cambiarla (las copias de la nube solo se abren con la suya)."
  }
  if (-not $actual) { Fijar-Env 'BACKUP_CLAVE' $ClaveCopias.ToLower() }
}

# Clave para cifrar las copias que se suben a la nube (AES-256). Sin ella no se pueden restaurar.
$claveNueva = $null
if (-not (Select-String -Path $envFile -Pattern '^\s*BACKUP_CLAVE\s*=\s*[0-9a-fA-F]{64}' -Quiet)) {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $claveNueva = -join ($bytes | ForEach-Object { $_.ToString('x2') })
  Add-Content -Path $envFile -Value "# Clave de cifrado de las copias en la nube. GUARDARLA FUERA DE ESTA PC: sin ella no se restauran.`r`nBACKUP_CLAVE=$claveNueva" -Encoding UTF8
}

Paso 'Base de datos'
$restaurada = $null
if ($RestaurarDeLaNube) {
  # El servidor no puede estar andando mientras se reemplaza la base (restaurar.js se niega)
  Tolerante { pm2 delete morfi }
  Tolerante { pm2 delete gastromanager }
  # Baja la copia más nueva, la descifra con la clave y la verifica antes de tocar nada (si había una base, la guarda aparte)
  # (en PowerShell 5.1, lo que el programa escribe en stderr cortaría el script antes de mostrar el motivo)
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $salida = node scripts\restaurar.js --nube --ultima 2>&1 | ForEach-Object { "$_" }
  $ErrorActionPreference = $prev
  $salida | ForEach-Object { Write-Host "  $_" }
  Revisar 'restaurar la copia de la nube (revisá la clave y los datos del bucket)'
  $restaurada = ($salida | Select-String 'Copia más nueva de la nube: (.+)').Matches | ForEach-Object { $_.Groups[1].Value } | Select-Object -First 1
} elseif (-not (Test-Path (Join-Path $Carpeta 'data\morfi.db')) -and -not (Test-Path (Join-Path $Carpeta 'data\gastromanager.db'))) {
  # data\morfi.db (si todavía se llama gastromanager.db, el sistema la renombra solo al arrancar)
  npm run init-db; Revisar 'crear la base de datos'
} else { Write-Host 'La base ya existe: no se toca.' }

Paso 'Rotación de logs de pm2'
# Sin esto, logs\pm2-*.log crece sin límite hasta llenar el disco
Tolerante { pm2 install pm2-logrotate }
Tolerante { pm2 set pm2-logrotate:max_size 10M }
Tolerante { pm2 set pm2-logrotate:retain 10 }

Paso 'Inicio automático al encender la PC'
$sistema = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$ajustes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 0)
$bat = Join-Path $Carpeta 'iniciar-morfi.bat'
# Tareas y regla del firewall con el nombre anterior: se reemplazan por las de Morfi (si no, arrancaría dos veces)
foreach ($vieja in 'GastroManager', 'GastroManager - actualizar') { Unregister-ScheduledTask -TaskName $vieja -Confirm:$false -ErrorAction SilentlyContinue }
Remove-NetFirewallRule -DisplayName 'GastroManager' -ErrorAction SilentlyContinue
$accion = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"`"$bat`" `"$pm2Cmd`"`"" -WorkingDirectory $Carpeta
Register-ScheduledTask -TaskName 'Morfi' -Action $accion -Trigger (New-ScheduledTaskTrigger -AtStartup) -Principal $sistema -Settings $ajustes -Force | Out-Null

Paso 'Servidor con pm2'
# Lo levanta la misma tarea del arranque: así el proceso queda en el pm2 de SYSTEM desde el primer día
Tolerante { pm2 delete gastromanager }
Tolerante { pm2 delete morfi }
Start-ScheduledTask -TaskName 'Morfi'
$arranco = $false
for ($i = 0; $i -lt 45 -and -not $arranco; $i++) {
  Start-Sleep -Seconds 2
  try { $arranco = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 "http://127.0.0.1:$Puerto/api/salud" -ErrorAction Stop).StatusCode -gt 0 } catch { $arranco = [bool]$_.Exception.Response }
}
if (-not $arranco) { throw "El servidor no respondió en el puerto $Puerto. Revisá $Carpeta\logs\pm2-error.log" }

if ($ActualizacionAutomatica) {
  Paso 'Actualización automática diaria (05:00)'
  # Sin "si se perdió la hora, ejecutar al prender": en un local que apaga la PC de noche, eso actualizaba
  # y reiniciaba en pleno servicio. Si a las 05:00 la PC estaba apagada, se actualiza la madrugada siguiente.
  $ajustesAct = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)
  $npmCmd = (Get-Command npm.cmd).Source
  $accionAct = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c cd /d `"$Carpeta`" && set `"PATH=$(Split-Path $pm2Cmd);%PATH%`" && `"$npmCmd`" run actualizar" -WorkingDirectory $Carpeta
  Register-ScheduledTask -TaskName 'Morfi - actualizar' -Action $accionAct -Trigger (New-ScheduledTaskTrigger -Daily -At 5am) -Principal $sistema -Settings $ajustesAct -Force | Out-Null
}

Paso "Firewall: puerto $Puerto para tablets y celulares de la red del local"
if (-not (Get-NetFirewallRule -DisplayName 'Morfi' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName 'Morfi' -Direction Inbound -Protocol TCP -LocalPort $Puerto -Action Allow -Profile Private,Domain | Out-Null
}

$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -First 1).IPAddress
Write-Host "`nListo. Morfi está corriendo." -ForegroundColor Green
Write-Host "  En esta PC:            http://localhost:$Puerto"
Write-Host "  Tablets y celulares:   http://${ip}:$Puerto  (misma red WiFi)"
if ($restaurada) {
  Write-Host "  Datos:                 copia de la nube $restaurada (los mismos usuarios y claves del local)" -ForegroundColor Green
  Write-Host '  Revisá en Pedidos que estén las ventas del último día: lo vendido después de esa copia no está.'
  Write-Host '  Los celulares y tablets entran por la IP de la PC vieja: dale a esta la misma IP en el router.'
} else {
  Write-Host '  Usuario inicial:       admin@morfi.local / admin123 (pide cambiarla al entrar: hacelo YA)'
}
Write-Host '  Conviene fijar la IP de esta PC en el router para que las tablets la encuentren siempre.'
Write-Host '  En el BIOS: "Restore on AC power loss" = Power On, para que la PC se prenda sola al volver la luz.'

# Lo que falta configurar: sin esto el local no está listo para entregar
$cfg = Get-Content $envFile -Raw
$faltan = @()
if ($cfg -notmatch '(?m)^\s*BACKUP_S3_ENDPOINT\s*=\s*\S') { $faltan += 'Copia en la nube (BACKUP_S3_*): sin ella, si se rompe el disco se pierde todo.' }
if ($cfg -notmatch '(?m)^\s*MONITOREO_URL\s*=\s*\S') { $faltan += 'Monitoreo (MONITOREO_URL): sin él, nadie se entera si el local se cae.' }
if ($cfg -notmatch '(?m)^\s*BASE_URL\s*=\s*\S') { $faltan += 'Acceso remoto (scripts\windows\tunel.ps1): lo necesitan Mercado Pago, WhatsApp y el dueño desde afuera.' }
if ($faltan.Count) {
  Write-Host "`nFALTA CONFIGURAR en $envFile (después: pm2 restart morfi --update-env):" -ForegroundColor Yellow
  $faltan | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
}
if ($claveNueva) {
  Write-Host "`nCLAVE DE LAS COPIAS EN LA NUBE ($Cliente):" -ForegroundColor Red
  Write-Host "  $claveNueva" -ForegroundColor Red
  Write-Host '  Guardala YA en tu gestor de contraseñas. Si se rompe esta PC, sin esta clave las copias de la nube no sirven.' -ForegroundColor Red
}
