# Renueva el certificado de crypto-radar.duckdns.org y lo recarga en nginx.
#
# Let's Encrypt caduca cada 90 dias. Posh-ACME solo renueva si quedan menos
# de 30, asi que es seguro ejecutarlo a diario.
#
# Usa validacion por DNS a traves de DuckDNS: no necesita el puerto 80 ni
# permisos de administrador.

$ErrorActionPreference = 'Continue'
$Proyecto = Split-Path -Parent $PSScriptRoot
$SSL      = Join-Path $Proyecto 'nginx\ssl'
$Registro = Join-Path $Proyecto 'logs\certificado.log'

function Apunte($t) {
    "$(Get-Date -Format s)  $t" | Add-Content $Registro -ErrorAction SilentlyContinue
}

try {
    Import-Module Posh-ACME -ErrorAction Stop
    Set-PAServer LE_PROD

    $antes = (Get-PACertificate 'crypto-radar.duckdns.org' -ErrorAction SilentlyContinue).NotAfter
    Submit-Renewal 'crypto-radar.duckdns.org' -ErrorAction Stop | Out-Null
    $cert = Get-PACertificate 'crypto-radar.duckdns.org'

    if ($cert.NotAfter -ne $antes) {
        Apunte "Certificado renovado. Nueva caducidad: $($cert.NotAfter)"
        Copy-Item $cert.FullChainFile (Join-Path $SSL 'crypto-radar-fullchain.pem') -Force
        Copy-Item $cert.KeyFile       (Join-Path $SSL 'crypto-radar-key.pem')       -Force

        # Hay DOS nginx en esta maquina y solo se avisaba a uno:
        #
        #   C:
ginx               -> puertos 80 y 443, el que sirve el dominio
        #   C:	ools
ginx-1.28.0  -> puertos 8080 y 8443, el de pruebas
        #
        # Se reiniciaba solo el de pruebas. El publico se quedaba con el
        # certificado viejo cargado en memoria hasta que alguien lo
        # reiniciara a mano, asi que el dia que caducara el viejo el panel
        # se habria quedado sin HTTPS sin que nadie hubiera tocado nada.
        $recargado = $false
        try {
            & "C:\nginx\nginx.exe" -p "C:\nginx" -c "conf\nginx.conf" -s reload 2>$null
            if ($LASTEXITCODE -eq 0) { $recargado = $true }
        } catch { }

        if ($recargado) {
            Apunte "nginx publico recargado con el certificado nuevo"
        } else {
            # Recargarlo exige los mismos permisos con los que se arranco.
            # Si esta tarea no corre elevada no puede, y hay que enterarse:
            # el certificado estaria renovado en disco pero no en uso.
            Apunte "AVISO: no se pudo recargar el nginx publico; la tarea necesita privilegios elevados"
        }

        # nginx solo lee los certificados al arrancar.
        Get-Process nginx -ErrorAction SilentlyContinue |
            Where-Object { $_.Path -like '*tools*' } |
            Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 3
        Start-Process -FilePath 'C:\tools\nginx-1.28.0\nginx.exe' `
            -ArgumentList '-p', 'C:\tools\nginx-1.28.0\', '-c', (Join-Path $Proyecto 'nginx\local.windows.conf') `
            -WorkingDirectory 'C:\tools\nginx-1.28.0' -WindowStyle Hidden
        Apunte "nginx reiniciado con el certificado nuevo"
    } else {
        Apunte "Sin cambios. Caduca el $($cert.NotAfter)"
    }
} catch {
    Apunte "ERROR: $($_.Exception.Message)"
}
