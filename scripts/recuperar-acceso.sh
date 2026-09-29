#!/usr/bin/env bash
# ============================================================================
#  Recuperar el acceso al servidor y dejar Crypto Radar en marcha
#
#  Se ejecuta desde la consola web de DigitalOcean, que entra por el puerto
#  serie y por eso funciona aunque el cortafuegos no deje pasar nada:
#
#    cd ~/apps/Blockchain && git fetch -q origin && git show origin/main:scripts/recuperar-acceso.sh | sudo bash
#
#  POR QUE EXISTE
#  El 29/09 el servidor respondia al ping pero dejaba caer en silencio todas
#  las conexiones TCP: 22, 80, 443, desde seis paises distintos. Ese es el
#  dibujo exacto de UFW activo sin reglas de entrada: por defecto deja pasar
#  el ping y tira todo lo demas sin contestar. Un servidor colgado por falta
#  de memoria no se ve asi, porque el nucleo completa el saludo TCP aunque
#  los programas no respondan.
#
#  QUE HACE, en este orden
#    1. Ensena el estado real antes de tocar nada
#    2. Abre en UFW solo 22, 80 y 443. No borra ninguna regla que ya exista
#    3. Levanta y deja habilitados ssh, nginx, postgresql, crypto-radar y la
#       copia de seguridad nocturna
#    4. Instala earlyoom, para que la falta de memoria mate un proceso de
#       desarrollo antes de congelar la maquina entera, como paso el 17/09
#    5. Comprueba desde dentro que el panel responde
#
#  Se puede ejecutar las veces que haga falta: si algo ya esta bien, lo deja.
# ============================================================================
set -uo pipefail

azul() { printf '\n\033[1;34m%s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  OK  %s\033[0m\n' "$*"; }
mal()  { printf '\033[1;31m  X   %s\033[0m\n' "$*"; }
nota() { printf '      %s\n' "$*"; }

[[ $EUID -eq 0 ]] || { mal "hay que ejecutarlo con sudo"; exit 1; }

# ----------------------------------------------------------------------------
azul "1/5  Estado antes de tocar nada"
echo "  --- memoria ---"
free -m | sed -n '1,3p' | sed 's/^/  /'
echo "  --- carga ---"
uptime | sed 's/^/  /'
echo "  --- servicios ---"
for s in ssh nginx postgresql crypto-radar crypto-radar-backup.timer; do
  printf '  %-26s activo=%-9s arranque=%s\n' "$s" "$(systemctl is-active $s 2>/dev/null)" "$(systemctl is-enabled $s 2>/dev/null)"
done
echo "  --- cortafuegos UFW ---"
UFW_ESTADO="$(ufw status 2>/dev/null | head -1)"
ufw status verbose 2>/dev/null | sed 's/^/  /'

# ----------------------------------------------------------------------------
azul "2/5  Cortafuegos"
if echo "$UFW_ESTADO" | grep -qi "inactive\|inactivo"; then
  mal "UFW esta desactivado, asi que el bloqueo NO viene de aqui."
  nota "Casi seguro es un cortafuegos de DigitalOcean: en el panel, Networking"
  nota "-> Firewalls. Si este servidor aparece en alguno, anade reglas de"
  nota "entrada para SSH, HTTP y HTTPS, o quitalo de ese cortafuegos."
else
  for p in 22 80 443; do
    if ufw status | grep -qE "^${p}(/tcp)?[[:space:]]+ALLOW"; then
      ok "puerto $p ya estaba abierto"
    else
      ufw allow "$p/tcp" >/dev/null && ok "puerto $p abierto (faltaba)"
    fi
  done
  ufw reload >/dev/null && ok "UFW recargado"
fi

# ----------------------------------------------------------------------------
azul "3/5  Servicios"
for s in ssh nginx postgresql crypto-radar; do
  systemctl enable "$s" >/dev/null 2>&1
  if systemctl is-active --quiet "$s"; then
    ok "$s en marcha"
  else
    systemctl start "$s" && ok "$s arrancado" || mal "$s no arranca: journalctl -u $s -n 30 --no-pager"
  fi
