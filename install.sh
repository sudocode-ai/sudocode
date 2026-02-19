#!/bin/sh
set -e

# sudocode installer
# Usage: curl -fsSL https://raw.githubusercontent.com/sudocode-ai/sudocode/main/install.sh | sh

INSTALL_DIR="${SUDOCODE_INSTALL_DIR:-$HOME/.sudocode/bin}"
GITHUB_REPO="sudocode-ai/sudocode"
GITHUB_RELEASES="https://github.com/${GITHUB_REPO}/releases"
VERSION=""
CHANNEL="stable"
PLATFORM=""
TEMP_DIR=""

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()    { printf "${BLUE}[info]${NC} %s\n" "$1" >&2; }
success() { printf "${GREEN}[ok]${NC} %s\n" "$1" >&2; }
warn()    { printf "${YELLOW}[warn]${NC} %s\n" "$1" >&2; }
error()   { printf "${RED}[error]${NC} %s\n" "$1" >&2; }
die()     { error "$1"; exit 1; }

cleanup() {
  if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then
    rm -rf "$TEMP_DIR"
  fi
}
trap cleanup EXIT INT TERM

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --dev)
        CHANNEL="dev"
        shift
        ;;
      --version)
        [ -z "$2" ] && die "Missing version argument. Usage: --version vX.Y.Z"
        VERSION="$2"
        CHANNEL="version"
        shift 2
        ;;
      --help|-h)
        cat <<EOF
sudocode installer

Usage:
  curl -fsSL https://raw.githubusercontent.com/sudocode-ai/sudocode/main/install.sh | sh
  curl -fsSL https://raw.githubusercontent.com/sudocode-ai/sudocode/main/install.sh | sh -s -- [OPTIONS]

Options:
  --dev              Install latest development build
  --version vX.Y.Z   Install specific version
  --help, -h         Show this help message

Environment:
  SUDOCODE_INSTALL_DIR   Custom install directory (default: \$HOME/.sudocode/bin)
EOF
        exit 0
        ;;
      *) shift ;;
    esac
  done
}

detect_os() {
  case "$(uname -s)" in
    Linux*)  echo "linux" ;;
    Darwin*) echo "darwin" ;;
    *) die "Unsupported OS: $(uname -s). Only Linux and macOS are supported." ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64)   echo "x64" ;;
    aarch64|arm64)   echo "arm64" ;;
    *) die "Unsupported architecture: $(uname -m). Only x64 and arm64 are supported." ;;
  esac
}

detect_libc() {
  [ "$(detect_os)" != "linux" ] && return

  # Check for musl
  if ldd --version 2>&1 | grep -qi musl; then
    echo "-musl"
    return
  fi
  if [ -f /lib/ld-musl-x86_64.so.1 ] || [ -f /lib/ld-musl-aarch64.so.1 ]; then
    echo "-musl"
    return
  fi
}

get_platform() {
  echo "$(detect_os)-$(detect_arch)$(detect_libc)"
}

get_latest_version() {
  info "Fetching latest stable version..."
  VERSION=$(curl -fsSL "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" \
    | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')
  [ -z "$VERSION" ] && die "Failed to fetch latest version. Use --version to specify."
  echo "$VERSION"
}

get_latest_dev_version() {
  info "Fetching latest dev build..."
  VERSION=$(curl -fsSL "https://api.github.com/repos/${GITHUB_REPO}/releases" \
    | grep '"tag_name":' | grep '"dev-' | sed -E 's/.*"([^"]+)".*/\1/' | head -n 1)
  [ -z "$VERSION" ] && die "No dev builds found."
  echo "$VERSION"
}

resolve_version() {
  case "$CHANNEL" in
    stable)  VERSION=$(get_latest_version) ;;
    dev)     VERSION=$(get_latest_dev_version) ;;
    version) ;; # already set
  esac
  info "Installing sudocode $VERSION for $PLATFORM"
}

download_manifest() {
  local url="${GITHUB_RELEASES}/download/${VERSION}/manifest.json"
  local dest="${TEMP_DIR}/manifest.json"
  info "Downloading manifest..."
  curl -fsSL -o "$dest" "$url" || die "Failed to download manifest from $url"
  echo "$dest"
}

