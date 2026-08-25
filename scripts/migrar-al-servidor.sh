#!/usr/bin/env bash
# ==========================================================
#  Llevar la base de datos local al servidor
#
#    bash scripts/migrar-al-servidor.sh root@LA-IP-DEL-SERVIDOR
#
#  Copia TODO el historico acumulado en local (tokens, mediciones,
#  puntuaciones, informes de seguridad, horizontes y wallets) al servidor.
#
#  Las mediciones a 5 min, 15 min, 1 h, 6 h y 24 h no se pueden reconstruir
#  despues, asi que no se pierde nada: se traslada tal cual.
# ==========================================================
set -euo pipefail

SERVIDOR="${1:-}"
PG_LOCAL="${PG_BIN:-/c/tools/pg/pgsql/bin}"
PUERTO_LOCAL="${PGPORT_LOCAL:-5433}"
RUTA_REMOTA="${RUTA_REMOTA:-/opt/crypto-radar}"

if [[ -z "$SERVIDOR" ]]; then
  echo "Uso: bash scripts/migrar-al-servidor.sh usuario@ip"
  exit 1
fi

FECHA=$(date +%F-%H%M)
VOLCADO="/tmp/radar-$FECHA.dump"

echo "1/4  Volcando la base de datos local..."
"$PG_LOCAL/pg_dump.exe" -h 127.0.0.1 -p "$PUERTO_LOCAL" -U radar -d radar -Fc -f "$VOLCADO"
echo "     $(du -h "$VOLCADO" | cut -f1)"

echo "2/4  Copiando al servidor..."
scp "$VOLCADO" "$SERVIDOR:/tmp/radar.dump"

echo "3/4  Restaurando en el servidor..."
# El contenedor ya tiene el esquema creado por las migraciones al arrancar;
# --clean vacia lo que hubiera y deja exactamente lo que hay en local.
ssh "$SERVIDOR" "docker exec -i radar-db pg_restore -U radar -d radar --clean --if-exists < /tmp/radar.dump && rm /tmp/radar.dump"

echo "4/4  Comprobando..."
ssh "$SERVIDOR" "docker exec radar-db psql -U radar -d radar -tAc \"
  SELECT 'tokens: ' || (SELECT COUNT(*) FROM tokens) ||
         ' | mediciones: ' || (SELECT COUNT(*) FROM token_snapshots) ||
         ' | horizontes: ' || (SELECT COUNT(*) FROM token_horizons)\""

rm -f "$VOLCADO"
echo ""
echo "Listo. El historico local ya esta en el servidor."
echo "Reinicia el radar alli:  ssh $SERVIDOR 'cd $RUTA_REMOTA && docker compose restart radar'"