done
systemctl enable --now crypto-radar-backup.timer >/dev/null 2>&1 && ok "copia de seguridad nocturna activa"
if [[ -f /etc/nginx/sites-enabled/crypto-radar.duckdns.org ]]; then
  nginx -t >/dev/null 2>&1 && ok "configuracion de nginx correcta" || mal "nginx -t falla: revisalo antes de recargar"
fi

# ----------------------------------------------------------------------------
azul "4/5  Proteccion contra congelaciones por memoria"
# El 17/09 la maquina se quedo sin memoria, dejo de responder y hubo que
# reiniciarla a mano. El nucleo solo reacciona cuando ya es tarde: primero
# se hunde en el intercambio y se congela todo. earlyoom actua antes, al 5 %
# de memoria libre, y elige a quien parar. Se le dice que prefiera procesos
# de desarrollo (editores, navegadores sin ventana, servidores de pruebas) y
# que evite los de produccion. crypto-radar ademas tiene OOMScoreAdjust=-800,
# que earlyoom respeta.
if ! command -v earlyoom >/dev/null 2>&1; then
  apt-get install -y -qq earlyoom >/dev/null 2>&1 && ok "earlyoom instalado" || mal "no se pudo instalar earlyoom"
fi
if command -v earlyoom >/dev/null 2>&1; then
  cat > /etc/default/earlyoom <<'CONF'
# Ajustado para Crypto Radar. Ver scripts/recuperar-acceso.sh.
# Los nombres se comparan con el nombre corto del proceso, que el nucleo
# corta a 15 caracteres: el navegador sin ventana aparece como
# "chrome-headless" y el servidor de pruebas como "next-server (v1". Por eso
# los patrones terminan en .* y no en el nombre completo.
EARLYOOM_ARGS="-r 3600 -m 5 -s 10 --prefer '(^|/)(claude|chrome.*|chromium.*|next-server.*|python3?.*)$' --avoid '(^|/)(postgres|nginx|sshd|systemd|systemd-journal)$'"
CONF
  systemctl enable --now earlyoom >/dev/null 2>&1
  systemctl restart earlyoom
  systemctl is-active --quiet earlyoom && ok "earlyoom vigilando la memoria" || mal "earlyoom no arranco"
fi
if [[ -f /etc/systemd/system/crypto-radar.service.d/oom.conf ]]; then
  ok "crypto-radar protegido frente al OOM ($(systemctl show crypto-radar -p OOMScoreAdjust --value))"
else
  mkdir -p /etc/systemd/system/crypto-radar.service.d
  printf '[Service]\nOOMScoreAdjust=-800\n' > /etc/systemd/system/crypto-radar.service.d/oom.conf
  systemctl daemon-reload
  ok "crypto-radar protegido frente al OOM (-800), efectivo en el proximo reinicio del servicio"
fi

# ----------------------------------------------------------------------------
azul "5/5  Comprobacion"
sleep 5
if curl -fsS --max-time 10 http://127.0.0.1:3000/salud >/dev/null 2>&1; then
  ok "el panel responde por dentro"
else
  mal "el panel no responde en 127.0.0.1:3000"
fi
if curl -fsS --max-time 15 -o /dev/null https://crypto-radar.duckdns.org/entrar 2>/dev/null; then
  ok "el panel responde por su direccion publica"
else
  mal "la direccion publica no responde desde el propio servidor"
  nota "Si UFW ya esta bien, mira el cortafuegos de DigitalOcean (Networking -> Firewalls)."
fi

echo "  --- puertos abiertos al exterior ---"
ss -tlnH 2>/dev/null | awk '{print $4}' | grep -vE '^(127\.|\[::1\]|127\.0\.0\.53)' | sort -u | sed 's/^/  /'

azul "Terminado. Dile a quien te ayuda que ya se puede comprobar desde fuera."
