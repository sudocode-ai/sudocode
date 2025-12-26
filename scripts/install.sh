#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# GitHub repository
GITHUB_REPO="sudocode-ai/sudocode"

# Detect OS
detect_os() {
  local os=$(uname -s)
  case "$os" in
    Linux*)
      echo "linux"
      ;;
    Darwin*)
      echo "darwin"
      ;;
    MINGW*|MSYS*|CYGWIN*)
      echo "win32"
      ;;
    *)
      echo -e "${RED}Error: Unsupported operating system: $os${NC}" >&2
      echo "Supported platforms:" >&2
      echo "  - Linux" >&2
      echo "  - macOS (Darwin)" >&2
      echo "  - Windows (Git Bash/WSL)" >&2
      echo "" >&2
      echo "For manual installation, see:" >&2
      echo "  https://github.com/${GITHUB_REPO}#installation" >&2
      exit 1
      ;;
  esac
}

# Detect architecture
detect_arch() {
  local arch=$(uname -m)
  case "$arch" in
    x86_64|amd64)
      echo "x64"
      ;;
    aarch64|arm64)
      echo "arm64"
      ;;
    *)
      echo -e "${RED}Error: Unsupported architecture: $arch${NC}" >&2
      echo "Supported architectures:" >&2
      echo "  - x64 (x86_64)" >&2
      echo "  - arm64 (aarch64)" >&2
      echo "" >&2
      echo "For manual installation, see:" >&2
      echo "  https://github.com/${GITHUB_REPO}#installation" >&2
      exit 1
      ;;
  esac
}

# Detect Node.js version
detect_node_version() {
  if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js not found${NC}" >&2
    echo "" >&2
    echo "Please install Node.js 20 or 22 first:" >&2
    echo "  - https://nodejs.org/" >&2
    echo "  - Or use nvm: https://github.com/nvm-sh/nvm" >&2
    exit 1
  fi

  local node_version=$(node --version | cut -d'.' -f1 | sed 's/v//')

  case "$node_version" in
    20)
      echo "node20"
      ;;
    22)
      echo "node22"
      ;;
    *)
      echo -e "${YELLOW}Warning: Node.js version $node_version detected${NC}" >&2
      echo "Recommended versions: 20 or 22" >&2
      echo "Using Node.js 20 tarball (may work with version $node_version)" >&2
      echo "node20"
      ;;
  esac
}

