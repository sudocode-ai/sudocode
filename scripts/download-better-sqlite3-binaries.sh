#!/usr/bin/env bash

# Script to download prebuilt better-sqlite3 binaries from GitHub releases
# and place them in platform-specific packages

set -e

VERSION="11.10.0"
# Use N-API v115 for Node.js 20.6+ (the minimum version for N-API v3)
# This provides the best compatibility for Node.js 18+
NAPI_VERSION="115"

# Platform list - we'll process each one
PLATFORMS="linux-x64 linux-arm64 darwin-x64 darwin-arm64 win32-x64"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGES_DIR="${REPO_ROOT}/packages"
TEMP_DIR="${REPO_ROOT}/.tmp-binaries"

echo "Downloading better-sqlite3 v${VERSION} prebuilt binaries..."
echo "Repository root: ${REPO_ROOT}"
echo ""

# Create temp directory
mkdir -p "${TEMP_DIR}"

# Download and extract binaries for each platform
for platform in ${PLATFORMS}; do
  # Construct the asset filename
  asset="better-sqlite3-v${VERSION}-node-v${NAPI_VERSION}-${platform}.tar.gz"
  package_dir="${PACKAGES_DIR}/better-sqlite3-${platform}"

  echo "Processing ${platform}..."
  echo "  Package: better-sqlite3-${platform}"
  echo "  Asset: ${asset}"

  # Download URL
  url="https://github.com/WiseLibs/better-sqlite3/releases/download/v${VERSION}/${asset}"

  # Download the tarball
  echo "  Downloading from: ${url}"
  temp_file="${TEMP_DIR}/${asset}"

  if curl -L -f -o "${temp_file}" "${url}"; then
    echo "  ✓ Downloaded successfully"

    # Extract the .node file
    echo "  Extracting binary..."
    tar -xzf "${temp_file}" -C "${TEMP_DIR}"

    # Find the .node file (it should be in build/Release/better_sqlite3.node)
    node_file=$(find "${TEMP_DIR}/build/Release" -name "better_sqlite3.node" -type f 2>/dev/null | head -1)

    if [ -n "${node_file}" ]; then
      # Copy to package directory
      cp "${node_file}" "${package_dir}/better_sqlite3.node"
      echo "  ✓ Binary copied to ${package_dir}/better_sqlite3.node"

      # Verify the binary
      if [ -f "${package_dir}/better_sqlite3.node" ]; then
        size=$(stat -f%z "${package_dir}/better_sqlite3.node" 2>/dev/null || stat -c%s "${package_dir}/better_sqlite3.node" 2>/dev/null)
        echo "  ✓ Binary size: ${size} bytes"
      fi
    else
      echo "  ✗ ERROR: Could not find better_sqlite3.node in extracted archive"
    fi

    # Cleanup extracted files
    rm -rf "${TEMP_DIR}/build"
  else
    echo "  ✗ ERROR: Failed to download ${asset}"
    echo "  The binary for this platform might not be available in this release."
    echo "  You may need to compile it manually or check the GitHub releases page."
  fi

  echo ""
done

# Cleanup temp directory
rm -rf "${TEMP_DIR}"

echo "Done! Binaries downloaded and placed in package directories."
echo ""
echo "Next steps:"
echo "1. Verify the binaries were downloaded correctly"
echo "2. Test loading them on the appropriate platforms"
echo "3. Publish the packages to npm"
