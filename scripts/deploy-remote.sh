#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="habla"
SERVICE_NAME="habla"
INSTALL_DIR="/var/www/habla"
DATA_DIR="/var/lib/habla"
SERVICE_USER="www-data"
SERVICE_GROUP="www-data"
PORT="3000"
PROXY_MODE="auto"
DOMAIN=""
CADDY_EMAIL=""
SSH_PORT="22"
DRY_RUN=false
SKIP_BUILD=false
SSH_TARGET=""
SSH_CONTROL_PATH="${TMPDIR:-/tmp}/habla-ssh-%C"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

log() {
	printf '[deploy] %s\n' "$*"
}

warn() {
	printf '[deploy] warning: %s\n' "$*" >&2
}

die() {
	printf '[deploy] error: %s\n' "$*" >&2
	exit 1
}

usage() {
	cat <<'EOF'
Usage:
  scripts/deploy-remote.sh --host user@server [options]

Options:
  --host <user@host>       SSH target for the remote server
  --port <port>            App port on the remote host (default: 3000)
  --install-dir <path>     Remote install path (default: /var/www/habla)
  --data-dir <path>        Remote writable data dir (default: /var/lib/habla)
  --service-user <user>    Systemd service user (default: www-data)
  --service-group <group>  Systemd service group (default: www-data)
  --proxy auto|caddy|nginx|none  Reverse proxy mode (default: auto)
  --domain <hostname>      Reverse proxy hostname (required for caddy/nginx)
  --caddy-email <email>    Caddy ACME contact email
  --ssh-port <port>        SSH port (default: 22)
  --skip-build             Skip the local build step
  --dry-run                Print actions without executing them
  -h, --help               Show this help

Environment overrides:
  HABLA_SSH_TARGET, HABLA_PORT, HABLA_INSTALL_DIR, HABLA_DATA_DIR,
  HABLA_SERVICE_USER, HABLA_SERVICE_GROUP, HABLA_PROXY, HABLA_DOMAIN,
  HABLA_CADDY_EMAIL, HABLA_SSH_PORT, HABLA_DRY_RUN, HABLA_SKIP_BUILD
EOF
}

is_true() {
	case "${1,,}" in
		1|true|yes|on) return 0 ;;
		*) return 1 ;;
	esac
}

ssh_common_opts() {
	printf '%s\0' \
		-o "ControlMaster=auto" \
		-o "ControlPersist=10m" \
		-o "ControlPath=${SSH_CONTROL_PATH}" \
		-o "ServerAliveInterval=30" \
		-o "ServerAliveCountMax=3"
}

run_local() {
	if [[ "$DRY_RUN" == true ]]; then
		printf '[dry-run] '
		printf '%q ' "$@"
		printf '\n'
		return 0
	fi
	"$@"
}

open_ssh_master() {
	if [[ "$DRY_RUN" == true ]]; then
		printf '[dry-run] ssh -MNf -p %s %s\n' "$SSH_PORT" "$SSH_TARGET"
		return 0
	fi
	ssh -MNf -p "$SSH_PORT" \
		-o "ControlMaster=auto" \
		-o "ControlPersist=10m" \
		-o "ControlPath=${SSH_CONTROL_PATH}" \
		"$SSH_TARGET"
}

ssh_cmd() {
	ssh -p "$SSH_PORT" \
		-o "ControlMaster=auto" \
		-o "ControlPersist=10m" \
		-o "ControlPath=${SSH_CONTROL_PATH}" \
		"$@"
}

