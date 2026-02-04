#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "install.sh: $*" >&2
  exit 1
}

CURL_BIN=${CURL_BIN:-curl}
REPO=${SKILL_CLI_REPO:-skillrecordings/support-cli-rearchitect}
INSTALL_DIR=${SKILL_CLI_INSTALL_DIR:-"$HOME/.local/bin"}
BIN_NAME=${SKILL_CLI_BIN_NAME:-skill}

if ! command -v "$CURL_BIN" >/dev/null 2>&1; then
  fail "curl is required to install the CLI"
fi

resolve_target() {
  if [ -n "${SKILL_CLI_TARGET:-}" ]; then
    echo "$SKILL_CLI_TARGET"
    return
  fi

  local os="${SKILL_CLI_OS:-$(uname -s)}"
  local arch="${SKILL_CLI_ARCH:-$(uname -m)}"

  case "$os" in
    Linux) os="linux" ;;
    Darwin) os="darwin" ;;
    *) fail "unsupported OS: $os" ;;
  esac

  case "$arch" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *) fail "unsupported architecture: $arch" ;;
  esac

  echo "bun-${os}-${arch}"
}

target=$(resolve_target)
asset="skill-${target}"

if [ -n "${SKILL_CLI_ASSET_URL:-}" ]; then
  download_url="$SKILL_CLI_ASSET_URL"
else
  if [ -n "${SKILL_CLI_VERSION:-}" ]; then
    tag="$SKILL_CLI_VERSION"
  else
    tag=$(
      "$CURL_BIN" -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
        | grep -Eo '"tag_name"\s*:\s*"[^"]+"' \
        | head -n 1 \
        | sed -E 's/.*"([^"]+)".*/\1/'
    )
  fi

  if [ -z "${tag:-}" ]; then
    fail "unable to determine latest release tag"
  fi

  download_url="https://github.com/${REPO}/releases/download/${tag}/${asset}"
fi

mkdir -p "$INSTALL_DIR"
install_path="$INSTALL_DIR/$BIN_NAME"

temp_file=$(mktemp)

cleanup() {
  rm -f "$temp_file"
}
trap cleanup EXIT

"$CURL_BIN" -fsSL "$download_url" -o "$temp_file"
chmod +x "$temp_file"

mv "$temp_file" "$install_path"
trap - EXIT

if [ "${SKILL_CLI_SKIP_VERIFY:-}" != "1" ]; then
  if ! "$install_path" --version >/dev/null 2>&1; then
    fail "installed binary failed --version check"
  fi
fi

echo "Installed $BIN_NAME to $install_path"
