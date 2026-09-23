#!/usr/bin/env bash
# Class Connect — installe le serveur de notifications comme service systemd (Debian / Ubuntu).
# Usage (dans le dossier server) :  bash installer-debian.sh
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
USER_NAME="$(id -un)"
SERVICE=class-connect-push

node_major() { command -v node >/dev/null 2>&1 && node -p 'process.versions.node.split(".")[0]' || echo 0; }

# 1. Node.js >= 18
if [ "$(node_major)" -lt 18 ]; then
  echo "▶ Installation de Node.js depuis les dépôts Debian…"
  sudo apt-get update -qq
  sudo apt-get install -y -qq nodejs npm || true
fi
if [ "$(node_major)" -lt 18 ]; then
  echo "▶ La version de Debian est trop ancienne ($(node -v 2>/dev/null || echo 'aucune')) : installation de Node.js 22 via NodeSource…"
  sudo apt-get install -y -qq curl ca-certificates
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y -qq nodejs
fi
echo "✔ Node.js $(node -v)"

# 2. Clé du compte de service
if [ ! -f "$DIR/service-account.json" ]; then
  echo
  echo "✖ Il manque $DIR/service-account.json"
  echo "  Copie-la depuis ton PC Windows, par exemple :"
  echo "  scp Downloads\\service-account.json $USER_NAME@$(hostname -I 2>/dev/null | awk '{print $1}'):$DIR/"
  exit 1
fi
chmod 600 "$DIR/service-account.json"   # lisible par toi seul

# 3. Modules
cd "$DIR"
npm install --omit=dev --no-fund --no-audit --loglevel=error
echo "✔ Modules installés"

# 4. Service systemd : démarre au boot, redémarre en cas de plantage
sudo tee /etc/systemd/system/$SERVICE.service >/dev/null <<EOF
[Unit]
Description=Class Connect - serveur de notifications
After=network-online.target
Wants=network-online.target

[Service]
User=$USER_NAME
WorkingDirectory=$DIR
ExecStart=$(command -v node) $DIR/push-server.mjs
Restart=always
RestartSec=10
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now $SERVICE
sudo systemctl restart $SERVICE
sleep 6

echo
echo "✔ Service installé. Il démarre tout seul à chaque allumage."
echo
sudo journalctl -u $SERVICE -n 8 --no-pager -o cat
echo
echo "Commandes utiles :"
echo "  voir les logs en direct : sudo journalctl -u $SERVICE -f"
echo "  état                    : systemctl status $SERVICE"
echo "  redémarrer              : sudo systemctl restart $SERVICE"
echo "  désinstaller            : sudo systemctl disable --now $SERVICE && sudo rm /etc/systemd/system/$SERVICE.service"