run_remote() {
	local script="$1"
	shift || true
	local remote_args
	printf -v remote_args '%q %q %q %q %q %q %q %q %q' \
		"$INSTALL_DIR" "$DATA_DIR" "$SERVICE_NAME" "$SERVICE_USER" "$SERVICE_GROUP" "$PORT" "$PROXY_MODE" "$DOMAIN" "$CADDY_EMAIL"
	if [[ "$DRY_RUN" == true ]]; then
		printf '[dry-run] ssh -tt -p %s -o ControlMaster=auto -o ControlPersist=10m -o ControlPath=%q %s bash -s -- %s\n' \
			"$SSH_PORT" "$SSH_TARGET" "$remote_args"
		printf '%s\n' "$script"
		return 0
	fi
	ssh -tt -p "$SSH_PORT" \
		-o "ControlMaster=auto" \
		-o "ControlPersist=10m" \
		-o "ControlPath=${SSH_CONTROL_PATH}" \
		"$SSH_TARGET" "bash -s -- $remote_args" <<<"$script"
}

build_app() {
	if [[ "$SKIP_BUILD" == true ]]; then
		log "skipping local build"
		return
	fi

	log "installing local dependencies"
	(
		cd "$REPO_ROOT"
		npm ci
	)

	log "building local app"
	(
		cd "$REPO_ROOT"
		npm run build
	)
}

sync_app() {
	log "syncing repository to ${SSH_TARGET}:${INSTALL_DIR}"
	run_local rsync -az --delete --no-owner --no-group -e "ssh -p ${SSH_PORT} -o ControlMaster=auto -o ControlPersist=10m -o ControlPath=${SSH_CONTROL_PATH}" \
		--exclude='.git' \
		--exclude='.claude' \
		--exclude='cache.db' \
		--exclude='cache.db-shm' \
		--exclude='cache.db-wal' \
		--exclude='node_modules' \
		--exclude='dist' \
		--exclude='coverage' \
		"${REPO_ROOT}/" "${SSH_TARGET}:${INSTALL_DIR}/"

	if [[ -d "${REPO_ROOT}/build" ]]; then
		log "syncing build artifacts"
		run_local rsync -az --delete --no-owner --no-group -e "ssh -p ${SSH_PORT} -o ControlMaster=auto -o ControlPersist=10m -o ControlPath=${SSH_CONTROL_PATH}" \
			"${REPO_ROOT}/build/" "${SSH_TARGET}:${INSTALL_DIR}/build/"
	fi
}

install_remote_service() {
	local remote_script
	remote_script="$(cat <<'EOF'
set -Eeuo pipefail

INSTALL_DIR="$1"
DATA_DIR="$2"
SERVICE_NAME="$3"
SERVICE_USER="$4"
SERVICE_GROUP="$5"
PORT="$6"
PROXY_MODE="$7"
DOMAIN="$8"
CADDY_EMAIL="$9"

log() {
	printf '[remote] %s\n' "$*"
}

warn() {
	printf '[remote] warning: %s\n' "$*" >&2
}

die() {
	printf '[remote] error: %s\n' "$*" >&2
	exit 1
}

sudo_run() {
	sudo -n "$@"
}

port_is_listening() {
	ss -H -ltn "sport = :${PORT}" | grep -q .
}

service_is_active() {
	sudo_run systemctl is-active --quiet "${SERVICE_NAME}.service"
}

choose_port() {
	local candidate="$PORT"
	while ss -H -ltn "sport = :${candidate}" | grep -q .; do
		candidate=$((candidate + 1))
		if (( candidate > 65535 )); then
			die "no free ports available starting from ${PORT}"
		fi
	done
	if [[ "$candidate" != "$PORT" ]]; then
		warn "port ${PORT} is in use; using ${candidate} instead"
	fi
	PORT="$candidate"
}

write_server_env() {
	local tmp
	tmp="$(mktemp)"
	{
		printf 'PORT=%s\n' "$PORT"
		printf 'HOST=0.0.0.0\n'
		printf 'SQLITE_PATH=%s/cache.db\n' "$DATA_DIR"
	} >"$tmp"
	sudo_run install -d -m 0755 "$DATA_DIR"
	sudo_run install -m 0644 "$tmp" "${DATA_DIR}/server.env"
	rm -f "$tmp"
}

wait_for_ready() {
	local attempt
	for attempt in $(seq 1 30); do
		if service_is_active && port_is_listening; then
			return 0
		fi
		sleep 1
	done

	warn "service did not become ready on port ${PORT}"
	sudo_run systemctl status "${SERVICE_NAME}.service" --no-pager -l || true
	sudo_run journalctl -u "${SERVICE_NAME}.service" --no-pager -n 100 || true
	die "service failed to bind to port ${PORT}"
}

verify_build_artifacts() {
	local server_build
	server_build="$(find "${INSTALL_DIR}/build/server" -type f -name index.js -print -quit 2>/dev/null || true)"
	if [[ -z "$server_build" ]]; then
		die "missing build artifact under ${INSTALL_DIR}/build/server"
	fi
}

is_true() {
	case "${1,,}" in
		1|true|yes|on) return 0 ;;
		*) return 1 ;;
	esac
}

