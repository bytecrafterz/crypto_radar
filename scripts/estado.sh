#!/usr/bin/env bash
# ==========================================================
#  Estado del sistema de un vistazo
#
#    bash scripts/estado.sh
#
#  Contenedores, recursos, disco, actividad y ultimos errores.
#  Es lo primero que hay que mirar cuando algo va raro.
# ==========================================================
set -uo pipefail
cd "$(dirname "$0")/.."

titulo() { printf '\n\033[1;34m== %s ==\033[0m\n' "$*"; }

titulo "Contenedores"
docker compose ps

titulo "Consumo de recursos"
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}' 2>/dev/null

titulo "Disco"
df -h / | tail -n +1
echo "Base de datos: $(docker exec radar-db psql -U radar -d radar -tAc "SELECT pg_size_pretty(pg_database_size('radar'))" 2>/dev/null || echo 'n/d')"
echo "Copias de seguridad: $(find /opt/backups -name 'radar-*.sql.gz' 2>/dev/null | wc -l) ficheros, $(du -sh /opt/backups 2>/dev/null | cut -f1 || echo '0')"

titulo "Actividad del radar"
docker exec radar-db psql -U radar -d radar -c "
  SELECT
    (SELECT COUNT(*) FROM tokens)                                        AS tokens_total,
    (SELECT COUNT(*) FROM tokens WHERE first_seen > CURRENT_DATE)        AS detectados_hoy,
    (SELECT COUNT(*) FROM tokens WHERE enriched_at > CURRENT_DATE)       AS analizados_hoy,
    (SELECT COUNT(*) FROM tokens WHERE tracked_until > now())            AS en_seguimiento,
    (SELECT COUNT(*) FROM alerts WHERE ts > CURRENT_DATE)                AS alertas_hoy,
    (SELECT COUNT(*) FROM alerts WHERE ts > CURRENT_DATE AND sent_ok)    AS entregadas_hoy;
" 2>/dev/null || echo "no se pudo consultar la base de datos"

titulo "Ultimos avisos y errores del sistema"
docker exec radar-db psql -U radar -d radar -c "
  SELECT to_char(ts,'DD/MM HH24:MI') AS hora, level, area, left(message, 70) AS mensaje
  FROM activity_log
  WHERE level IN ('warn','error')
  ORDER BY ts DESC LIMIT 10;
" 2>/dev/null || true

titulo "Ultimas lineas del registro"
docker compose logs --tail 15 radar 2>/dev/null | sed 's/^/  /'

echo
