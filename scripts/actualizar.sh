#!/usr/bin/env bash
# ==========================================================
#  Actualizar el sistema despues de cambiar el codigo
#
#    bash scripts/actualizar.sh
#
#  Hace copia de seguridad, reconstruye la imagen, aplica las
#  migraciones nuevas y comprueba que sigue funcionando.
# ==========================================================
set -euo pipefail
cd "$(dirname "$0")/.."

azul() { printf '\033[1;34m%s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  OK  %s\033[0m\n' "$*"; }

azul "1/4  Copia de seguridad antes de actualizar"
bash scripts/backup.sh || echo "  (sin copia: puede ser la primera instalacion)"

azul "2/4  Reconstruyendo"
docker compose build
ok "imagen actualizada"

azul "3/4  Reiniciando los servicios"
docker compose up -d
# Las migraciones se aplican solas al arrancar (src/index.ts).
ok "servicios en marcha"

azul "4/4  Comprobando"
sleep 8
for i in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${PANEL_PORT:-3000}/salud" >/dev/null 2>&1; then
    ok "el sistema responde"
    break
  fi
  (( i == 40 )) && { echo "  X  no responde, mira: docker compose logs --tail 50 radar"; exit 1; }
  sleep 1
done

# Limpiamos imagenes viejas para que no se llene el disco.
docker image prune -f >/dev/null
ok "imagenes antiguas eliminadas"

echo
azul "Actualizacion terminada."