trim() {
	sed 's/^[[:space:]]*//; s/[[:space:]]*$//'
}

managed_marker="# managed by habla"
proxy_mode_resolved="$PROXY_MODE"

command -v npm >/dev/null 2>&1 || die "npm is required on the remote server"
command -v node >/dev/null 2>&1 || die "node is required on the remote server"
command -v systemctl >/dev/null 2>&1 || die "systemctl is required on the remote server"
command -v ss >/dev/null 2>&1 || die "ss is required on the remote server"

log "refreshing sudo credentials"
sudo -v

if [[ "$proxy_mode_resolved" == "auto" ]]; then
	if command -v caddy >/dev/null 2>&1; then
		proxy_mode_resolved="caddy"
	elif command -v nginx >/dev/null 2>&1; then
		proxy_mode_resolved="nginx"
	else
		proxy_mode_resolved="none"
	fi
fi

if [[ "$proxy_mode_resolved" != "none" && -z "$DOMAIN" ]]; then
	die "a domain is required when reverse proxying"
fi

write_managed_file() {
	local target="$1"
	local content="$2"
	if [[ -f "$target" ]] && ! grep -qF "$managed_marker" "$target"; then
		die "${target} exists and is not managed by this script; refusing to overwrite"
	fi
	local tmp
	tmp="$(mktemp)"
	printf '%s\n' "$content" >"$tmp"
	sudo_run install -d -m 0755 "$(dirname "$target")"
	sudo_run install -m 0644 "$tmp" "$target"
	rm -f "$tmp"
}

install_service() {
	local server_build_resolver
	server_build_resolver='server_build=$(find ./build/server -type f -name index.js -print -quit); [ -n "$server_build" ] || { echo "missing build artifact under ./build/server" >&2; exit 1; }; exec ./node_modules/.bin/react-router-serve "$server_build"'
	cat >/tmp/${SERVICE_NAME}.service <<SERVICEEOF
[Unit]
Description=${SERVICE_NAME} web app
After=network.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
Environment=NODE_ENV=production
EnvironmentFile=${DATA_DIR}/server.env
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
ExecStart=/bin/sh -lc '${server_build_resolver}'
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICEEOF

	sudo_run install -m 0644 /tmp/${SERVICE_NAME}.service /etc/systemd/system/${SERVICE_NAME}.service
	rm -f /tmp/${SERVICE_NAME}.service
}

detect_caddy_snippet_dir() {
	local main_file="/etc/caddy/Caddyfile"
	local dir
	if [[ -n "${HABLA_CADDY_SNIPPET_DIR:-}" ]]; then
		printf '%s' "$HABLA_CADDY_SNIPPET_DIR"
		return 0
	fi
	if [[ -f "$main_file" ]]; then
		for dir in /etc/caddy/conf.d /etc/caddy/Caddyfile.d; do
			if grep -qE "^[[:space:]]*import[[:space:]].*${dir}/\\*\\.caddy" "$main_file" 2>/dev/null; then
				printf '%s' "$dir"
				return 0
			fi
		done
	fi
	for dir in /etc/caddy/conf.d /etc/caddy/Caddyfile.d; do
		if [[ -d "$dir" ]]; then
			printf '%s' "$dir"
			return 0
		fi
	done
	printf '%s' /etc/caddy/conf.d
}

