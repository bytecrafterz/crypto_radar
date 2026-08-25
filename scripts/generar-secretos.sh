#!/usr/bin/env bash
# ==========================================================
#  Genera las contrasenas del sistema y las escribe en .env
#
#    bash scripts/generar-secretos.sh
#
#  Rellena PANEL_PASSWORD, SESSION_SECRET y POSTGRES_PASSWORD
#  con valores aleatorios seguros. No toca el resto del fichero.
# ==========================================================
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Se ha creado .env a partir de .env.example"
fi

# Copia de seguridad antes de tocar nada.
cp .env ".env.bak.$(date +%Y%m%d%H%M%S)"

gen() { openssl rand -base64 "$1" | tr -d '\n=+/' | cut -c1-"$2"; }

PANEL=$(gen 24 20)
SESION=$(gen 48 44)
POSTGRES=$(gen 24 24)

poner() {
  local clave="$1" valor="$2"
  if grep -q "^${clave}=" .env; then
    # El delimitador | evita problemas con las barras de los valores.
    sed -i.tmp "s|^${clave}=.*|${clave}=${valor}|" .env && rm -f .env.tmp
  else
    echo "${clave}=${valor}" >> .env
  fi
}

poner PANEL_PASSWORD   "$PANEL"
poner SESSION_SECRET   "$SESION"

# La contrasena de PostgreSQL solo se aplica cuando se crea la base de datos
# por primera vez. Cambiarla despues NO cambia la del servidor: solo consigue
# que la aplicacion ya no pueda entrar. Por eso solo se genera si aun no habia
# ninguna puesta.
ACTUAL_PG=$(grep -E '^POSTGRES_PASSWORD=' .env 2>/dev/null | cut -d= -f2-)
if [[ -z "$ACTUAL_PG" || "$ACTUAL_PG" == "radar_local_password" ]]; then
  poner POSTGRES_PASSWORD "$POSTGRES"
  PG_NUEVA="si"
else
  PG_NUEVA="no"
  echo
  echo "AVISO: POSTGRES_PASSWORD ya estaba puesta y NO se ha tocado."
  echo "       Cambiarla ahora dejaria al sistema sin acceso a su base de datos,"
  echo "       porque esa contrasena solo se aplica al crear el volumen."
fi

echo
echo "==========================================================="
echo " CONTRASENAS GENERADAS - GUARDALAS EN UN GESTOR DE CLAVES"
echo "==========================================================="
echo
echo "  Panel web        : ${PANEL}"
if [[ "$PG_NUEVA" == "si" ]]; then
  echo "  Base de datos    : ${POSTGRES}"
else
  echo "  Base de datos    : (sin cambios, se conserva la que ya habia)"
fi
echo "  (el secreto de sesion no hace falta apuntarlo)"
echo
echo "Ya estan escritas en el fichero .env."
echo "Ahora edita .env y pega las claves de las APIs y del correo:"
echo "    nano .env"
