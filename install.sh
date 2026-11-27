#!/usr/bin/env bash
# Installatie op Raspberry Pi OS (Bookworm/Trixie, desktopversie).
# Gebruik:  cd infobord && ./install.sh      (als de gewone gebruiker, niet met sudo)
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
USER_NAME="$(id -un)"
PORT="${INFOBORD_PORT:-8080}"

if [ "$(id -u)" -eq 0 ]; then
  echo "Start dit script als de gewone gebruiker (bijv. 'pi'), niet als root." >&2
  exit 1
fi

echo "==> Pakketten installeren"
sudo apt-get update
sudo apt-get install -y python3-venv python3-pip curl cec-utils fonts-noto-core fonts-noto-color-emoji
sudo apt-get install -y chromium || sudo apt-get install -y chromium-browser

echo "==> Python-omgeving maken"
python3 -m venv "$APP_DIR/venv"
"$APP_DIR/venv/bin/pip" install --upgrade pip
"$APP_DIR/venv/bin/pip" install -r "$APP_DIR/requirements.txt"
mkdir -p "$APP_DIR/data"

echo "==> Systemd-service installeren"
sudo tee /etc/systemd/system/infobord.service >/dev/null <<EOF
[Unit]
Description=Infobord scouting
After=network-online.target
Wants=network-online.target

[Service]
User=$USER_NAME
WorkingDirectory=$APP_DIR
Environment=INFOBORD_PORT=$PORT
Environment=INFOBORD_DATA=$APP_DIR/data
ExecStartPre=$APP_DIR/venv/bin/pip install -q -r $APP_DIR/requirements.txt
ExecStart=$APP_DIR/venv/bin/python -m infobord
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now infobord.service

echo "==> Kioskmodus bij opstarten"
chmod +x "$APP_DIR/kiosk.sh"
mkdir -p "$HOME/.config/autostart"
cat > "$HOME/.config/autostart/infobord.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Infobord
Exec=env INFOBORD_URL=http://localhost:$PORT/ $APP_DIR/kiosk.sh
X-GNOME-Autostart-enabled=true
EOF
# (Raspberry Pi OS start ~/.config/autostart/*.desktop onder zowel labwc, wayfire als X11)

echo "==> Systeeminstellingen"
if command -v raspi-config >/dev/null; then
  sudo raspi-config nonint do_boot_behaviour B4 || true   # automatisch inloggen op desktop
  sudo raspi-config nonint do_blanking 1 || true          # scherm niet op zwart laten gaan
fi
sudo timedatectl set-timezone Europe/Amsterdam || true

IP="$(hostname -I | awk '{print $1}')"
echo
echo "Klaar!"
echo "  Scherm:  http://localhost:$PORT/"
echo "  Beheer:  http://$IP:$PORT/admin   (stel daar direct een wachtwoord in)"
echo "Herstart de Pi om de kioskmodus te starten:  sudo reboot"