parse_manifest() {
  local manifest="$1"
  local platform="$2"

  if command -v jq >/dev/null 2>&1; then
    DOWNLOAD_URL=$(jq -r ".platforms.\"${platform}\".url" "$manifest")
    CHECKSUM=$(jq -r ".platforms.\"${platform}\".sha256" "$manifest")
  else
    # Fallback: grep-based parsing
    local section
    section=$(sed -n "/${platform}/,/}/p" "$manifest")
    DOWNLOAD_URL=$(echo "$section" | grep '"url"' | sed -E 's/.*"url"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
    CHECKSUM=$(echo "$section" | grep '"sha256"' | sed -E 's/.*"sha256"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
  fi

  [ -z "$DOWNLOAD_URL" ] || [ "$DOWNLOAD_URL" = "null" ] && die "Platform $platform not found in manifest."
  [ -z "$CHECKSUM" ] || [ "$CHECKSUM" = "null" ] && die "Checksum not found for $platform."
}

download_tarball() {
  local dest="${TEMP_DIR}/sudocode.tar.gz"
  info "Downloading sudocode..."
  curl -fsSL -o "$dest" "$DOWNLOAD_URL" || die "Download failed: $DOWNLOAD_URL"
  echo "$dest"
}

verify_checksum() {
  local file="$1"
  info "Verifying checksum..."

  local computed
  if command -v sha256sum >/dev/null 2>&1; then
    computed=$(sha256sum "$file" | awk '{print $1}')
  elif command -v shasum >/dev/null 2>&1; then
    computed=$(shasum -a 256 "$file" | awk '{print $1}')
  else
    die "No sha256sum or shasum found."
  fi

  [ "$computed" != "$CHECKSUM" ] && die "Checksum mismatch!\n  Expected: $CHECKSUM\n  Got:      $computed"
  success "Checksum verified"
}

install_binaries() {
  local extract_dir="$1"
  info "Installing to $INSTALL_DIR..."
  mkdir -p "$INSTALL_DIR"

  # Find the extracted directory
  local extracted
  extracted=$(find "$extract_dir" -mindepth 1 -maxdepth 1 -type d | head -n 1)
  [ -z "$extracted" ] && die "Empty archive"

  # Install bin/ contents
  if [ -d "${extracted}/bin" ]; then
    cp -f "${extracted}/bin/"* "$INSTALL_DIR/" 2>/dev/null || true
    # Handle symlinks separately (cp -f may dereference)
    if [ -L "${extracted}/bin/sdc" ]; then
      ln -sf sudocode "$INSTALL_DIR/sdc"
    fi
  fi

  # Install native modules alongside binaries
  if [ -d "${extracted}/node_modules" ]; then
    cp -rf "${extracted}/node_modules" "$INSTALL_DIR/"
  fi

  # Install frontend assets
  if [ -d "${extracted}/public" ]; then
    cp -rf "${extracted}/public" "$INSTALL_DIR/"
  fi

  # Install package.json (for version detection) one level up from bin/
  if [ -f "${extracted}/package.json" ]; then
    local parent_dir
    parent_dir=$(dirname "$INSTALL_DIR")
    cp -f "${extracted}/package.json" "$parent_dir/package.json"
  fi

  chmod +x "$INSTALL_DIR/sudocode" 2>/dev/null || true
  chmod +x "$INSTALL_DIR/sudocode-server" 2>/dev/null || true
  chmod +x "$INSTALL_DIR/sudocode-mcp" 2>/dev/null || true

  success "Installed to $INSTALL_DIR"
}

get_shell_config() {
  case "$(basename "${SHELL:-sh}")" in
    bash)
      if [ -f "$HOME/.bashrc" ]; then echo "$HOME/.bashrc"
      elif [ -f "$HOME/.bash_profile" ]; then echo "$HOME/.bash_profile"
      else echo "$HOME/.bashrc"
      fi ;;
    zsh)  echo "$HOME/.zshrc" ;;
    fish) echo "$HOME/.config/fish/config.fish" ;;
    *)    echo "$HOME/.profile" ;;
  esac
}

add_to_path() {
  if echo "$PATH" | tr ':' '\n' | grep -Fxq "$INSTALL_DIR"; then
    info "$INSTALL_DIR already in PATH"
    return
  fi

  local config
  config=$(get_shell_config)
  local shell_name
  shell_name=$(basename "${SHELL:-sh}")

  mkdir -p "$(dirname "$config")"
  touch "$config"

  if [ "$shell_name" = "fish" ]; then
    printf '\n# sudocode\nset -gx PATH %s $PATH\n' "$INSTALL_DIR" >> "$config"
  else
    printf '\n# sudocode\nexport PATH="%s:$PATH"\n' "$INSTALL_DIR" >> "$config"
  fi

  success "Added to PATH in $config"
  warn "Restart your shell or run: source $config"
}

main() {
  info "sudocode installer"
  echo ""

  parse_args "$@"

  PLATFORM=$(get_platform)
  info "Platform: $PLATFORM"

  TEMP_DIR=$(mktemp -d)

  resolve_version

  MANIFEST=$(download_manifest)
  parse_manifest "$MANIFEST" "$PLATFORM"

  TARBALL=$(download_tarball)
  verify_checksum "$TARBALL"

  EXTRACT_DIR="${TEMP_DIR}/extract"
  mkdir -p "$EXTRACT_DIR"
  tar -xzf "$TARBALL" -C "$EXTRACT_DIR"

  install_binaries "$EXTRACT_DIR"
  add_to_path

  echo ""
  success "sudocode installed!"
  echo ""
  echo "  1. Restart your shell or run: source $(get_shell_config)"
  echo "  2. Verify: sudocode --version"
  echo "  3. Initialize: cd <project> && sudocode init"
  echo ""
}

main "$@"
