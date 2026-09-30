#!/usr/bin/env bash
# ============================================================================
#  Montar Crypto Radar en un servidor Ubuntu 24.04 limpio
#
#    sudo bash instalar-servidor-nuevo.sh <copia.dump> <nombre-del-host>
#
#  Ejemplo:
#    sudo bash instalar-servidor-nuevo.sh /root/radar-20260909-0330.dump radar.62-171-135-13.sslip.io
#
#  Antes hace falta tener en el servidor:
#    - Node.js 24, PostgreSQL 16, nginx, certbot, ufw (apt + NodeSource)
#    - el repositorio en /root/radar.bundle (git bundle create ... --all)
#    - la copia de la base de datos que se quiera restaurar
#
#  QUE HACE
#    1. Usuario de sistema 'radar' y carpetas
#    2. Codigo con su historial completo y sus etiquetas, para que la version
#       congelada para la revision siga pudiendo comprobarse
#    3. Dependencias y compilacion
#    4. Base de datos con contrasena propia, y la copia restaurada
#    5. .env con secretos nuevos. Arranca con ALERTS_MUTED=true: hasta que se
#       confirme que el servidor viejo no sigue vivo, este no avisa a nadie
#    6. Servicio, copia de seguridad nocturna y proteccion de memoria
#    7. nginx con HTTPS y cortafuegos
#
#  Se puede repetir: lo que ya esta hecho se deja como esta. En particular, el
#  .env y la base de datos NO se tocan si ya existen.
# ============================================================================
set -euo pipefail

DUMP="${1:?falta la ruta de la copia .dump}"
DOMINIO="${2:?falta el nombre del host}"
APP=/opt/crypto-radar
BUNDLE=/root/radar.bundle
COPIAS=/var/backups/crypto-radar/bd

azul() { printf '\n\033[1;34m%s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  OK  %s\033[0m\n' "$*"; }
mal()  { printf '\033[1;31m  X   %s\033[0m\n' "$*"; }
[[ $EUID -eq 0 ]] || { mal "hay que ejecutarlo como root"; exit 1; }
[[ -f "$DUMP" ]] || { mal "no existe $DUMP"; exit 1; }

# ----------------------------------------------------------------------------
azul "1/7  Usuario y carpetas"
# --user-group explicito: en algunas imagenes useradd --system no crea el grupo
# por su cuenta, y sin grupo 'radar' fallan todos los chown de despues.
getent group radar >/dev/null || groupadd --system radar
id radar >/dev/null 2>&1 || useradd --system --gid radar --create-home --home-dir /var/lib/radar --shell /usr/sbin/nologin radar
[[ "$(id -gn radar)" == radar ]] || usermod -g radar radar
mkdir -p "$COPIAS"
ok "usuario radar"

# ----------------------------------------------------------------------------
azul "2/7  Codigo"
if [[ ! -d "$APP/.git" ]]; then
  git clone -q "$BUNDLE" "$APP"
  git -C "$APP" remote set-url origin git@github.com:bytecrafterz/crypto_radar.git
fi
git config --global --add safe.directory "$APP" 2>/dev/null || true
mkdir -p "$APP/logs"
chown -R radar:radar "$APP" /var/backups/crypto-radar
ok "codigo en $(git -C "$APP" log --oneline -1)"
git -C "$APP" tag -l | grep -q entrega-revision-20260906 && ok "etiqueta de la revision presente"

# ----------------------------------------------------------------------------
azul "3/7  Dependencias y compilacion"
sudo -u radar env HOME=/var/lib/radar bash -c "cd $APP && npm ci --no-audit --no-fund --loglevel=error"
sudo -u radar env HOME=/var/lib/radar bash -c "cd $APP && ./node_modules/.bin/tsc -p tsconfig.json"
ok "compilado"

# ----------------------------------------------------------------------------
azul "4/7  Base de datos"
if [[ -f "$APP/.env" ]] && grep -q '^DATABASE_URL=' "$APP/.env"; then
  DBPASS="$(grep '^DATABASE_URL=' "$APP/.env" | sed -E 's|.*://radar:([^@]+)@.*|\1|')"
