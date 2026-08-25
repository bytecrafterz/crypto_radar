# ==========================================================
#  Crypto Radar - ejecucion continua en Windows
#
#  Mantiene el sistema funcionando sin interrupciones: si el proceso se cae
#  o Windows lo cierra, lo vuelve a arrancar solo.
#
#  Esto importa mas de lo que parece. Las mediciones a 5 min, 15 min, 1 h,
#  6 h y 24 h se toman EN SU MOMENTO: si el sistema esta parado cuando toca
#  una de ellas, ese dato se pierde para siempre y no se puede reconstruir.
#  Ademas los huecos no son aleatorios (suelen coincidir con la noche), asi
#  que sesgan el analisis posterior.
#
#  Arrancar:
#      powershell -ExecutionPolicy Bypass -File scripts\ejecutar-continuo.ps1
#
#  Parar: cerrar la ventana, o Ctrl+C.
# ==========================================================

$ErrorActionPreference = 'Continue'

# --- Configuracion --------------------------------------------------------
$Proyecto = Split-Path -Parent $PSScriptRoot
$Registro = Join-Path $Proyecto 'logs'
$EsperaReinicio = 15          # segundos antes de reintentar tras una caida

if (-not (Test-Path $Registro)) { New-Item -ItemType Directory -Path $Registro -Force | Out-Null }

Set-Location $Proyecto
$env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')

# --- Variables de entorno -------------------------------------------------
# Se leen del fichero .env si existe; si no, hay que definirlas antes.
if (Test-Path (Join-Path $Proyecto '.env')) {
    Get-Content (Join-Path $Proyecto '.env') | ForEach-Object {
        $linea = $_.Trim()
        if ($linea -and -not $linea.StartsWith('#') -and $linea.Contains('=')) {
            $i = $linea.IndexOf('=')
            $clave = $linea.Substring(0, $i).Trim()
            $valor = $linea.Substring($i + 1).Trim().Trim('"').Trim("'")
            if ($valor) { Set-Item -Path "env:$clave" -Value $valor }
        }
    }
    Write-Host "Variables cargadas desde .env" -ForegroundColor Green
}

# Comprobacion minima: sin base de datos no arranca.
if (-not $env:DATABASE_URL) {
    Write-Host "FALTA DATABASE_URL. Definela en .env o antes de ejecutar este script." -ForegroundColor Red
    exit 1
}

# --- Evitar que Windows suspenda el equipo --------------------------------
# El esquema de energia puede cambiar; se fuerza a no suspender nunca.
powercfg /change standby-timeout-ac 0  2>$null
powercfg /change hibernate-timeout-ac 0 2>$null
powercfg /change disk-timeout-ac 0      2>$null
Write-Host "Suspension desactivada mientras dure la ejecucion" -ForegroundColor Green

# --- Bucle de supervision -------------------------------------------------
$inicio = Get-Date
$reinicios = 0

Write-Host ""
Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host " Crypto Radar - ejecucion continua" -ForegroundColor Cyan
Write-Host " Inicio: $($inicio.ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor Cyan
Write-Host " Registro: $Registro" -ForegroundColor Cyan
Write-Host " Para parar: cierra esta ventana" -ForegroundColor Cyan
Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host ""

while ($true) {
    $marca = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
    $fichero = Join-Path $Registro "radar-$marca.log"

    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] arrancando el radar..." -ForegroundColor Yellow

    # Se ejecuta en primer plano: cuando termina, el bucle lo vuelve a lanzar.
    & node dist/index.js 2>&1 | Tee-Object -FilePath $fichero

    $reinicios++
    $enMarcha = (Get-Date) - $inicio

    Write-Host ""
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] el proceso ha terminado." -ForegroundColor Red
    Write-Host "  Tiempo total desde el inicio : $([math]::Round($enMarcha.TotalHours,1)) horas"
    Write-Host "  Reinicios acumulados         : $reinicios"
    Write-Host "  Registro de esta sesion      : $fichero"
    Write-Host "  Reintentando en $EsperaReinicio segundos..." -ForegroundColor Yellow
    Write-Host ""

    # Limpieza: conservar solo los 20 registros mas recientes.
    Get-ChildItem $Registro -Filter 'radar-*.log' |
        Sort-Object LastWriteTime -Descending |
        Select-Object -Skip 20 |
        Remove-Item -Force -ErrorAction SilentlyContinue

    Start-Sleep -Seconds $EsperaReinicio
}