# Get latest release version from GitHub
get_latest_version() {
  local version=""

  # Try using curl with GitHub API
  if command -v curl &> /dev/null; then
    version=$(curl -fsSL "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
  elif command -v wget &> /dev/null; then
    version=$(wget -qO- "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
  fi

  if [ -z "$version" ]; then
    echo -e "${RED}Error: Could not determine latest version${NC}" >&2
    echo "Please specify a version manually:" >&2
    echo "  curl -fsSL https://raw.githubusercontent.com/${GITHUB_REPO}/main/scripts/install.sh | sh -s -- v0.1.17" >&2
    exit 1
  fi

  echo "$version"
}

# Download file with retries
download_file() {
  local url="$1"
  local output="$2"
  local max_retries=3
  local retry=0

  while [ $retry -lt $max_retries ]; do
    if command -v curl &> /dev/null; then
      if curl -fSL --progress-bar "$url" -o "$output"; then
        return 0
      fi
    elif command -v wget &> /dev/null; then
      if wget -q --show-progress "$url" -O "$output"; then
        return 0
      fi
    else
      echo -e "${RED}Error: Neither curl nor wget is available${NC}" >&2
      echo "Please install curl or wget and try again" >&2
      exit 1
    fi

    retry=$((retry + 1))
    if [ $retry -lt $max_retries ]; then
      echo -e "${YELLOW}Download failed, retrying ($retry/$max_retries)...${NC}" >&2
      sleep 2
    fi
  done

  echo -e "${RED}Error: Failed to download after $max_retries attempts${NC}" >&2
  return 1
}

# Verify checksum
verify_checksum() {
  local tarball="$1"
  local checksum_file="$2"

  if [ ! -f "$checksum_file" ]; then
    echo -e "${YELLOW}Warning: Checksum file not found, skipping verification${NC}" >&2
    return 0
  fi

  local expected_checksum=$(cat "$checksum_file" | awk '{print $1}')
  local actual_checksum=""

  if command -v sha256sum &> /dev/null; then
    actual_checksum=$(sha256sum "$tarball" | awk '{print $1}')
  elif command -v shasum &> /dev/null; then
    actual_checksum=$(shasum -a 256 "$tarball" | awk '{print $1}')
  else
    echo -e "${YELLOW}Warning: No checksum tool available, skipping verification${NC}" >&2
    return 0
  fi

  if [ "$expected_checksum" != "$actual_checksum" ]; then
    echo -e "${RED}Error: Checksum verification failed${NC}" >&2
    echo "Expected: $expected_checksum" >&2
    echo "Actual:   $actual_checksum" >&2
    echo "" >&2
    echo "Downloaded file may be corrupted or tampered with." >&2
    echo "Please try again or install manually." >&2
    exit 1
  fi

  echo -e "${GREEN}✓ Checksum verified${NC}"
}

# Install package
install_package() {
  local tarball="$1"

  echo -e "${BLUE}Installing sudocode globally...${NC}"

  if ! npm install -g "$tarball"; then
    echo -e "${RED}Error: Installation failed${NC}" >&2
    echo "" >&2
    echo "If you got a permission error, try one of these solutions:" >&2
    echo "  1. Use a Node version manager (nvm, fnm, volta)" >&2
    echo "  2. Run with sudo: sudo npm install -g $tarball" >&2
    echo "  3. Configure npm to use a different prefix:" >&2
    echo "     mkdir -p ~/.npm-global" >&2
    echo "     npm config set prefix ~/.npm-global" >&2
    echo "     export PATH=~/.npm-global/bin:\$PATH" >&2
    exit 1
  fi
}

# Verify installation
verify_installation() {
  if ! command -v sudocode &> /dev/null; then
    echo -e "${RED}Error: sudocode command not found after installation${NC}" >&2
    echo "" >&2
    echo "Installation may have succeeded, but the binary is not in your PATH." >&2
    echo "Try running: hash -r" >&2
    echo "Or restart your terminal" >&2
    exit 1
  fi

  local version=$(sudocode --version 2>&1 || echo "unknown")
  echo -e "${GREEN}✓ sudocode $version installed successfully!${NC}"
}

# Print success message
print_success() {
  echo ""
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}  Installation complete!${NC}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo "Next steps:"
  echo ""
  echo "  1. Initialize a project:"
  echo -e "     ${BLUE}\$ sudocode init${NC}"
  echo ""
  echo "  2. Start the server:"
  echo -e "     ${BLUE}\$ sudocode server start${NC}"
  echo ""
  echo "  3. View docs:"
  echo -e "     ${BLUE}\$ sudocode --help${NC}"
  echo ""
  echo "For more information:"
  echo "  https://github.com/${GITHUB_REPO}"
  echo ""
}

# Main installation flow
main() {
  local version="${1:-}"

  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}  sudocode installer${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""

  # Detect platform
  echo "Detecting platform..."
  local os=$(detect_os)
  local arch=$(detect_arch)
  local node_version=$(detect_node_version)

  echo -e "  OS: ${GREEN}$os${NC}"
  echo -e "  Architecture: ${GREEN}$arch${NC}"
  echo -e "  Node.js: ${GREEN}$node_version${NC}"
  echo ""

  # Get version
  if [ -z "$version" ]; then
    echo "Fetching latest release..."
    version=$(get_latest_version)
  fi

  echo -e "  Version: ${GREEN}$version${NC}"
  echo ""

  # Construct tarball name and URL
  local tarball_name="sudocode-${version}-${os}-${arch}-${node_version}.tgz"
  local tarball_url="https://github.com/${GITHUB_REPO}/releases/download/${version}/${tarball_name}"
  local checksum_url="https://github.com/${GITHUB_REPO}/releases/download/${version}/${tarball_name}.sha256"

  # Download tarball
  echo "Downloading tarball..."
  echo "  $tarball_url"
  if ! download_file "$tarball_url" "$tarball_name"; then
    echo -e "${RED}Error: Failed to download tarball${NC}" >&2
    echo "" >&2
    echo "Please check:" >&2
    echo "  - Is the version correct? ($version)" >&2
    echo "  - Does the release exist for your platform? ($os-$arch-$node_version)" >&2
    echo "  - Do you have internet connectivity?" >&2
    echo "" >&2
    echo "Available releases: https://github.com/${GITHUB_REPO}/releases" >&2
    exit 1
  fi
  echo ""

  # Download and verify checksum
  echo "Downloading checksum..."
  if download_file "$checksum_url" "${tarball_name}.sha256" 2>/dev/null; then
    verify_checksum "$tarball_name" "${tarball_name}.sha256"
  else
    echo -e "${YELLOW}Warning: Checksum not available for this release${NC}"
  fi
  echo ""

  # Install
  install_package "$tarball_name"
  echo ""

  # Verify
  verify_installation

  # Cleanup
  echo -e "${BLUE}Cleaning up...${NC}"
  rm -f "$tarball_name" "${tarball_name}.sha256"

  # Success
  print_success
}

# Run main with all arguments
main "$@"