else
  DBPASS="$(openssl rand -hex 24)"
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='radar'" | grep -q 1; then
  sudo -u postgres psql -q -c "CREATE ROLE radar LOGIN"
  ok "rol radar creado"
fi
# Siempre, no solo al crearlo: si una ejecucion anterior se corto antes de
# escribir el .env, el rol se habria quedado con una contrasena que ya no
# esta en ningun sitio.
sudo -u postgres psql -q -c "ALTER ROLE radar PASSWORD '$DBPASS'"
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='radar'" | grep -q 1; then
  sudo -u postgres createdb -O radar radar
  ok "base de datos radar creada"
fi
if ! sudo -u postgres psql -d radar -tAc "SELECT 1 FROM information_schema.tables WHERE table_name='tokens'" | grep -q 1; then
  echo "  restaurando $(basename "$DUMP") ..."
  # pg_restore corre como el usuario postgres, que no puede leer /root. La
  # copia se deja en la carpeta de copias del servidor, que es ademas donde
  # tiene que estar: pasa a ser la primera copia de esta maquina.
  install -o radar -g radar -m 644 "$DUMP" "$COPIAS/$(basename "$DUMP")"
  # Todo lo de la copia ya pertenece a 'radar', asi que se restaura tal cual.
  sudo -u postgres pg_restore -d radar -j 4 "$COPIAS/$(basename "$DUMP")"
  sudo -u postgres psql -d radar -q -c "ANALYZE"
  ok "copia restaurada: $(sudo -u postgres psql -d radar -tAc 'SELECT COUNT(*) FROM tokens') tokens"
else
  ok "la base de datos ya tenia datos; no se restaura encima"
fi

# ----------------------------------------------------------------------------
azul "5/7  Configuracion (.env)"
if [[ ! -f "$APP/.env" ]]; then
  PANEL="$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 14)"
  cat > "$APP/.env" <<ENV
# Crypto Radar - generado por instalar-servidor-nuevo.sh el $(date -I)
DATABASE_URL=postgres://radar:${DBPASS}@127.0.0.1:5432/radar

PANEL_PASSWORD=${PANEL}
SESSION_SECRET=$(openssl rand -hex 32)
API_SHARED_SECRET=$(openssl rand -hex 32)
PORT=3000
HOST=127.0.0.1
NODE_ENV=production
LOG_LEVEL=info
WORKER_ENABLED=true

# Silenciado hasta confirmar que el servidor anterior no sigue enviando avisos.
ALERTS_MUTED=true

# --- Avisos (rellenar) ---
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
DISCORD_WEBHOOK_URL=

# --- Robot 2: bot y cuenta de usuario de Telegram (rellenar) ---
TELEGRAM_RADAR_TOKEN=
TELEGRAM_API_ID=
TELEGRAM_API_HASH=
TELEGRAM_SESSION=

# --- Proveedores de datos (sin clave se usan los RPC publicos, mas lentos) ---
HELIUS_API_KEY=
ALCHEMY_API_KEY=
BASE_LOGS_RPC_URL=https://mainnet.base.org
BASESCAN_API_KEY=

# --- Clasificador de mensajes (rellenar) ---
LLM_PROVIDER=openai
LLM_MODEL=qwen/qwen3.8-27b
LLM_API_KEY=
ENV
  chown radar:radar "$APP/.env"; chmod 600 "$APP/.env"
  ok ".env creado con secretos nuevos"
else
  ok ".env ya existia; no se toca"
fi

# ----------------------------------------------------------------------------
azul "6/7  Servicios"
cat > /etc/systemd/system/crypto-radar.service <<'UNIT'
[Unit]
Description=Crypto Radar - panel y avisos
After=network-online.target postgresql.service
Wants=network-online.target
Requires=postgresql.service

