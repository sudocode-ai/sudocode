#!/bin/bash
# Test script for install.sh platform detection

set -e

echo "Platform Detection Test"
echo "======================="
echo ""

# Test OS detection
echo "1. Operating System Detection:"
OS=$(uname -s)
case "$OS" in
  Linux*) DETECTED_OS="linux" ;;
  Darwin*) DETECTED_OS="darwin" ;;
  MINGW*|MSYS*|CYGWIN*) DETECTED_OS="win32" ;;
  *) DETECTED_OS="unsupported: $OS" ;;
esac
echo "   Raw: $OS"
echo "   Detected: $DETECTED_OS"
echo ""

# Test architecture detection
echo "2. Architecture Detection:"
ARCH=$(uname -m)
case "$ARCH" in
  x86_64|amd64) DETECTED_ARCH="x64" ;;
  aarch64|arm64) DETECTED_ARCH="arm64" ;;
  *) DETECTED_ARCH="unsupported: $ARCH" ;;
esac
echo "   Raw: $ARCH"
echo "   Detected: $DETECTED_ARCH"
echo ""

# Test Node version detection
echo "3. Node.js Version Detection:"
if command -v node &> /dev/null; then
  NODE_VERSION=$(node --version)
  NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d'.' -f1 | sed 's/v//')
  case "$NODE_MAJOR" in
    20) DETECTED_NODE="node20" ;;
    22) DETECTED_NODE="node22" ;;
    *) DETECTED_NODE="node20 (fallback from v$NODE_MAJOR)" ;;
  esac
  echo "   Installed: $NODE_VERSION"
  echo "   Detected: $DETECTED_NODE"
else
  echo "   ✗ Node.js not found"
  DETECTED_NODE="not-installed"
fi
echo ""

# Show what tarball would be downloaded
echo "4. Expected Tarball Name:"
VERSION="v0.1.17"
TARBALL="sudocode-${VERSION}-${DETECTED_OS}-${DETECTED_ARCH}-${DETECTED_NODE}.tgz"
echo "   $TARBALL"
echo ""

echo "5. Expected Download URL:"
GITHUB_REPO="sudocode-ai/sudocode"
URL="https://github.com/${GITHUB_REPO}/releases/download/${VERSION}/${TARBALL}"
echo "   $URL"
echo ""

# Test checksum tools
echo "6. Available Tools:"
if command -v curl &> /dev/null; then
  echo "   ✓ curl"
else
  echo "   ✗ curl"
fi
if command -v wget &> /dev/null; then
  echo "   ✓ wget"
else
  echo "   ✗ wget"
fi
if command -v sha256sum &> /dev/null; then
  echo "   ✓ sha256sum"
elif command -v shasum &> /dev/null; then
  echo "   ✓ shasum"
else
  echo "   ✗ No SHA256 tool found"
fi
echo ""

echo "✓ All detection tests completed"
