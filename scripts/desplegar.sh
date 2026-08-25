#!/usr/bin/env bash
# ==========================================================
#  Despliegue del sistema
#
#    bash scripts/desplegar.sh
#
#  Arranca la base de datos y el radar, aplica las migraciones
#  y comprueba que todo responde.
# ==========================================================
set -euo pipefail
cd "$(dirname "$0")/.."

azul() { printf '\033[1;34m%s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  OK  %s\033[0m\n' "$*"; }
err()  { printf '\033[1;31m  X   %s\033[0m\n' "$*"; }

if [[ ! -f .env ]]; then
  err "No existe el fichero .env"
  echo
  echo "Crealo asi:"
  echo "    cp .env.example .env"
  echo "    bash scripts/generar-secretos.sh   # genera las contrasenas"
  echo "    nano .env                          # pega las claves"
  exit 1
fi

# Comprobamos que no se han quedado los valores de ejemplo.
if grep -q 'cambia-esta-clave\|cambia-esto-por-un-texto' .env; then
  err "El fichero .env todavia tiene contrasenas de ejemplo."
  echo "Ejecuta:  bash scripts/generar-secretos.sh"
  exit 1
fi

azul "1/4  Construyendo la imagen (la primera vez tarda 2-3 minutos)"
docker compose build
ok "imagen construida"

azul "2/4  Arrancando los servicios"
docker compose up -d
ok "servicios arrancados"

azul "3/4  Esperando a que el sistema responda"
for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${PANEL_PORT:-3000}/salud" >/dev/null 2>&1; then
    ok "el sistema responde"
    break
  fi
  if (( i == 60 )); then
    err "el sistema no responde despues de 60 segundos"
    echo "Mira que ha pasado con:  docker compose logs --tail 50 radar"
    exit 1
  fi
  sleep 1
done

azul "4/4  Comprobacion completa"
docker compose exec -T radar node dist/selftest.js || true

IP=$(curl -fsS https://api.ipify.org 2>/dev/null || echo "LA-IP-DEL-SERVIDOR")
echo
azul "Sistema desplegado."
echo "  Panel:   http://${IP}:${PANEL_PORT:-3000}"
echo "  Usuario: la contrasena que pusiste en PANEL_PASSWORD"
echo
echo "Comprueba que las alertas llegan:"
echo "    docker compose exec radar node dist/testAlert.js"
