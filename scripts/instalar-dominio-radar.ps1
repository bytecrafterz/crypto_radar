# ==========================================================
#  Crypto Radar - dominio fijo con HTTPS
#
#  Deja el panel en https://crypto-radar.duckdns.org con certificado de
#  Let's Encrypt. Sustituye al tunel temporal, cuya direccion cambiaba en
#  cada reinicio del servidor.
#
#  HAY QUE EJECUTARLO COMO ADMINISTRADOR:
#      powershell -ExecutionPolicy Bypass -File scripts\instalar-dominio-radar.ps1
#
#  SE PUEDE REPETIR SIN MIEDO: comprueba cada paso antes de hacerlo y no
#  repite lo que ya esta hecho.
#
#  CUIDADO CON EL PROYECTO IOT
#  En este mismo nginx vive edwin-iot-server.duckdns.org, que esta en
#  produccion. Este script NO toca su configuracion ni su certificado: el
#  radar usa ficheros .pem propios. Al terminar se comprueba que el IOT
#  sigue respondiendo, y si algo se rompe se restaura el respaldo.
# ==========================================================

$ErrorActionPreference = 'Stop'

$DOMINIO = 'crypto-radar.duckdns.org'
$NGINX   = 'C:\nginx'
$CONF    = "$NGINX\conf\nginx.conf"
$SSL     = "$NGINX\conf\ssl"
$WEBROOT = "$NGINX\html\acme"
$WACS    = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\simple-acme.simple-acme_Microsoft.Winget.Source_8wekyb3d8bbwe\wacs.exe"
$BLOQUE  = Join-Path (Split-Path -Parent $PSScriptRoot) 'nginx\duckdns-radar.conf'

function Paso($t)  { Write-Host "`n>> $t" -ForegroundColor Cyan }
function Ok($t)    { Write-Host "   $t"   -ForegroundColor Green }
function Aviso($t) { Write-Host "   $t"   -ForegroundColor Yellow }
function Malo($t)  { Write-Host "   $t"   -ForegroundColor Red }

function ReiniciarNginx {
    Get-Process nginx -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Start-Process -FilePath "$NGINX\nginx.exe" -ArgumentList '-p', "$NGINX\" -WorkingDirectory $NGINX -WindowStyle Hidden
    Start-Sleep -Seconds 3
}

# Ejecuta un programa externo y devuelve su salida y su codigo de salida.
#
# POR QUE HACE FALTA ESTO
# nginx y wacs escriben mensajes normales por el canal de errores. En
# Windows PowerShell 5.1, redirigir ese canal a la tuberia convierte cada
# linea en un error de tipo NativeCommandError, y con ErrorActionPreference
# en Stop el script se aborta aunque el programa haya terminado bien.
# Justo eso pasaba con el mensaje "syntax is ok" de nginx.
function Ejecutar {
    param([string]$Programa, [string[]]$Argumentos)
    $previo = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $salida = & $Programa @Argumentos 2>&1 | Out-String
        $codigo = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previo
    }
    return [PSCustomObject]@{ Salida = $salida; Codigo = $codigo }
}

