#!/usr/bin/env bash
#
# Установка «Малярного цеха» на чистый сервер Ubuntu 24.04.
# Запускать от root уже после того, как файлы лежат в /opt/paint.
#
#   bash /opt/paint/deploy/setup-server.sh ceh.example.ru
#
# Аргумент — домен. Без домена HTTPS не настроить, но программа запустится
# и будет доступна по IP на порту 3000.

set -euo pipefail

DOMAIN="${1:-}"
APP_DIR=/opt/paint
APP_USER=paint

echo "== 1. Пакеты =="
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg rsync sqlite3 ufw debian-keyring debian-archive-keyring apt-transport-https

echo "== 2. Node.js =="
need_node=1
if command -v node >/dev/null 2>&1; then
    major="$(node -v | sed 's/^v//' | cut -d. -f1)"
    if [ "$major" -ge 22 ] 2>/dev/null; then need_node=0; fi
fi

if [ "$need_node" -eq 1 ]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y -qq nodejs
fi
node -v

echo "== 3. Пользователь и права =="
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR/server/data"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo "== 4. Служба =="
install -m 644 "$APP_DIR/deploy/paint.service" /etc/systemd/system/paint.service
systemctl daemon-reload
systemctl enable paint >/dev/null

echo "== 5. Caddy и HTTPS =="
if ! command -v caddy >/dev/null 2>&1; then
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
        | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
        > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq
    apt-get install -y -qq caddy
fi

if [ -n "$DOMAIN" ]; then
    cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
    encode gzip
    reverse_proxy 127.0.0.1:3000
}
EOF
    echo "   домен: $DOMAIN"
else
    echo "   домен не указан — HTTPS не настраиваю"
fi

systemctl reload caddy 2>/dev/null || systemctl restart caddy

echo "== 6. Брандмауэр =="
ufw allow OpenSSH >/dev/null 2>&1 || true
ufw allow 80/tcp >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true
if [ -z "$DOMAIN" ]; then
    ufw allow 3000/tcp >/dev/null 2>&1 || true
fi
ufw --force enable >/dev/null 2>&1 || true

echo "== 7. Резервные копии =="
chmod +x "$APP_DIR/deploy/backup.sh"
echo "15 3 * * * root $APP_DIR/deploy/backup.sh >/dev/null 2>&1" > /etc/cron.d/paint-backup
chmod 644 /etc/cron.d/paint-backup

echo "== 8. Запуск =="
systemctl restart paint
sleep 2
systemctl --no-pager --lines=0 status paint | head -n 5 || true

if curl -fsS --max-time 5 http://127.0.0.1:3000/health >/dev/null; then
    echo "   приложение отвечает: ok"
else
    echo "   ВНИМАНИЕ: приложение не отвечает, смотрите: journalctl -u paint -n 50"
fi

echo
echo "Готово."
if [ -n "$DOMAIN" ]; then
    echo "Открыть: https://$DOMAIN"
else
    echo "Открыть: http://$(curl -fsS --max-time 5 https://api.ipify.org || echo 'IP-сервера'):3000"
fi
