#!/usr/bin/env bash
# ============================================================================
#  Arreglo posterior a la migracion del 09/09  ->  ejecutar con sudo
#
#    sudo bash aplicar.sh
#
#  1. Lleva al servidor el arreglo del registrador de Telegram (Robot 2)
#  2. Reconstruye y reinicia el servicio
#  3. Comprueba que el colector MTProto vuelve a dar vueltas
#  4. Instala la copia de seguridad diaria, que se quedo en Windows
# ============================================================================
set -euo pipefail

ORIGEN=/home/tommy/apps/Blockchain
DESTINO=/opt/crypto-radar

azul() { printf '\n\033[1;34m%s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  OK  %s\033[0m\n' "$*"; }
mal()  { printf '\033[1;31m  X   %s\033[0m\n' "$*"; }

[[ $EUID -eq 0 ]] || { mal "hay que ejecutarlo con sudo"; exit 1; }

azul "1/6  Copiando el arreglo al servidor"
install -o radar -g radar -m 664 "$ORIGEN/src/telegram/mtproto.ts" "$DESTINO/src/telegram/mtproto.ts"
install -o radar -g radar -m 775 "$ORIGEN/scripts/copia-seguridad.sh" "$DESTINO/scripts/copia-seguridad.sh"
grep -q 'canSend' "$DESTINO/src/telegram/mtproto.ts" || { mal "el arreglo no llego"; exit 1; }
ok "mtproto.ts y copia-seguridad.sh en su sitio"

azul "2/6  Reconstruyendo"
# tsc directamente y no "npm run build": el usuario radar tiene /usr/sbin/nologin
# como shell y HOME en /var/lib/radar, y npm quiere escribir su cache ahi. tsc no
# necesita nada de eso, y es exactamente lo que el script de npm acaba llamando.
sudo -u radar env HOME=/var/lib/radar bash -c "cd $DESTINO && ./node_modules/.bin/tsc -p tsconfig.json"
grep -q 'canSend' "$DESTINO/dist/telegram/mtproto.js" || { mal "dist no tiene el arreglo"; exit 1; }
ok "compilado, y el arreglo esta en dist"

azul "3/6  Reiniciando el servicio"
systemctl restart crypto-radar
sleep 10
systemctl is-active --quiet crypto-radar || { mal "el servicio no arranco"; journalctl -u crypto-radar -n 30 --no-pager; exit 1; }
ok "crypto-radar en marcha"

azul "4/6  Comprobando que responde"
for i in $(seq 1 40); do
  curl -fsS http://127.0.0.1:3000/salud >/dev/null 2>&1 && { ok "el panel responde"; break; }
  (( i == 40 )) && { mal "no responde"; exit 1; }
  sleep 2
done

azul "5/6  Instalando la copia de seguridad diaria"
install -o root -g root -m 644 "$ORIGEN/scripts/systemd/crypto-radar-backup.service" /etc/systemd/system/
install -o root -g root -m 644 "$ORIGEN/scripts/systemd/crypto-radar-backup.timer"   /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now crypto-radar-backup.timer
ok "temporizador activo"

echo "  Haciendo una copia ahora para comprobar que funciona (tarda un poco)..."
if systemctl start crypto-radar-backup.service; then
  ok "copia de prueba hecha:"
  tail -3 "$DESTINO/logs/copias.log" | sed 's/^/      /'
else
  mal "la copia de prueba fallo:"
  journalctl -u crypto-radar-backup -n 20 --no-pager
fi

azul "6/6  Vigilando el colector de Telegram (unos 4 minutos)"
echo "  Antes del arreglo no conseguia conectar ni una sola vez."
DESDE="$(date -Is)"
sleep 240
VUELTAS=$(journalctl -u crypto-radar --since "$DESDE" --no-pager 2>/dev/null | grep -c 'vuelta del colector MTProto' || true)
FALLOS=$(journalctl  -u crypto-radar --since "$DESDE" --no-pager 2>/dev/null | grep -c 'canSend' || true)
CAIDAS=$(journalctl  -u crypto-radar --since "$DESDE" --no-pager 2>/dev/null | grep -c 'no se pudo abrir la conexion con Telegram' || true)

echo
echo "  vueltas del colector : $VUELTAS"
echo "  errores canSend      : $FALLOS"
echo "  conexiones fallidas  : $CAIDAS"
echo

if (( VUELTAS > 0 && FALLOS == 0 )); then
  ok "Robot 2 vuelve a leer Telegram."
elif (( FALLOS > 0 )); then
  mal "sigue apareciendo canSend: el arreglo no ha cogido."
else
  mal "sin vueltas todavia. Puede ser la sesion de Telegram, no el codigo."
  echo "      Mira:  journalctl -u crypto-radar -n 50 --no-pager | grep -i mtproto"
fi

azul "Terminado."
echo "  Estado:      systemctl status crypto-radar --no-pager"
echo "  Copias:      systemctl list-timers crypto-radar-backup"
