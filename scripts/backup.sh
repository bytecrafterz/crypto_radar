#!/usr/bin/env bash
# ==========================================================
#  Copia de seguridad de la base de datos
#
#    bash scripts/backup.sh
#
#  Guarda una copia comprimida en /opt/backups y borra las
#  que tengan mas de 14 dias. Pensado para ejecutarse por cron.
# ==========================================================
set -euo pipefail

DESTINO="${BACKUP_DIR:-/opt/backups}"
DIAS="${BACKUP_DIAS:-14}"
FECHA=$(date +%F-%H%M)
FICHERO="${DESTINO}/radar-${FECHA}.sql.gz"

mkdir -p "$DESTINO"

if ! docker ps --format '{{.Names}}' | grep -q '^radar-db$'; then
  echo "El contenedor radar-db no esta en marcha. No se hace copia."
  exit 1
fi

docker exec radar-db pg_dump -U radar radar | gzip > "$FICHERO"

TAM=$(du -h "$FICHERO" | cut -f1)
echo "Copia creada: ${FICHERO} (${TAM})"

# Rotacion: borramos las copias antiguas.
BORRADAS=$(find "$DESTINO" -name 'radar-*.sql.gz' -mtime "+${DIAS}" -print -delete | wc -l)
if (( BORRADAS > 0 )); then
  echo "Borradas ${BORRADAS} copias de mas de ${DIAS} dias."
fi

echo "Copias guardadas ahora mismo: $(find "$DESTINO" -name 'radar-*.sql.gz' | wc -l)"
