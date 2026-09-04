# ============================================================================
#  Copia de seguridad de la base de datos
#
#    powershell -ExecutionPolicy Bypass -File scripts\copia-seguridad.ps1
#
#  POR QUE ESTE Y NO scripts/backup.sh
#  Aquel esta escrito para Docker sobre Linux: busca un contenedor llamado
#  radar-db y escribe en /opt/backups. En esta maquina PostgreSQL corre
#  como proceso suelto en Windows, asi que nunca pudo ejecutarse. Un script
#  de copias que no se puede ejecutar es peor que no tener ninguno, porque
#  da la impresion de que el asunto esta resuelto.
#
#  QUE HACE
#    1. Vuelca la base de datos en formato comprimido
#    2. COMPRUEBA que el volcado se puede leer, no solo que pesa algo
#    3. Borra las copias mas viejas de 14 dias
#    4. Deja constancia en logs/copias.log
#
#  El paso 2 es el que convierte un fichero en una copia de seguridad. Un
#  volcado que nadie ha intentado leer es una suposicion.
# ============================================================================

$ErrorActionPreference = 'Stop'

$Proyecto = Split-Path -Parent $PSScriptRoot
$PgBin    = 'C:\tools\pg\pgsql\bin'
$Destino  = Join-Path $Proyecto 'respaldos\bd'
$Registro = Join-Path $Proyecto 'logs\copias.log'
$Dias     = 14

function Apunte($t) {
    $linea = "$(Get-Date -Format s)  $t"
    $linea | Add-Content $Registro -ErrorAction SilentlyContinue
    Write-Host "  $t"
}

New-Item -ItemType Directory -Force $Destino | Out-Null
New-Item -ItemType Directory -Force (Split-Path -Parent $Registro) | Out-Null

# La contrasena sale del .env, para no repetirla en dos sitios.
$envPath = Join-Path $Proyecto '.env'
$dbUrl = (Get-Content $envPath | Where-Object { $_ -match '^DATABASE_URL=' }) -replace '^DATABASE_URL=', ''
if (-not $dbUrl) { Apunte 'ERROR: no hay DATABASE_URL en .env'; exit 1 }

# postgres://usuario:contrasena@host:puerto/base
if ($dbUrl -notmatch '^postgres(?:ql)?://([^:]+):([^@]+)@([^:]+):(\d+)/(.+)$') {
    Apunte 'ERROR: no se pudo interpretar DATABASE_URL'
    exit 1
}
$usuario = $Matches[1]
$env:PGPASSWORD = $Matches[2]
$hostBd  = $Matches[3]
$puerto  = $Matches[4]
$base    = $Matches[5] -replace '\?.*$', ''

$fecha   = Get-Date -Format 'yyyyMMdd-HHmm'
$fichero = Join-Path $Destino "radar-$fecha.dump"

try {
    # Formato personalizado: comprime solo y permite restaurar tablas
    # sueltas sin tener que tragarse el volcado entero.
    & "$PgBin\pg_dump.exe" -h $hostBd -p $puerto -U $usuario -d $base `
        -Fc -Z 6 -f $fichero 2>$null

    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $fichero)) {
        Apunte "ERROR: pg_dump fallo con codigo $LASTEXITCODE"
        exit 1
    }

    $mb = [math]::Round((Get-Item $fichero).Length / 1MB, 1)

    # --- La comprobacion que hace que esto sea una copia de verdad -------
    # pg_restore --list lee el indice del volcado. Si el fichero esta
    # truncado o corrupto, falla aqui y no dentro de seis meses cuando
    # haga falta de verdad.
    $tablas = (& "$PgBin\pg_restore.exe" --list $fichero 2>$null | Select-String 'TABLE DATA').Count

    if ($LASTEXITCODE -ne 0 -or $tablas -lt 5) {
        Apunte "ERROR: el volcado no se puede leer o esta incompleto, solo $tablas tablas"
        Remove-Item $fichero -Force -ErrorAction SilentlyContinue
        exit 1
    }

    Apunte "Copia hecha: radar-$fecha.dump  $mb MB  $tablas tablas  verificada"
}
catch {
    Apunte "ERROR: $($_.Exception.Message)"
    exit 1
}
finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}

# --- Limpieza de las viejas ------------------------------------------------
$limite = (Get-Date).AddDays(-$Dias)
$viejas = Get-ChildItem "$Destino\radar-*.dump" | Where-Object { $_.LastWriteTime -lt $limite }
foreach ($v in $viejas) {
    Remove-Item $v.FullName -Force -ErrorAction SilentlyContinue
    Apunte "Borrada por antigua: $($v.Name)"
}

$total = (Get-ChildItem "$Destino\radar-*.dump" | Measure-Object -Property Length -Sum)
Apunte "Quedan $($total.Count) copias, $([math]::Round($total.Sum / 1MB, 1)) MB en total"
