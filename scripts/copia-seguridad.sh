#!/usr/bin/env bash
# ============================================================================
#  Copia de seguridad de la base de datos
#
#    bash scripts/copia-seguridad.sh
#
#  POR QUE ESTE Y NO scripts/backup.sh
#  Aquel esta escrito para Docker: busca un contenedor llamado radar-db y sale
#  con error si no lo encuentra. En este servidor PostgreSQL es el paquete de
#  Ubuntu gobernado por systemd, asi que aquel script no puede ejecutarse aqui.
#  Un script de copias que no se puede ejecutar es peor que no tener ninguno,
#  porque da la impresion de que el asunto esta resuelto.
#
#  ES LA TRADUCCION DE scripts/copia-seguridad.ps1
#  Ese era el que corria de verdad en la maquina Windows, lanzado por una
#  tarea programada a las 03:30. Al pasar el sistema a Ubuntu la tarea se
#  quedo atras, y con ella las copias. Este fichero hace lo mismo y lo lanza
#  crypto-radar-backup.timer.
#
#  QUE HACE
#    1. Vuelca la base de datos en formato comprimido
#    2. COMPRUEBA que el volcado se puede leer, no solo que pesa algo
#    3. Borra las copias mas viejas de 14 dias
#    4. Deja constancia en logs/copias.log
#
#  El paso 2 es el que convierte un fichero en una copia de seguridad. Un
#  volcado que nadie ha intentado leer es una suposicion.
# ============================================================================
set -uo pipefail

PROYECTO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESTINO="${BACKUP_DIR:-/var/backups/crypto-radar/bd}"
REGISTRO="${BACKUP_LOG:-$PROYECTO/logs/copias.log}"
DIAS="${BACKUP_DIAS:-14}"

mkdir -p "$DESTINO" "$(dirname "$REGISTRO")"

apunte() {
  printf '%s  %s\n' "$(date -Is)" "$*" >> "$REGISTRO" 2>/dev/null
  printf '  %s\n' "$*"
}

# La contrasena sale del .env, para no repetirla en dos sitios.
if [[ ! -r "$PROYECTO/.env" ]]; then
  apunte "ERROR: no se puede leer $PROYECTO/.env"
  exit 1
fi

DB_URL="$(grep -m1 '^DATABASE_URL=' "$PROYECTO/.env" | cut -d= -f2-)"
if [[ -z "$DB_URL" ]]; then
  apunte 'ERROR: no hay DATABASE_URL en .env'
  exit 1
fi

# postgres://usuario:contrasena@host:puerto/base
#
# La contrasena se captura con .+ y no con [^@]+ a proposito: es codiciosa, asi
# que corta por la ULTIMA arroba. Con [^@]+ una contrasena que llevase una
# arroba dentro partiria la cadena por la primera, y el host saldria mal sin
# que nada avisara. El .ps1 de Windows tiene ese fallo; aqui no.
if [[ ! "$DB_URL" =~ ^postgres(ql)?://([^:]+):(.+)@([^:/@]+):([0-9]+)/(.+)$ ]]; then
  apunte 'ERROR: no se pudo interpretar DATABASE_URL'
  exit 1
fi
USUARIO="${BASH_REMATCH[2]}"
export PGPASSWORD="${BASH_REMATCH[3]}"
HOST_BD="${BASH_REMATCH[4]}"
PUERTO="${BASH_REMATCH[5]}"
BASE="${BASH_REMATCH[6]%%\?*}"

FECHA="$(date +%Y%m%d-%H%M)"
FICHERO="$DESTINO/radar-$FECHA.dump"

limpiar() { unset PGPASSWORD; }
trap limpiar EXIT

# Formato personalizado: comprime solo y permite restaurar tablas sueltas
# sin tener que tragarse el volcado entero.
if ! pg_dump -h "$HOST_BD" -p "$PUERTO" -U "$USUARIO" -d "$BASE" \
     -Fc -Z 6 -f "$FICHERO" 2>/dev/null; then
  apunte 'ERROR: pg_dump fallo'
  rm -f "$FICHERO"
  exit 1
fi

MB="$(du -m "$FICHERO" | cut -f1)"

# --- La comprobacion que hace que esto sea una copia de verdad --------------
# pg_restore --list lee el indice del volcado. Si el fichero esta truncado o
# corrupto, falla aqui y no dentro de seis meses cuando haga falta de verdad.
TABLAS="$(pg_restore --list "$FICHERO" 2>/dev/null | grep -c 'TABLE DATA')"
if (( TABLAS < 5 )); then
  apunte "ERROR: el volcado no se puede leer o esta incompleto, solo $TABLAS tablas"
  rm -f "$FICHERO"
  exit 1
fi

apunte "Copia hecha: radar-$FECHA.dump  $MB MB  $TABLAS tablas  verificada"

# --- Limpieza de las viejas -------------------------------------------------
while IFS= read -r vieja; do
  [[ -n "$vieja" ]] || continue
  rm -f "$vieja"
  apunte "Borrada por antigua: $(basename "$vieja")"
done < <(find "$DESTINO" -maxdepth 1 -name 'radar-*.dump' -mtime "+$DIAS")

QUEDAN="$(find "$DESTINO" -maxdepth 1 -name 'radar-*.dump' | wc -l)"
TOTAL_MB="$(du -sm "$DESTINO" | cut -f1)"
apunte "Quedan $QUEDAN copias, $TOTAL_MB MB en total"