configure_caddy() {
	local domain="$1"
	local port="$2"
	local main_file="/etc/caddy/Caddyfile"
	local snippet_dir snippet_file import_line content
	snippet_dir="$(detect_caddy_snippet_dir)"
	snippet_file="${snippet_dir}/${SERVICE_NAME}.caddy"
	import_line="import ${snippet_dir}/*.caddy"

	log "configuring caddy for ${domain}"
	sudo_run install -d -m 0755 "$snippet_dir"
	content="${managed_marker}
${domain} {
	${CADDY_EMAIL:+tls ${CADDY_EMAIL}}
	encode zstd gzip
	reverse_proxy localhost:${port}
}"
	write_managed_file "$snippet_file" "$content"

	if [[ ! -f "$main_file" ]]; then
		write_managed_file "$main_file" "${managed_marker}
${import_line}"
	else
		if grep -qE '^[[:space:]]*import[[:space:]].*(/etc/caddy/)?(conf\.d|Caddyfile\.d)/\*\.caddy' "$main_file"; then
			log "existing Caddyfile already imports a snippet directory; leaving it unchanged"
		else
			warn "existing Caddyfile does not import ${snippet_dir}; not modifying it"
			warn "add this line manually if needed: ${import_line}"
		fi
	fi

	if command -v caddy >/dev/null 2>&1; then
		sudo_run caddy validate --config "$main_file"
	fi
}

detect_nginx_style() {
	local nginx_main="/etc/nginx/nginx.conf"
	if [[ -n "${HABLA_NGINX_STYLE:-}" ]]; then
		printf '%s' "$HABLA_NGINX_STYLE"
		return 0
	fi
	if [[ -f "$nginx_main" ]] && grep -qE 'include[[:space:]]+.*/conf\.d/\*\.conf;' "$nginx_main"; then
		printf '%s' "conf.d"
		return 0
	fi
	if [[ -f "$nginx_main" ]] && grep -qE 'include[[:space:]]+.*/sites-enabled/\*;' "$nginx_main"; then
		printf '%s' "sites"
		return 0
	fi
	printf '%s' "unknown"
}

configure_nginx() {
	local domain="$1"
	local port="$2"
	local style
	local nginx_main="/etc/nginx/nginx.conf"
	style="$(detect_nginx_style)"

	log "configuring nginx for ${domain}"
	case "$style" in
		conf.d)
			local conf_file="/etc/nginx/conf.d/${SERVICE_NAME}.conf"
			local content
			content="${managed_marker}
server {
	listen 80;
	server_name ${domain};

	location / {
		proxy_pass http://127.0.0.1:${port};
		proxy_http_version 1.1;
		proxy_set_header Upgrade \$http_upgrade;
		proxy_set_header Connection \"upgrade\";
		proxy_set_header Host \$host;
		proxy_set_header X-Real-IP \$remote_addr;
		proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto \$scheme;
		proxy_read_timeout 3600;
		proxy_send_timeout 3600;
	}
}"
			write_managed_file "$conf_file" "$content"
			;;
		sites)
			local sites_available="/etc/nginx/sites-available/${SERVICE_NAME}.conf"
			local sites_enabled="/etc/nginx/sites-enabled/${SERVICE_NAME}.conf"
			local content
			content="${managed_marker}