# --- 0. Comprobar que somos administrador --------------------------------
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$esAdmin = (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
              [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $esAdmin) {
    Malo "Hay que ejecutar este script como Administrador."
    Malo "Abre PowerShell con boton derecho, Ejecutar como administrador."
    exit 1
}
Ok "Ejecutando como Administrador"

# --- 1. Respaldo ----------------------------------------------------------
Paso "Respaldo de la configuracion de nginx"
$sello    = Get-Date -Format 'yyyyMMdd-HHmmss'
$respaldo = "$CONF.bak-$sello"
Copy-Item $CONF $respaldo -Force
Ok "Guardado en $respaldo"

function Restaurar($motivo) {
    Malo $motivo
    Copy-Item $respaldo $CONF -Force
    Malo "Configuracion restaurada desde el respaldo."
    ReiniciarNginx
    exit 1
}

# --- 2. El DNS apunta a este servidor? ------------------------------------
Paso "Comprobando el DNS de $DOMINIO"
$miIp = Invoke-RestMethod -Uri 'https://api.ipify.org' -TimeoutSec 20
try {
    $dns = (Resolve-DnsName $DOMINIO -Type A -ErrorAction Stop | Select-Object -First 1).IPAddress
} catch {
    Malo "$DOMINIO no resuelve. Crealo en duckdns.org apuntando a $miIp"
    exit 1
}
if ($dns -ne $miIp) {
    Malo "$DOMINIO apunta a $dns pero este servidor es $miIp"
    exit 1
}
Ok "$DOMINIO apunta a $dns (correcto)"

# --- 3. nginx sirviendo el reto ACME --------------------------------------
Paso "Preparando nginx para la validacion"
if (-not (Select-String -Path $CONF -Pattern ([regex]::Escape($DOMINIO)) -Quiet)) {
    Malo "Falta el bloque de puerto 80 para $DOMINIO en $CONF"
    exit 1
}
New-Item -ItemType Directory -Path "$WEBROOT\.well-known\acme-challenge" -Force | Out-Null

$prueba = Ejecutar "$NGINX\nginx.exe" @('-p', "$NGINX\", '-t')
if ($prueba.Codigo -ne 0) {
    Write-Host $prueba.Salida
    Restaurar "La configuracion de nginx no es valida."
}
ReiniciarNginx
Ok "nginx reiniciado"

# Si esta prueba falla, la validacion de Let's Encrypt tambien fallaria.
$testigo = "$WEBROOT\.well-known\acme-challenge\prueba"
[System.IO.File]::WriteAllText($testigo, 'ok-radar', [System.Text.Encoding]::ASCII)
try {
    $r = Invoke-WebRequest -Uri "http://$DOMINIO/.well-known/acme-challenge/prueba" -TimeoutSec 25 -UseBasicParsing
    if ($r.Content.Trim() -ne 'ok-radar') { throw 'contenido inesperado' }
    Ok "La validacion por fichero funciona"
} catch {
    Remove-Item $testigo -Force -ErrorAction SilentlyContinue
    Restaurar "No se sirve el reto ACME. Let's Encrypt no podria validar el dominio."
}
Remove-Item $testigo -Force -ErrorAction SilentlyContinue

# --- 4. Certificado -------------------------------------------------------
Paso "Comprobando el certificado"

# El certificado ya se obtuvo antes con Posh-ACME, usando validacion por DNS
# a traves de DuckDNS. Se reutiliza: volver a pedirlo no aporta nada y Let's
# Encrypt limita cuantas veces se puede emitir el mismo dominio por semana.
$chain = Join-Path (Split-Path -Parent $PSScriptRoot) 'nginx\ssl\crypto-radar-fullchain.pem'
$key   = Join-Path (Split-Path -Parent $PSScriptRoot) 'nginx\ssl\crypto-radar-key.pem'

if ((Test-Path $chain) -and (Test-Path $key)) {
    $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($chain)
    Ok "Certificado ya emitido para $($cert.Subject)"
    Ok "Valido hasta $($cert.NotAfter)"
    if ($cert.NotAfter -lt (Get-Date)) { Restaurar "El certificado esta caducado." }
} else {
    # Solo se llega aqui si los ficheros no estan. Se pide con wacs, con los
    # mismos parametros que funcionaron para el dominio del IOT pero SIN su
    # script de instalacion, que sobrescribiria el certificado del IOT.
    if (-not (Test-Path $WACS)) { Restaurar "No hay certificado y no se encuentra wacs.exe" }
    $r = Ejecutar $WACS @('--target','manual','--host',$DOMINIO,'--validation','filesystem','--webroot',$WEBROOT,'--store','pemfiles','--pemfilespath',$SSL,'--installation','none','--accepttos')
    $r.Salida -split "`n" | Where-Object { $_.Trim() } | ForEach-Object { Write-Host "     $($_.TrimEnd())" }
    $gen = "$SSL\$DOMINIO-chain.pem"
    if (-not (Test-Path $gen)) {
        Restaurar "No se genero el certificado. Revisa C:\ProgramData\simple-acme\acme-v02.api.letsencrypt.org\Log"
    }
    Copy-Item $gen $chain -Force
    Copy-Item "$SSL\$DOMINIO-key.pem" $key -Force
    Ok "Certificado obtenido"
}

# --- 5. Bloque HTTPS ------------------------------------------------------
Paso "Anadiendo el sitio HTTPS"
# OJO: en PowerShell las variables NO distinguen mayusculas, asi que
# $conf y $CONF serian la misma. El contenido va en $textoConf para no
# machacar la ruta del fichero, que es lo que rompia la escritura.
$textoConf = Get-Content $CONF -Raw

if ($textoConf -match ([regex]::Escape("ssl/$DOMINIO-chain.pem"))) {
    Ok "El bloque HTTPS ya estaba puesto"
} else {
    if (-not (Test-Path $BLOQUE)) { Restaurar "No se encuentra $BLOQUE" }

    $texto = Get-Content $BLOQUE -Raw
    $marca = '# --- HTTPS: el panel'
    $ini = $texto.IndexOf($marca)
    if ($ini -lt 0) { Restaurar "No se localiza el bloque HTTPS dentro de $BLOQUE" }
    $fin = $texto.IndexOf('# =====', $ini)
    $https = if ($fin -gt $ini) { $texto.Substring($ini, $fin - $ini) } else { $texto.Substring($ini) }

    # La zona de limite de intentos se declara una sola vez, dentro de http.
    if ($textoConf -notmatch 'zone=radar_login') {
        $zona = "`$1`r`n`r`n    # Limite de intentos de acceso al panel del radar.`r`n    limit_req_zone `$binary_remote_addr zone=radar_login:10m rate=12r/m;"
        $textoConf = [regex]::Replace($textoConf, '(?m)^(\s*server_names_hash_bucket_size[^\r\n]*)', $zona)
    }

    # Se inserta antes de la ultima llave, que cierra el bloque http { }.
    $corte = $textoConf.LastIndexOf('}')
    if ($corte -lt 0) { Restaurar "Estructura inesperada en nginx.conf" }
    $textoConf = $textoConf.Substring(0, $corte) + "`r`n" + $https + "`r`n}" + $textoConf.Substring($corte + 1)

    # Se escribe con .NET en vez de con Set-Content. El parametro -Encoding de
    # Set-Content lo aporta el proveedor de sistema de ficheros de forma
    # dinamica, y en algunos contextos no llega a cargarse: entonces falla
    # diciendo que ese parametro no existe. WriteAllText no depende de eso.
    [System.IO.File]::WriteAllText($CONF, $textoConf, [System.Text.Encoding]::ASCII)
    Ok "Bloque HTTPS anadido"
}

# --- 6. Validar y arrancar ------------------------------------------------
Paso "Validando la configuracion y reiniciando"
$prueba = Ejecutar "$NGINX\nginx.exe" @('-p', "$NGINX\", '-t')
$prueba.Salida -split "`n" | Where-Object { $_.Trim() } | ForEach-Object { Write-Host "     $($_.TrimEnd())" }
if ($prueba.Codigo -ne 0) { Restaurar "La configuracion no valida tras anadir el bloque HTTPS." }
ReiniciarNginx
Ok "nginx en marcha"

# --- 7. Comprobaciones finales -------------------------------------------
Paso "Comprobando que todo responde"
$fallos = @()

try {
    $r = Invoke-WebRequest -Uri "https://$DOMINIO/salud" -TimeoutSec 25 -UseBasicParsing
    if ($r.StatusCode -eq 200) { Ok "https://$DOMINIO responde correctamente" }
    else { $fallos += "el panel devolvio $($r.StatusCode)" }
} catch { $fallos += "el panel no responde: $($_.Exception.Message)" }

try {
    $r = Invoke-WebRequest -Uri 'https://edwin-iot-server.duckdns.org' -TimeoutSec 25 -UseBasicParsing
    if ($r.StatusCode -eq 200) { Ok "El proyecto IOT sigue funcionando" }
    else { $fallos += "el IOT devolvio $($r.StatusCode)" }
} catch { $fallos += "el IOT no responde: $($_.Exception.Message)" }

if ($fallos.Count -gt 0) {
    Malo ""
    foreach ($f in $fallos) { Malo "FALLO: $f" }
    Malo "El respaldo esta en $respaldo por si hace falta volver atras."
    exit 1
}

Write-Host ""
Write-Host "=== LISTO ===" -ForegroundColor Cyan
Ok "Direccion fija:  https://$DOMINIO"
Ok "Ya no cambia nunca, ni al reiniciar el servidor."
Write-Host ""
Aviso "Queda una cosa: el puerto 8080 sigue sirviendo el panel por HTTP sin"
Aviso "cifrar, con la contrasena viajando en claro. Conviene cerrarlo."
Write-Host ""
