# GastroManager - acceso remoto seguro con Cloudflare Tunnel (gratis, sin abrir puertos del router)
# Antes: en el panel de Cloudflare (Zero Trust > Networks > Tunnels) crear un túnel para este local,
# agregarle el "Public hostname" (ej. la-buena-mesa.tudominio.com.ar -> http://localhost:3000)
# y copiar el token que muestra. Después, en PowerShell COMO ADMINISTRADOR:
#   powershell -ExecutionPolicy Bypass -File tunel.ps1 -Token "eyJ..." -Direccion "https://la-buena-mesa.tudominio.com.ar"
param(
  [Parameter(Mandatory = $true)][string]$Token,
  [Parameter(Mandatory = $true)][string]$Direccion,
  [string]$Carpeta = 'C:\GastroManager'
)
$ErrorActionPreference = 'Stop'
if ($Direccion -notmatch '^https://[a-z0-9.-]+$') { throw 'La dirección va completa y sin barra final, ej. https://la-buena-mesa.tudominio.com.ar' }

if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
  winget install --id Cloudflare.cloudflared -e --accept-package-agreements --accept-source-agreements
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
# Servicio de Windows: arranca solo con la PC aunque nadie inicie sesión
cloudflared service install $Token

# BASE_URL: la usan Mercado Pago y Tienda Nube para avisar pagos y pedidos
$envFile = Join-Path $Carpeta '.env'
$lineas = if (Test-Path $envFile) { Get-Content $envFile } else { @() }
$lineas = @($lineas | Where-Object { $_ -notmatch '^BASE_URL=' }) + "BASE_URL=$Direccion"
$lineas | Set-Content -Path $envFile -Encoding UTF8
pm2 restart gastromanager --update-env

Write-Host "`nListo: $Direccion apunta a este local." -ForegroundColor Green
Write-Host 'Pruébalo desde el celular con los datos móviles (no el WiFi del local).'