[Service]
Type=exec
User=radar
Group=radar
WorkingDirectory=/opt/crypto-radar
EnvironmentFile=/opt/crypto-radar/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
TimeoutStopSec=30
# Si la maquina se queda sin memoria, que caiga cualquier otra cosa antes.
OOMScoreAdjust=-800
StandardOutput=journal
StandardError=journal
SyslogIdentifier=crypto-radar
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/crypto-radar/logs /var/backups/crypto-radar

[Install]
WantedBy=multi-user.target
UNIT
install -m 644 "$APP/scripts/systemd/crypto-radar-backup.service" /etc/systemd/system/
install -m 644 "$APP/scripts/systemd/crypto-radar-backup.timer"   /etc/systemd/system/
cat > /etc/default/earlyoom <<'CONF'
EARLYOOM_ARGS="-r 3600 -m 5 -s 10 --prefer '(^|/)(claude|chrome.*|chromium.*|next-server.*|python3?.*)$' --avoid '(^|/)(postgres|nginx|sshd|systemd|systemd-journal)$'"
CONF
systemctl daemon-reload
systemctl enable --now postgresql earlyoom >/dev/null 2>&1
systemctl enable --now crypto-radar-backup.timer >/dev/null 2>&1
systemctl enable crypto-radar >/dev/null 2>&1
systemctl restart crypto-radar
for i in $(seq 1 60); do
  curl -fsS http://127.0.0.1:3000/salud >/dev/null 2>&1 && break
  (( i == 60 )) && { mal "el panel no responde: journalctl -u crypto-radar -n 40 --no-pager"; exit 1; }
  sleep 2
done
ok "crypto-radar en marcha y respondiendo"
ok "copia nocturna programada: $(systemctl list-timers crypto-radar-backup --no-pager | sed -n 2p | awk '{print $1, $2, $3}')"

# ----------------------------------------------------------------------------
azul "7/7  Web y cortafuegos"
ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
ok "cortafuegos: solo 22, 80 y 443"

mkdir -p /var/www/acme
rm -f /etc/nginx/sites-enabled/default
SITIO=/etc/nginx/sites-available/crypto-radar
if [[ ! -f "/etc/letsencrypt/live/$DOMINIO/fullchain.pem" ]]; then
  cat > "$SITIO" <<NGX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMINIO;
    location ^~ /.well-known/acme-challenge/ { root /var/www/acme; default_type "text/plain"; }
    location / { return 404; }
}
NGX
  ln -sfn "$SITIO" /etc/nginx/sites-enabled/crypto-radar
  nginx -t -q && systemctl reload nginx
  certbot certonly --webroot -w /var/www/acme -d "$DOMINIO" --non-interactive --agree-tos \
    --register-unsafely-without-email -q
  ok "certificado emitido para $DOMINIO"
fi
cat > "$SITIO" <<NGX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMINIO;
    location ^~ /.well-known/acme-challenge/ { root /var/www/acme; default_type "text/plain"; }
    location / { return 301 https://\$host\$request_uri; }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name $DOMINIO;

    ssl_certificate     /etc/letsencrypt/live/$DOMINIO/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMINIO/privkey.pem;

    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options    "nosniff" always;
    add_header X-Frame-Options           "SAMEORIGIN" always;
    add_header Referrer-Policy           "no-referrer" always;
    add_header X-Robots-Tag              "noindex, nofollow" always;

    client_max_body_size 2m;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
NGX
ln -sfn "$SITIO" /etc/nginx/sites-enabled/crypto-radar
nginx -t -q && systemctl reload nginx
if curl -fsS --max-time 15 -o /dev/null "https://$DOMINIO/entrar"; then
  ok "panel publico: https://$DOMINIO"
else
  mal "https://$DOMINIO no responde todavia"
fi

azul "Terminado"
echo "  Panel:  https://$DOMINIO"
echo "  Contrasena del panel: $(grep '^PANEL_PASSWORD=' "$APP/.env" | cut -d= -f2-)"
echo "  Avisos: SILENCIADOS (ALERTS_MUTED=true) hasta confirmar que el servidor viejo esta parado"
