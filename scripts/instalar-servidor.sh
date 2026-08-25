#!/usr/bin/env bash
# ==========================================================
#  Preparacion del servidor - se ejecuta UNA sola vez
#
#    bash scripts/instalar-servidor.sh
#
#  Instala Docker, configura el cortafuegos, ajusta la zona horaria
#  y crea memoria de intercambio si el servidor tiene poca RAM.
# ==========================================================
set -euo pipefail

azul() { printf '\033[1;34m%s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  OK  %s\033[0m\n' "$*"; }
aviso(){ printf '\033[1;33m  !   %s\033[0m\n' "$*"; }

if [[ $EUID -ne 0 ]]; then
  echo "Este script necesita ejecutarse como root. Usa: sudo bash $0"
  exit 1
fi

azul "1/6  Actualizando el sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
ok "sistema actualizado"

azul "2/6  Zona horaria"
timedatectl set-timezone Europe/Madrid || aviso "no se pudo cambiar la zona horaria"
ok "$(date)"

azul "3/6  Docker"
if command -v docker >/dev/null 2>&1; then
  ok "Docker ya estaba instalado: $(docker --version)"
else
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
  ok "$(docker --version)"
fi

azul "4/6  Memoria de intercambio"
RAM_MB=$(free -m | awk '/^Mem:/{print $2}')
if [[ -f /swapfile ]]; then
  ok "ya existe /swapfile"
elif (( RAM_MB < 3000 )); then
  aviso "el servidor tiene ${RAM_MB} MB de RAM, se crea 2 GB de swap por seguridad"
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ok "swap activada"
else
  ok "${RAM_MB} MB de RAM, no hace falta swap"
fi

azul "5/6  Cortafuegos"
apt-get install -y -qq ufw
ufw allow 22/tcp   >/dev/null
ufw allow 80/tcp   >/dev/null
ufw allow 443/tcp  >/dev/null
ufw allow 3000/tcp >/dev/null
ufw --force enable >/dev/null
ok "puertos abiertos: 22 (ssh), 80, 443, 3000 (panel)"

azul "6/6  Carpetas del proyecto"
mkdir -p /opt/crypto-radar /opt/backups
ok "/opt/crypto-radar y /opt/backups listos"

echo
azul "Servidor preparado."
echo "Siguiente paso: subir el proyecto a /opt/crypto-radar y ejecutar:"
echo "    cd /opt/crypto-radar && bash scripts/desplegar.sh"
