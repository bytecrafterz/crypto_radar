# ==========================================================
#  Reinicio limpio del radar
#
#  POR QUE EXISTE ESTO
#  Es facil acabar con varias copias del radar a la vez: el supervisor
#  relanza el proceso, la tarea Vigilante relanza el supervisor, y si se
#  lanza algo a mano encima quedan instancias duplicadas peleandose por el
#  puerto 3000. Solo una gana; las demas se caen y se reintentan en bucle.
#
#  Ademas, cada supervisor lee el fichero .env UNA VEZ al arrancar y le pasa
#  esas variables al proceso hijo. Si se cambia una contrasena en .env, no
#  basta con reiniciar el radar: hay que reiniciar el supervisor, o seguira
#  entregando los valores viejos.
#
#  Este script deja exactamente un supervisor y un radar, con el .env actual.
#
#  USO:
#      powershell -ExecutionPolicy Bypass -File scripts\reiniciar-limpio.ps1
# ==========================================================

$ErrorActionPreference = 'Continue'
$Proyecto = Split-Path -Parent $PSScriptRoot

function Nota($t, $c = 'Gray') { Write-Host "  $t" -ForegroundColor $c }

function Copias {
    $radar = @(Get-CimInstance Win32_Process |
        Where-Object { $_.CommandLine -like '*dist/index.js*' })
    $sup = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
        Where-Object { $_.CommandLine -like '*ejecutar-continuo*' -or $_.CommandLine -like '*arranque-windows*' })
    return @{ Radar = $radar; Supervisor = $sup }
}

Write-Host ""
Write-Host "=== Reinicio limpio del radar ===" -ForegroundColor Cyan

$c = Copias
Nota "Ahora mismo: $($c.Radar.Count) radar, $($c.Supervisor.Count) supervisor"

# --- 1. Que la tarea Vigilante no relance nada mientras limpiamos --------
$vigilante = Get-ScheduledTask -TaskName 'CryptoRadar-Vigilante' -ErrorAction SilentlyContinue
$estabaActiva = $vigilante -and $vigilante.State -ne 'Disabled'
if ($estabaActiva) {
    Disable-ScheduledTask -TaskName 'CryptoRadar-Vigilante' -ErrorAction SilentlyContinue | Out-Null
    Nota "Vigilante desactivado durante la limpieza"
}

# --- 2. Parar primero los supervisores, luego los radares ---------------
# El orden importa: si se para el radar primero, su supervisor lo relanza
# inmediatamente y no se termina nunca.
foreach ($vuelta in 1..4) {
    $c = Copias
    if ($c.Radar.Count -eq 0 -and $c.Supervisor.Count -eq 0) { break }

    foreach ($p in $c.Supervisor) {
        try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop } catch { }
    }
    Start-Sleep -Seconds 2
    foreach ($p in $c.Radar) {
        try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop } catch { }
    }
    Start-Sleep -Seconds 3
}

$c = Copias
if ($c.Radar.Count -gt 0 -or $c.Supervisor.Count -gt 0) {
    Nota "Quedan $($c.Radar.Count) radar y $($c.Supervisor.Count) supervisor sin parar." 'Yellow'
    Nota "Suelen ser procesos de una sesion con mas permisos. No impiden seguir." 'Yellow'
} else {
    Nota "Todo parado" 'Green'
}

# --- 3. Arrancar uno solo ------------------------------------------------
Nota "Arrancando una unica instancia..."
Start-Process -FilePath 'powershell.exe' `
    -ArgumentList @('-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-NoProfile',
                    '-File', (Join-Path $PSScriptRoot 'ejecutar-continuo.ps1')) `
    -WorkingDirectory $Proyecto -WindowStyle Hidden

$listo = $false
foreach ($i in 1..30) {
    Start-Sleep -Seconds 3
    if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) {
        $listo = $true
        Nota "Radar escuchando tras unos $($i*3) segundos" 'Green'
        break
    }
}
if (-not $listo) { Nota "El radar no ha levantado. Mira la carpeta logs." 'Red' }

# --- 4. Devolver el Vigilante a como estaba -----------------------------
if ($estabaActiva) {
    Enable-ScheduledTask -TaskName 'CryptoRadar-Vigilante' -ErrorAction SilentlyContinue | Out-Null
    Nota "Vigilante reactivado"
}

# --- 5. Comprobacion -----------------------------------------------------
Start-Sleep -Seconds 3
$c = Copias
Nota ""
Nota "Resultado: $($c.Radar.Count) radar, $($c.Supervisor.Count) supervisor"
try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3000/salud' -TimeoutSec 20 -UseBasicParsing
    Nota "Salud: $($r.Content)" 'Green'
} catch {
    Nota "El radar no responde todavia: $($_.Exception.Message)" 'Red'
}
Write-Host ""