server {
	listen 80;
	server_name ${domain};

	location / {
		proxy_pass http://127.0.0.1:${port};
		proxy_http_version 1.1;
		proxy_set_header Upgrade \$http_upgrade;
		proxy_set_header Connection \"upgrade\";
		proxy_set_header Host \$host;
		proxy_set_header X-Real-IP \$remote_addr;
		proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto \$scheme;
		proxy_read_timeout 3600;
		proxy_send_timeout 3600;
	}
}"
			write_managed_file "$sites_available" "$content"
			if [[ -e "$sites_enabled" && ! -L "$sites_enabled" ]]; then
				die "${sites_enabled} exists and is not a symlink; refusing to overwrite"
			fi
			if [[ -L "$sites_enabled" ]]; then
				local current_target
				current_target="$(readlink "$sites_enabled")"
				if [[ "$current_target" != "$sites_available" ]]; then
					die "${sites_enabled} points to ${current_target}; refusing to change it"
				fi
			else
			sudo_run ln -s "$sites_available" "$sites_enabled"
			fi
			;;
		unknown)
			warn "/etc/nginx/nginx.conf does not clearly enable conf.d or sites-enabled"
			warn "leaving nginx configuration unchanged"
			return 0
			;;
	esac

	sudo_run nginx -t
	sudo_run systemctl reload nginx 2>/dev/null || sudo_run systemctl restart nginx
}

configure_proxy() {
	case "$proxy_mode_resolved" in
		none)
			log "reverse proxy disabled"
			return 0
			;;
		caddy)
			command -v caddy >/dev/null 2>&1 || die "caddy is not installed on the remote server"
			configure_caddy "$DOMAIN" "$PORT"
			;;
		nginx)
			command -v nginx >/dev/null 2>&1 || die "nginx is not installed on the remote server"
			configure_nginx "$DOMAIN" "$PORT"
			;;
		*)
			die "unknown proxy mode: $proxy_mode_resolved"
			;;
	esac
}

cd "$INSTALL_DIR"

log "normalizing ownership"
local_deploy_user="$(id -un)"
sudo_run mkdir -p "$INSTALL_DIR" "$DATA_DIR"
sudo_run chown -R "$local_deploy_user:$local_deploy_user" "$INSTALL_DIR"
sudo_run chown -R "$SERVICE_USER:$SERVICE_GROUP" "$DATA_DIR"
sudo_run chmod 0755 "$INSTALL_DIR" "$DATA_DIR"

log "stopping existing service"
sudo_run systemctl stop "${SERVICE_NAME}.service" 2>/dev/null || true

if port_is_listening; then
	choose_port
fi

write_server_env

log "installing production dependencies"
npm ci --omit=dev --no-audit --no-fund

verify_build_artifacts

log "writing systemd service"
install_service

log "reloading systemd"
sudo_run systemctl daemon-reload
sudo_run systemctl reset-failed "${SERVICE_NAME}.service" 2>/dev/null || true
sudo_run systemctl enable "${SERVICE_NAME}.service"
sudo_run systemctl start "${SERVICE_NAME}.service"

log "smoke testing"
wait_for_ready
curl -fsS "http://127.0.0.1:${PORT}/" >/dev/null

configure_proxy

