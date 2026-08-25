# ==========================================================
#  Crypto Radar - arranque completo en Windows
#
#  Levanta las cuatro piezas que hacen falta, en orden, y solo las que no
#  esten ya funcionando. Se puede ejecutar las veces que haga falta: si algo
#  ya esta en marcha, lo deja como esta.
#
#    1. PostgreSQL      (base de datos, puerto 5433)
#    2. Radar           (la aplicacion, puerto 3000)
#    3. Nginx           (intermediario, puerto 8080)
#    4. Tunel publico   (opcional, enlace de internet)
#
#  Uso manual:
#      powershell -ExecutionPolicy Bypass -File scripts\arranque-windows.ps1
#
#  Sin tunel publico:
#      ... -File scripts\arranque-windows.ps1 -SinTunel
# ==========================================================

param(
    [switch]$SinTunel
)

$ErrorActionPreference = 'Continue'

# --- Rutas ----------------------------------------------------------------
$Proyecto    = Split-Path -Parent $PSScriptRoot
$PgBin       = 'C:\tools\pg\pgsql\bin'
$PgData      = 'C:\tools\pgdata'
$NginxDir    = 'C:\tools\nginx-1.28.0'
$NginxConf   = Join-Path $Proyecto 'nginx\local.windows.conf'
$Cloudflared = 'C:\tools\cloudflared.exe'
$TunelLog    = 'C:\tools\tunnel.log'
$UrlPublica  = 'C:\tools\url-publica.txt'
$Registro    = Join-Path $Proyecto 'logs'

if (-not (Test-Path $Registro)) { New-Item -ItemType Directory -Path $Registro -Force | Out-Null }
$Bitacora = Join-Path $Registro ('arranque-' + (Get-Date -Format 'yyyy-MM-dd') + '.log')

function Nota($texto, $color = 'Gray') {
    $linea = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $texto
    Write-Host $linea -ForegroundColor $color
    Add-Content -Path $Bitacora -Value $linea -ErrorAction SilentlyContinue
}

function PuertoEnUso($puerto) {
    $c = Get-NetTCPConnection -LocalPort $puerto -State Listen -ErrorAction SilentlyContinue
    return $null -ne $c
}

Nota "=== Arranque del Crypto Radar ===" 'Cyan'

# --- 0. Que Windows no suspenda el equipo ---------------------------------
powercfg /change standby-timeout-ac 0   2>$null
powercfg /change hibernate-timeout-ac 0 2>$null
powercfg /change disk-timeout-ac 0      2>$null
Nota "Suspension desactivada" 'Green'

# --- 1. PostgreSQL --------------------------------------------------------
if (PuertoEnUso 5433) {
    Nota "PostgreSQL ya estaba en marcha" 'Green'
} else {
    Nota "Arrancando PostgreSQL..." 'Yellow'
    & "$PgBin\pg_ctl.exe" -D $PgData `
        -o "-p 5433 -c listen_addresses=127.0.0.1" `
        -l "$PgData\server.log" -w start 2>&1 | Out-Null

    $intentos = 0
    while (-not (PuertoEnUso 5433) -and $intentos -lt 30) {
        Start-Sleep -Seconds 2; $intentos++
    }
    if (PuertoEnUso 5433) { Nota "PostgreSQL listo" 'Green' }
    else { Nota "PostgreSQL NO arranco. Revisa $PgData\server.log" 'Red'; exit 1 }
}

# --- 2. El radar ----------------------------------------------------------
if (PuertoEnUso 3000) {
    Nota "El radar ya estaba en marcha" 'Green'
} else {
    Nota "Arrancando el radar..." 'Yellow'
    # Se lanza con el supervisor, que lo reinicia solo si se cae.
    Start-Process -FilePath 'powershell.exe' `
        -ArgumentList @(
            '-ExecutionPolicy','Bypass',
            '-WindowStyle','Hidden',
            '-File', (Join-Path $PSScriptRoot 'ejecutar-continuo.ps1')
        ) `
        -WorkingDirectory $Proyecto -WindowStyle Hidden

    $intentos = 0
    while (-not (PuertoEnUso 3000) -and $intentos -lt 45) {
        Start-Sleep -Seconds 2; $intentos++
    }
    if (PuertoEnUso 3000) { Nota "Radar listo en el puerto 3000" 'Green' }
    else { Nota "El radar no responde todavia; mira la carpeta logs" 'Red' }
}

# --- 3. Nginx -------------------------------------------------------------
if (PuertoEnUso 8080) {
    Nota "Nginx ya estaba en marcha" 'Green'
} else {
    Nota "Arrancando Nginx..." 'Yellow'
    & "$NginxDir\nginx.exe" -p "$NginxDir\" -c $NginxConf -t 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0 -or $true) {
        Start-Process -FilePath "$NginxDir\nginx.exe" `
            -ArgumentList @('-p', "$NginxDir\", '-c', $NginxConf) `
            -WorkingDirectory $NginxDir -WindowStyle Hidden
        Start-Sleep -Seconds 3
        if (PuertoEnUso 8080) { Nota "Nginx listo en el puerto 8080" 'Green' }
        else { Nota "Nginx no escucha. Mira $NginxDir\logs\error.log" 'Red' }
    }
}

# --- 4. Tunel publico -----------------------------------------------------
# OJO: el tunel rapido genera una direccion NUEVA cada vez. La anterior deja
# de funcionar para siempre, asi que hay que reenviarla a quien la use.
if ($SinTunel) {
    Nota "Tunel publico omitido (-SinTunel)" 'Gray'
} elseif (Get-Process cloudflared -ErrorAction SilentlyContinue) {
    Nota "El tunel ya estaba en marcha" 'Green'
} else {
    Nota "Abriendo tunel publico..." 'Yellow'
    if (Test-Path $TunelLog) { Remove-Item -LiteralPath $TunelLog -Force -ErrorAction SilentlyContinue }

    Start-Process -FilePath $Cloudflared `
        -ArgumentList @('tunnel','--url','http://127.0.0.1:8080','--logfile',$TunelLog,'--loglevel','info') `
        -WindowStyle Hidden

    $url = $null
    for ($i = 0; $i -lt 30 -and -not $url; $i++) {
        Start-Sleep -Seconds 2
        if (Test-Path $TunelLog) {
            $m = Select-String -Path $TunelLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue |
                 Select-Object -Last 1
            if ($m) { $url = $m.Matches[0].Value }
        }
    }

    if ($url) {
        Set-Content -Path $UrlPublica -Value $url -Encoding ascii
        Nota "Tunel listo: $url" 'Green'
        Nota "ATENCION: esta direccion es NUEVA. La anterior ya no funciona." 'Yellow'
    } else {
        Nota "El tunel no dio direccion. Mira $TunelLog" 'Red'
    }
}

# --- Resumen --------------------------------------------------------------
Nota "" 'Gray'
Nota "--- Estado final ---" 'Cyan'
Nota ("  PostgreSQL : " + $(if (PuertoEnUso 5433) { 'en marcha' } else { 'PARADO' }))
Nota ("  Radar      : " + $(if (PuertoEnUso 3000) { 'en marcha' } else { 'PARADO' }))
Nota ("  Nginx      : " + $(if (PuertoEnUso 8080) { 'en marcha' } else { 'PARADO' }))
Nota ("  Panel local: http://localhost:8080")
if (Test-Path $UrlPublica) { Nota ("  Enlace publico: " + (Get-Content $UrlPublica -Raw).Trim()) }
