#!/bin/sh
set -e

# sudocode installer
# Usage: curl -fsSL https://raw.githubusercontent.com/sudocode-ai/sudocode/main/install.sh | sh

# XDG-compliant install paths:
#   Package:  ~/.local/share/sudocode/  (binaries, node_modules, public, package.json)
#   Symlinks: ~/.local/bin/             (sudocode, sdc, sudocode-server, sudocode-mcp)
#
# ~/.local/bin is already in PATH on most Linux distros (Ubuntu, Debian, Fedora).
# Override with SUDOCODE_INSTALL_DIR to change the package directory.

PACKAGE_DIR="${SUDOCODE_INSTALL_DIR:-$HOME/.local/share/sudocode}"
BIN_DIR="$HOME/.local/bin"
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
        cat >&2 <<EOF
sudocode installer

Usage:
  curl -fsSL https://raw.githubusercontent.com/sudocode-ai/sudocode/main/install.sh | sh
  curl -fsSL https://raw.githubusercontent.com/sudocode-ai/sudocode/main/install.sh | sh -s -- [OPTIONS]

Options:
  --dev              Install latest development build
  --version vX.Y.Z   Install specific version
  --help, -h         Show this help message

Environment:
  SUDOCODE_INSTALL_DIR   Custom package directory (default: \$HOME/.local/share/sudocode)
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
  if [ -z "$VERSION" ]; then
    die "Failed to fetch latest version. Use --version to specify."
  fi
  echo "$VERSION"
}

get_latest_dev_version() {
  info "Fetching latest dev build..."
  VERSION=$(curl -fsSL "https://api.github.com/repos/${GITHUB_REPO}/releases" \
    | grep '"tag_name":' | grep '"dev-' | sed -E 's/.*"([^"]+)".*/\1/' | head -n 1)
  if [ -z "$VERSION" ]; then
    die "No dev builds found."
  fi
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

  if [ -z "$DOWNLOAD_URL" ] || [ "$DOWNLOAD_URL" = "null" ]; then
    die "Platform $platform not found in manifest."
  fi
  if [ -z "$CHECKSUM" ] || [ "$CHECKSUM" = "null" ]; then
    die "Checksum not found for $platform."
  fi
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

  if [ "$computed" != "$CHECKSUM" ]; then
    die "Checksum mismatch!\n  Expected: $CHECKSUM\n  Got:      $computed"
  fi
  success "Checksum verified"
}

install_binaries() {
  local extract_dir="$1"

  # Find the extracted directory
  local extracted
  extracted=$(find "$extract_dir" -mindepth 1 -maxdepth 1 -type d | head -n 1)
  if [ -z "$extracted" ]; then
    die "Empty archive"
  fi

  # Install package contents to PACKAGE_DIR
  info "Installing to $PACKAGE_DIR..."
  if [ -d "$PACKAGE_DIR" ]; then
    rm -rf "$PACKAGE_DIR"
  fi
  mkdir -p "$PACKAGE_DIR"

  # Copy bin/ contents
  if [ -d "${extracted}/bin" ]; then
    mkdir -p "$PACKAGE_DIR/bin"
    cp -f "${extracted}/bin/"* "$PACKAGE_DIR/bin/" 2>/dev/null || true
    # Recreate sdc symlink (cp -f may dereference)
    if [ -L "${extracted}/bin/sdc" ]; then
      ln -sf sudocode "$PACKAGE_DIR/bin/sdc"
    fi
    chmod +x "$PACKAGE_DIR/bin/sudocode" 2>/dev/null || true
    chmod +x "$PACKAGE_DIR/bin/sudocode-server" 2>/dev/null || true
    chmod +x "$PACKAGE_DIR/bin/sudocode-mcp" 2>/dev/null || true
  fi

  # Copy native modules
  if [ -d "${extracted}/node_modules" ]; then
    cp -rf "${extracted}/node_modules" "$PACKAGE_DIR/"
  fi

  # Copy frontend assets
  if [ -d "${extracted}/public" ]; then
    cp -rf "${extracted}/public" "$PACKAGE_DIR/"
  fi

  # Copy package.json (for version detection)
  if [ -f "${extracted}/package.json" ]; then
    cp -f "${extracted}/package.json" "$PACKAGE_DIR/package.json"
  fi

  success "Installed to $PACKAGE_DIR"

  # Create symlinks in BIN_DIR
  info "Creating symlinks in $BIN_DIR..."
  mkdir -p "$BIN_DIR"
  ln -sf "$PACKAGE_DIR/bin/sudocode" "$BIN_DIR/sudocode"
  ln -sf "$PACKAGE_DIR/bin/sudocode" "$BIN_DIR/sdc"
  ln -sf "$PACKAGE_DIR/bin/sudocode-server" "$BIN_DIR/sudocode-server"
  ln -sf "$PACKAGE_DIR/bin/sudocode-mcp" "$BIN_DIR/sudocode-mcp"
  success "Symlinks created in $BIN_DIR"
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
  if echo "$PATH" | tr ':' '\n' | grep -Fxq "$BIN_DIR"; then
    return
  fi

  local config
  config=$(get_shell_config)
  local shell_name
  shell_name=$(basename "${SHELL:-sh}")

  mkdir -p "$(dirname "$config")"
  touch "$config"

  if [ "$shell_name" = "fish" ]; then
    printf '\n# sudocode\nfish_add_path %s\n' "$BIN_DIR" >> "$config"
  else
    printf '\n# sudocode\nexport PATH="%s:$PATH"\n' "$BIN_DIR" >> "$config"
  fi

  PATH_MODIFIED=1
  success "Added $BIN_DIR to PATH in $config"
}

main() {
  info "sudocode installer"
  echo "" >&2

  PATH_MODIFIED=""

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

  echo "" >&2
  success "sudocode installed!"
  echo "" >&2
  if [ -n "$PATH_MODIFIED" ]; then
    local shell_name
    shell_name=$(basename "${SHELL:-sh}")
    echo "  To get started, restart your shell or run:" >&2
    echo "" >&2
    if [ "$shell_name" = "fish" ]; then
      echo "    fish_add_path $BIN_DIR" >&2
    else
      echo "    export PATH=\"$BIN_DIR:\$PATH\"" >&2
    fi
    echo "" >&2
    echo "  Then verify: sudocode --version" >&2
  else
    echo "  Verify: sudocode --version" >&2
    echo "  Get started: cd <project> && sudocode init" >&2
  fi
  echo "" >&2
}

main "$@"