log "deployment complete"
EOF
)"
	local remote_script_file
	remote_script_file="$(mktemp)"
	printf '%s\n' "$remote_script" >"$remote_script_file"
	if [[ "$DRY_RUN" == true ]]; then
		printf '[dry-run] scp -P %s -o ControlMaster=auto -o ControlPersist=10m -o ControlPath=%q %s %s:%s\n' \
			"$SSH_PORT" "$remote_script_file" "$SSH_TARGET" "/tmp/${SERVICE_NAME}-deploy.sh"
		printf '[dry-run] ssh -tt -p %s -o ControlMaster=auto -o ControlPersist=10m -o ControlPath=%q %s bash %s %q %q %q %q %q %q %q %q\n' \
			"$SSH_PORT" "$SSH_TARGET" "/tmp/${SERVICE_NAME}-deploy.sh" \
			"$INSTALL_DIR" "$DATA_DIR" "$SERVICE_NAME" "$SERVICE_USER" "$SERVICE_GROUP" "$PORT" "$PROXY_MODE" "$DOMAIN" "$CADDY_EMAIL"
		rm -f "$remote_script_file"
		return 0
	fi
	open_ssh_master
	scp -P "$SSH_PORT" \
		-o "ControlMaster=auto" \
		-o "ControlPersist=10m" \
		-o "ControlPath=${SSH_CONTROL_PATH}" \
		"$remote_script_file" "$SSH_TARGET:/tmp/${SERVICE_NAME}-deploy.sh"
	rm -f "$remote_script_file"
	ssh -tt -p "$SSH_PORT" \
		-o "ControlMaster=auto" \
		-o "ControlPersist=10m" \
		-o "ControlPath=${SSH_CONTROL_PATH}" \
		"$SSH_TARGET" "bash /tmp/${SERVICE_NAME}-deploy.sh $(printf '%q ' "$INSTALL_DIR" "$DATA_DIR" "$SERVICE_NAME" "$SERVICE_USER" "$SERVICE_GROUP" "$PORT" "$PROXY_MODE" "$DOMAIN" "$CADDY_EMAIL")"
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--host)
			SSH_TARGET="${2:-}"
			shift 2
			;;
		--port)
			PORT="${2:-}"
			shift 2
			;;
		--install-dir)
			INSTALL_DIR="${2:-}"
			shift 2
			;;
		--service-user)
			SERVICE_USER="${2:-}"
			shift 2
			;;
		--service-group)
			SERVICE_GROUP="${2:-}"
			shift 2
			;;
		--proxy)
			PROXY_MODE="${2:-}"
			shift 2
			;;
		--domain)
			DOMAIN="${2:-}"
			shift 2
			;;
		--caddy-email)
			CADDY_EMAIL="${2:-}"
			shift 2
			;;
		--ssh-port)
			SSH_PORT="${2:-}"
			shift 2
			;;
		--skip-build)
			SKIP_BUILD=true
			shift
			;;
		--dry-run)
			DRY_RUN=true
			shift
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			die "unknown argument: $1"
			;;
	esac
done

SSH_TARGET="${HABLA_SSH_TARGET:-$SSH_TARGET}"
PORT="${HABLA_PORT:-$PORT}"
INSTALL_DIR="${HABLA_INSTALL_DIR:-$INSTALL_DIR}"
SERVICE_USER="${HABLA_SERVICE_USER:-$SERVICE_USER}"
SERVICE_GROUP="${HABLA_SERVICE_GROUP:-$SERVICE_GROUP}"
PROXY_MODE="${HABLA_PROXY:-$PROXY_MODE}"
DOMAIN="${HABLA_DOMAIN:-$DOMAIN}"
CADDY_EMAIL="${HABLA_CADDY_EMAIL:-$CADDY_EMAIL}"
SSH_PORT="${HABLA_SSH_PORT:-$SSH_PORT}"

if is_true "${HABLA_DRY_RUN:-false}"; then
	DRY_RUN=true
fi
if is_true "${HABLA_SKIP_BUILD:-false}"; then
	SKIP_BUILD=true
fi

[[ -n "$SSH_TARGET" ]] || die "an SSH host is required; pass --host user@server or set HABLA_SSH_TARGET"
case "$PROXY_MODE" in
	auto|caddy|nginx|none) ;;
	*) die "invalid proxy mode: $PROXY_MODE" ;;
esac
if [[ "$PROXY_MODE" != "none" && -z "$DOMAIN" ]]; then
	die "a domain is required when proxy mode is ${PROXY_MODE}"
fi
if [[ "$PROXY_MODE" == "caddy" && -z "$CADDY_EMAIL" ]]; then
	warn "no Caddy email provided; Lets Encrypt contact email will be omitted"
fi

command -v rsync >/dev/null 2>&1 || die "rsync is required"
command -v ssh >/dev/null 2>&1 || die "ssh is required"
command -v scp >/dev/null 2>&1 || die "scp is required"
command -v npm >/dev/null 2>&1 || die "npm is required"

build_app
sync_app
install_remote_service

log "done"
