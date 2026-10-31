#!/usr/bin/env bash
# channel4444 — one-shot server setup (Ubuntu 22.04+/Debian 12+)
#
# Sets up: swap (small servers), Docker, firewall, Caddy (auto HTTPS), coturn (TURN), the app,
# persistent data, and nightly backups. Safe to re-run: existing secrets
# in .env are kept.
#
# Usage (as root, on the server):
#   DOMAIN=chat.example.com REPO=https://github.com/you/channel4444.git bash setup.sh
#
# Optional variables:
#   APP_DIR        where the app lives          (default /opt/channel4444)
#   BRANCH         git branch to deploy          (default: repo default)
#   DATA_DIR       data path INSIDE container    (default /app/data)  <- check your app
#   ACCESS_PASSWORD shared app password          (default: generated)
#   ADMIN_PASSWORD password for /admin           (default: generated)
#   SSH_PORT       your SSH port                 (default 22)
#   REDIRECT_DOMAINS extra names that redirect to DOMAIN, space-separated
#                  e.g. "channel4444.party www.channel4444.party"
#
# If REPO is not set, the app source must already be in APP_DIR.

set -euo pipefail

DOMAIN="${DOMAIN:-}"
REPO="${REPO:-}"
BRANCH="${BRANCH:-}"
APP_DIR="${APP_DIR:-/opt/channel4444}"
DATA_DIR="${DATA_DIR:-/app/data}"
SSH_PORT="${SSH_PORT:-22}"
REDIRECT_DOMAINS="${REDIRECT_DOMAINS:-}"
APP_PORT=4444

log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mxx %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- checks
[[ $EUID -eq 0 ]] || die "Run as root (sudo -E bash setup.sh)."
[[ -n "$DOMAIN" ]] || die "Set DOMAIN, e.g. DOMAIN=chat.example.com"
command -v apt-get >/dev/null || die "This script supports Ubuntu/Debian only."

export DEBIAN_FRONTEND=noninteractive

# ---------------------------------------------------------------- packages
log "Installing base packages"
apt-get update -y
apt-get install -y ca-certificates curl git ufw openssl dnsutils unattended-upgrades

log "Enabling automatic security updates"
dpkg-reconfigure -f noninteractive unattended-upgrades || true

# Small droplets (512 MB-1 GB) can run out of memory while building the image.
MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [[ $MEM_MB -lt 2000 ]] && ! swapon --show | grep -q .; then
  log "Adding 1 GB swap (server has ${MEM_MB} MB RAM)"
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! command -v docker >/dev/null; then
  log "Installing Docker"
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker
docker compose version >/dev/null || die "docker compose plugin missing."

# ---------------------------------------------------------------- network
PUBLIC_IP="$(curl -fsS4 https://api.ipify.org || curl -fsS4 https://ifconfig.me || true)"
[[ -n "$PUBLIC_IP" ]] || die "Could not detect public IPv4."
log "Public IP: $PUBLIC_IP"

for name in $DOMAIN $REDIRECT_DOMAINS; do
  DNS_IP="$(dig +short A "$name" | tail -n1 || true)"
  if [[ "$DNS_IP" != "$PUBLIC_IP" ]]; then
    warn "$name resolves to '${DNS_IP:-nothing}', not $PUBLIC_IP."
    warn "HTTPS for $name will fail until its DNS A record points here (Cloudflare: grey cloud / DNS only)."
  fi
done

log "Configuring firewall"
ufw allow "${SSH_PORT}/tcp"      # keep SSH open BEFORE enabling
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp                # HTTP/3
ufw allow 3478/tcp               # TURN
ufw allow 3478/udp
ufw allow 49152:65535/udp        # TURN relay range
ufw --force enable

# ---------------------------------------------------------------- source
if [[ -n "$REPO" ]]; then
  if [[ -d "$APP_DIR/.git" ]]; then
    log "Updating app in $APP_DIR"
    git -C "$APP_DIR" pull --ff-only
  else
    log "Cloning $REPO into $APP_DIR"
    git clone ${BRANCH:+--branch "$BRANCH"} "$REPO" "$APP_DIR"
  fi
fi
[[ -f "$APP_DIR/Dockerfile" ]] || die "No Dockerfile in $APP_DIR. Set REPO or copy the app there."
cd "$APP_DIR"
mkdir -p data deploy
# The app runs as the "node" user (uid 1000) inside the container.
chown -R 1000:1000 data

# ---------------------------------------------------------------- secrets
if [[ ! -f .env.prod ]]; then
  log "Generating secrets (.env.prod)"
  gen() { openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 24; }
  cat > .env.prod <<EOF
ACCESS_PASSWORD=${ACCESS_PASSWORD:-$(gen)}
TURN_USERNAME=channel4444
TURN_PASSWORD=$(gen)
EOF
  chmod 600 .env.prod
else
  log "Keeping existing .env.prod"
fi
# Added after the first release: give older installs an admin password too.
if ! grep -q '^ADMIN_PASSWORD=' .env.prod; then
  log "Adding ADMIN_PASSWORD to .env.prod"
  echo "ADMIN_PASSWORD=${ADMIN_PASSWORD:-$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 24)}" >> .env.prod
fi
# shellcheck disable=SC1091
set -a; source .env.prod; set +a

# ---------------------------------------------------------------- configs
log "Writing Caddyfile"
cat > deploy/Caddyfile <<EOF
${DOMAIN} {
    encode gzip
    request_body {
        max_size 25MB
    }
    reverse_proxy app:${APP_PORT}
}
EOF
if [[ -n "$REDIRECT_DOMAINS" ]]; then
  cat >> deploy/Caddyfile <<EOF

