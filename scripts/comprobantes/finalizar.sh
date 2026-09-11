#!/usr/bin/env bash
# ============================================================================
#  Finalizar la entrega: desplegar el Robot 3 recalibrado y generar todos los
#  comprobantes, agrupados en Robots 1 y 2 por un lado y Robot 3 por otro.
#
#    sudo bash /home/tommy/apps/Blockchain/scripts/comprobantes/finalizar.sh
#
#  1. Lleva al servidor el ultimo commit de /home/tommy/apps/Blockchain
#  2. Reconstruye y reinicia el servicio
#  3. Ejecuta la suite completa de pruebas como el usuario radar
#  4. Calcula la calibracion del Robot 3 y exporta sus veredictos
#  5. Captura el panel por grupos (lee la contrasena del .env; no la muestra)
#  6. Deja todo ordenado en entrega/Entrega-Robots-1-y-2 y entrega/Entrega-Robot-3
# ============================================================================
set -euo pipefail

ORIGEN=/home/tommy/apps/Blockchain
DESTINO=/opt/crypto-radar
E12=$ORIGEN/entrega/Entrega-Robots-1-y-2
E3=$ORIGEN/entrega/Entrega-Robot-3
PREV=$ORIGEN/entrega/Comprobantes-Workana
G="git -c safe.directory=$DESTINO -C $DESTINO"

azul() { printf '\n\033[1;34m%s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  OK  %s\033[0m\n' "$*"; }
mal()  { printf '\033[1;31m  X   %s\033[0m\n' "$*"; }
[[ $EUID -eq 0 ]] || { mal "hay que ejecutarlo con sudo"; exit 1; }

azul "1/6  Llevando el ultimo commit al servidor"
$G fetch -q "$ORIGEN" main
$G reset -q --hard FETCH_HEAD
chown -R radar:radar "$DESTINO"
ok "servidor en $($G log --oneline -1)"

azul "2/6  Reconstruyendo y reiniciando"
sudo -u radar env HOME=/var/lib/radar bash -c "cd $DESTINO && ./node_modules/.bin/tsc -p tsconfig.json"
grep -q 'umbralesActuales' "$DESTINO/dist/robot3/evaluador.js" || { mal "dist no lleva el cambio"; exit 1; }
systemctl restart crypto-radar
for i in $(seq 1 40); do curl -fsS http://127.0.0.1:3000/salud >/dev/null 2>&1 && break; (( i == 40 )) && { mal "el panel no responde"; exit 1; }; sleep 2; done
ok "crypto-radar en marcha con el Robot 3 recalibrado"

azul "3/6  Suite completa de pruebas (como radar)"
mkdir -p "$E12" "$E3"
sudo -u radar env HOME=/var/lib/radar bash -c "cd $DESTINO && node --import tsx --test 'src/pruebas/**/*.test.ts'" > "$E3/pruebas-suite-completa.txt" 2>&1 || true
sudo -u radar env HOME=/var/lib/radar bash -c "cd $DESTINO && node --import tsx --test src/pruebas/convergencia.test.ts" > "$E3/pruebas-robot-3.txt" 2>&1 || true
grep -E "^ℹ (tests|pass|fail)" "$E3/pruebas-suite-completa.txt" | tr '\n' ' '; echo
ok "resultados en $E3/pruebas-*.txt"

azul "4/6  Calibracion y veredictos del Robot 3"
sudo -u radar env HOME=/var/lib/radar bash -c "cd $DESTINO && set -a && . ./.env && set +a && node --import tsx scripts/robot3-calibracion.ts" > "$E3/calibracion-robot-3.txt" 2>&1 || true
sudo -u radar bash -c "set -a; . $DESTINO/.env; set +a; psql \"\$DATABASE_URL\" -c \"\\copy (SELECT c.chain, c.address, t.symbol, c.primera_mencion, c.nivel, c.fuentes_total, c.fuentes_indep, c.anticipacion_seg, c.score_tecnica, c.score_riesgo, c.score_social, c.score_fuentes, c.score_evidencia, c.vetado, c.enviado_at FROM tg_candidatos c LEFT JOIN tokens t ON t.chain=c.chain AND t.address=c.address WHERE c.nivel IS NOT NULL ORDER BY c.primera_mencion DESC) TO STDOUT CSV HEADER\"" > "$E3/veredictos-robot-3.csv" 2>/dev/null || true
cp "$ORIGEN/config/robot3.yaml" "$E3/config-robot3.yaml"
echo "  veredictos exportados: $(( $(wc -l < "$E3/veredictos-robot-3.csv") - 1 ))"
sed -n '1,12p' "$E3/calibracion-robot-3.txt" | sed 's/^/  /'
ok "calibracion en $E3/calibracion-robot-3.txt"

azul "5/6  Capturas y videos por grupo (esto tarda unos 3 minutos)"
PASS="$(grep '^PANEL_PASSWORD=' "$DESTINO/.env" | cut -d= -f2-)"
mkdir -p "$E12/capturas" "$E3/capturas"
sudo -u tommy env PANEL_PASSWORD="$PASS" HOME=/home/tommy node "$ORIGEN/scripts/comprobantes/capturar.mjs" "$E12/capturas" r12 | sed 's/^/  /'
sudo -u tommy env PANEL_PASSWORD="$PASS" HOME=/home/tommy node "$ORIGEN/scripts/comprobantes/capturar.mjs" "$E3/capturas" r3 | sed 's/^/  /'
unset PASS
mv -f "$E12/capturas/recorrido-robots-1-y-2.webm" "$E12/video-recorrido-robots-1-y-2.webm"
mv -f "$E3/capturas/recorrido-robot-3.webm" "$E3/video-recorrido-robot-3.webm"
ok "capturas y videos hechos"

azul "6/6  Ordenando el resto del material"
cp -f "$PREV/01-resumen-entregables.png" "$PREV/02-rendimiento-real.png" "$E12/"
cp -f "$PREV"/05-manual-uso-p*.png "$PREV"/08-guia-movil-p*.png "$E12/" 2>/dev/null || true
cp -f "$ORIGEN/docs/pdf/Crypto-Radar-Manual.pdf" "$ORIGEN/docs/pdf/Guia-Rapida-Movil.pdf" "$E12/" 2>/dev/null || true
cp -f "$PREV/10-video-comprobantes.webm" "$E12/video-resumen.webm" 2>/dev/null || true
chown -R tommy:tommy "$E12" "$E3"
cd "$ORIGEN/entrega" && rm -f Entrega-Robots-1-y-2.zip Entrega-Robot-3.zip && zip -q -r Entrega-Robots-1-y-2.zip Entrega-Robots-1-y-2 && zip -q -r Entrega-Robot-3.zip Entrega-Robot-3 && chown tommy:tommy Entrega-*.zip
ok "paquetes:"
ls -la "$ORIGEN/entrega"/Entrega-*.zip | awk '{printf "      %-60s %6.1f MB\n",$NF,$5/1048576}'

azul "Terminado."
echo "  Robot 3 recalibrado y en marcha. Material en:"
echo "    $E12"
echo "    $E3"
echo "  Manda a Claude el contenido de: $E3/calibracion-robot-3.txt"
