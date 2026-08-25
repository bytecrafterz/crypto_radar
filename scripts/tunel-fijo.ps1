# ==========================================================
#  Crypto Radar - tunel con direccion FIJA
#
#  EL PROBLEMA QUE RESUELVE
#  El tunel rapido (cloudflared tunnel --url ...) genera una direccion
#  aleatoria nueva cada vez que arranca, y la anterior muere para siempre.
#  Eso obliga a reenviarle el enlace al cliente cada vez que se reinicia el
#  ordenador, y ademas una direccion como
#  "obtaining-deviation-herb-policies.trycloudflare.com" parece un enlace
#  fraudulento, que es justo lo que no interesa.
#
#  Un tunel CON NOMBRE apunta siempre al mismo dominio propio. No cambia
#  nunca, ni al reiniciar ni al apagar. Y el mismo dominio sirve luego para
#  el servidor definitivo: se cambia a donde apunta y el cliente no se
#  entera.
#
#  ANTES DE EJECUTAR ESTO HACEN FALTA DOS COSAS (ver el final del fichero):
#    1. Un dominio anadido a una cuenta de Cloudflare (gratuita)
#    2. Haber ejecutado una vez:  cloudflared tunnel login
#
#  USO:
#      powershell -ExecutionPolicy Bypass -File scripts\tunel-fijo.ps1 -Dominio radar.tudominio.com
# ==========================================================

param(
    [Parameter(Mandatory = $true)]
    [string]$Dominio,

    [string]$Nombre = 'crypto-radar',
    [int]$Puerto = 8080
)

$ErrorActionPreference = 'Stop'
$Cloudflared = 'C:\tools\cloudflared.exe'
$CarpetaCf   = Join-Path $env:USERPROFILE '.cloudflared'

function Nota($t, $c = 'Gray') { Write-Host ("  " + $t) -ForegroundColor $c }

Write-Host ""
Write-Host "=== Tunel fijo para $Dominio ===" -ForegroundColor Cyan
Write-Host ""

# --- 1. Comprobar que hay sesion iniciada --------------------------------
if (-not (Test-Path (Join-Path $CarpetaCf 'cert.pem'))) {
    Nota "FALTA EL PASO PREVIO." 'Red'
    Nota ""
    Nota "Ejecuta primero esto, que abre el navegador para identificarte:" 'Yellow'
    Nota ""
    Nota "    C:\tools\cloudflared.exe tunnel login" 'White'
    Nota ""
    Nota "Elige tu dominio en la pagina que se abre. Luego vuelve a lanzar este script."
    exit 1
}
Nota "Sesion de Cloudflare encontrada" 'Green'

# --- 2. Crear el tunel (o reutilizarlo si ya existe) ----------------------
$existentes = & $Cloudflared tunnel list 2>$null | Out-String
if ($existentes -match [regex]::Escape($Nombre)) {
    Nota "El tunel '$Nombre' ya existia, se reutiliza" 'Green'
} else {
    Nota "Creando el tunel '$Nombre'..." 'Yellow'
    & $Cloudflared tunnel create $Nombre | Out-Null
    Nota "Tunel creado" 'Green'
}

# El identificador hace falta para el fichero de configuracion.
$linea = (& $Cloudflared tunnel list 2>$null | Select-String $Nombre | Select-Object -First 1).ToString()
$uuid  = ($linea -split '\s+')[0]
if (-not $uuid) { Nota "No se pudo leer el identificador del tunel" 'Red'; exit 1 }
Nota "Identificador: $uuid"

# --- 3. Apuntar el dominio al tunel ---------------------------------------
Nota "Apuntando $Dominio al tunel..." 'Yellow'
try {
    & $Cloudflared tunnel route dns $Nombre $Dominio 2>&1 | Out-Null
    Nota "DNS configurado" 'Green'
} catch {
    Nota "El DNS ya estaba configurado, se continua" 'Gray'
}

# --- 4. Fichero de configuracion ------------------------------------------
$credenciales = Join-Path $CarpetaCf "$uuid.json"
$config = @"
# Configuracion del tunel fijo del Crypto Radar.
# Generado por scripts\tunel-fijo.ps1
tunnel: $uuid
credentials-file: $credenciales

ingress:
  - hostname: $Dominio
    service: http://127.0.0.1:$Puerto
  # Regla final obligatoria: todo lo que no coincida se rechaza.
  - service: http_status:404
"@
$rutaConfig = Join-Path $CarpetaCf 'config.yml'
Set-Content -Path $rutaConfig -Value $config -Encoding ascii
Nota "Configuracion escrita en $rutaConfig" 'Green'

# --- 5. Dejarlo como servicio de Windows ----------------------------------
# Asi arranca con el ordenador y NO depende de que alguien inicie sesion,
# que es justo el fallo que tiene ahora el tunel rapido.
Nota ""
Nota "Instalando como servicio de Windows..." 'Yellow'
$svc = Get-Service -Name 'cloudflared' -ErrorAction SilentlyContinue
if ($svc) {
    Nota "El servicio ya existia. Reinstalando con la configuracion nueva..." 'Gray'
    & $Cloudflared service uninstall 2>&1 | Out-Null
    Start-Sleep -Seconds 2
}
& $Cloudflared service install 2>&1 | Out-Null
Start-Sleep -Seconds 3
$svc = Get-Service -Name 'cloudflared' -ErrorAction SilentlyContinue
if ($svc) {
    Set-Service -Name 'cloudflared' -StartupType Automatic
    if ($svc.Status -ne 'Running') { Start-Service -Name 'cloudflared' }
    Nota "Servicio instalado y en marcha" 'Green'
} else {
    Nota "No se pudo instalar el servicio. Hace falta PowerShell como Administrador." 'Red'
    Nota "Mientras tanto puedes lanzarlo a mano con:" 'Yellow'
    Nota "    C:\tools\cloudflared.exe tunnel run $Nombre" 'White'
}

Write-Host ""
Write-Host "=== LISTO ===" -ForegroundColor Cyan
Nota ""
Nota "Direccion fija:  https://$Dominio" 'Green'
Nota ""
Nota "Esta direccion YA NO CAMBIA. Ni al reiniciar, ni al apagar."
Nota "Cuando montes el servidor, se cambia a donde apunta y el cliente"
Nota "sigue usando el mismo enlace sin enterarse."
Nota ""
Nota "Acuerdate de quitar el tunel rapido del arranque:" 'Yellow'
Nota "  en scripts\arranque-windows.ps1 usa el parametro -SinTunel"
Write-Host ""