$(echo "$REDIRECT_DOMAINS" | xargs | sed 's/ /, /g') {
    redir https://${DOMAIN}{uri} permanent
}
EOF
fi

log "Writing turnserver.conf"
cat > deploy/turnserver.conf <<EOF
listening-port=3478
external-ip=${PUBLIC_IP}
realm=${DOMAIN}
lt-cred-mech
user=${TURN_USERNAME}:${TURN_PASSWORD}
min-port=49152
max-port=65535
fingerprint
no-cli
no-multicast-peers
# Block relaying into private networks (prevents abuse of the TURN server)
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
EOF
chmod 600 deploy/turnserver.conf

log "Writing compose.prod.yml"
cat > compose.prod.yml <<EOF
services:
  app:
    build: .
    restart: unless-stopped
    environment:
      PORT: "${APP_PORT}"
      ACCESS_PASSWORD: \${ACCESS_PASSWORD}
      ADMIN_PASSWORD: \${ADMIN_PASSWORD}
      # The IP, not the domain: a Cloudflare-proxied domain doesn't forward TURN traffic.
      TURN_URL: "turn:${PUBLIC_IP}:3478?transport=udp,turn:${PUBLIC_IP}:3478?transport=tcp"
      TURN_USERNAME: \${TURN_USERNAME}
      TURN_CREDENTIAL: \${TURN_PASSWORD}
    volumes:
      - ./data:${DATA_DIR}
    expose:
      - "${APP_PORT}"

  caddy:
    image: caddy:2
    restart: unless-stopped
    depends_on: [app]
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    volumes:
      - ./deploy/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config

  coturn:
    image: coturn/coturn:latest
    restart: unless-stopped
    network_mode: host
    volumes:
      - ./deploy/turnserver.conf:/etc/coturn/turnserver.conf:ro
    command: ["-c", "/etc/coturn/turnserver.conf"]

volumes:
  caddy_data:
  caddy_config:
EOF

# ---------------------------------------------------------------- run
log "Building and starting containers"
docker compose -f compose.prod.yml --env-file .env.prod up -d --build

# ---------------------------------------------------------------- backups
log "Installing nightly backup (02:30, keeps 14 days)"
cat > /etc/cron.d/channel4444-backup <<EOF
30 2 * * * root mkdir -p /var/backups/channel4444 && tar -czf /var/backups/channel4444/data-\$(date +\%F).tgz -C ${APP_DIR} data .env.prod && find /var/backups/channel4444 -name 'data-*.tgz' -mtime +14 -delete
EOF

# ---------------------------------------------------------------- helper commands
log "Installing helper commands"

# channel4444 <compose args>  — e.g. "channel4444 logs -f", "channel4444 ps", "channel4444 restart"
cat > /usr/local/bin/channel4444 <<EOF
#!/usr/bin/env bash
cd ${APP_DIR} && exec docker compose -f compose.prod.yml --env-file .env.prod "\$@"
EOF

# channel4444-update — pull latest code and rebuild
cat > /usr/local/bin/channel4444-update <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd ${APP_DIR}
git pull --ff-only
chown -R 1000:1000 data
docker compose -f compose.prod.yml --env-file .env.prod up -d --build
docker image prune -f
EOF

# channel4444-password [new]  — show the access password, or change it
cat > /usr/local/bin/channel4444-password <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd ${APP_DIR}
if [[ -z "\${1:-}" ]]; then
  grep '^ACCESS_PASSWORD=' .env.prod | cut -d= -f2-
else
  [[ "\$1" =~ ^[A-Za-z0-9._-]+\$ ]] || { echo "Use letters, numbers, . _ - only"; exit 1; }
  sed -i "s/^ACCESS_PASSWORD=.*/ACCESS_PASSWORD=\$1/" .env.prod
  docker compose -f compose.prod.yml --env-file .env.prod up -d
  echo "Access password changed. Everyone has to enter the new one."
fi
EOF
chmod +x /usr/local/bin/channel4444 /usr/local/bin/channel4444-update /usr/local/bin/channel4444-password

# ---------------------------------------------------------------- health check
log "Waiting for the app to start"
APP_OK=0
for _ in $(seq 1 30); do
  if docker compose -f compose.prod.yml --env-file .env.prod logs app 2>/dev/null | grep -q "running at"; then
    APP_OK=1; break
  fi
  sleep 2
done
docker compose -f compose.prod.yml --env-file .env.prod ps
if [[ $APP_OK -eq 0 ]]; then
  warn "The app did not report that it started. Last log lines:"
  docker compose -f compose.prod.yml --env-file .env.prod logs app --tail 30 || true
fi

# ---------------------------------------------------------------- done
cat <<EOF

------------------------------------------------------------
 channel4444 is deploying at:  https://${DOMAIN}
 (first HTTPS request may take ~30s while the certificate is issued)

 Access password:  ${ACCESS_PASSWORD}
 Admin page:       https://${DOMAIN}/admin   (password: ${ADMIN_PASSWORD})
 Secrets file:     ${APP_DIR}/.env.prod
 Data:             ${APP_DIR}/data   (backups in /var/backups/channel4444)

 Commands:
   channel4444-update            pull latest code and rebuild
   channel4444-password          show the access password
   channel4444-password NEWPASS  change it
   channel4444 logs -f           follow logs
   channel4444 ps                container status
   channel4444 restart           restart everything
------------------------------------------------------------
EOF