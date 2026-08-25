#!/usr/bin/env bash
# ==========================================================
#  Restaurar una copia de seguridad
#
#    bash scripts/restaurar.sh /opt/backups/radar-2026-08-16-0400.sql.gz
#
#  ATENCION: sustituye los datos actuales por los de la copia.
# ==========================================================
set -euo pipefail

COPIA="${1:-}"

if [[ -z "$COPIA" ]]; then
  echo "Uso: bash scripts/restaurar.sh RUTA-DE-LA-COPIA.sql.gz"
  echo
  echo "Copias disponibles:"
  ls -lh /opt/backups/radar-*.sql.gz 2>/dev/null || echo "  (ninguna)"
  exit 1
fi

if [[ ! -f "$COPIA" ]]; then
  echo "No existe el fichero: $COPIA"
  exit 1
fi

echo "Se va a SUSTITUIR la base de datos actual por: $COPIA"
read -r -p "Escribe SI en mayusculas para continuar: " RESPUESTA
if [[ "$RESPUESTA" != "SI" ]]; then
  echo "Cancelado. No se ha tocado nada."
  exit 0
fi

# Copia de seguridad de lo que hay ahora, por si acaso.
SEGURIDAD="/opt/backups/antes-de-restaurar-$(date +%F-%H%M).sql.gz"
echo "Guardando el estado actual en ${SEGURIDAD}..."
docker exec radar-db pg_dump -U radar radar | gzip > "$SEGURIDAD"

echo "Parando el radar para que no escriba durante la restauracion..."
docker compose stop radar

echo "Restaurando..."
docker exec radar-db psql -U radar -d postgres -c "DROP DATABASE IF EXISTS radar;" >/dev/null
docker exec radar-db psql -U radar -d postgres -c "CREATE DATABASE radar OWNER radar;" >/dev/null
gunzip -c "$COPIA" | docker exec -i radar-db psql -U radar -d radar >/dev/null

echo "Arrancando el radar..."
docker compose start radar

echo
echo "Restauracion terminada."
echo "El estado anterior quedo guardado en: ${SEGURIDAD}"
