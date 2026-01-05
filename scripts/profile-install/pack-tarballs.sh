#!/bin/bash
# Pack tarballs for local install testing
# Usage: ./scripts/profile-install/pack-tarballs.sh

set -e

# Package directories in dependency order
PACKAGES=(
  "types:@sudocode-ai/types"
  "cli:@sudocode-ai/cli"
  "mcp:@sudocode-ai/mcp"
  "server:@sudocode-ai/local-server"
  "plugins/integration-beads:@sudocode-ai/integration-beads"
  "plugins/integration-openspec:@sudocode-ai/integration-openspec"
  "plugins/integration-speckit:@sudocode-ai/integration-speckit"
  "plugins/integration-github:@sudocode-ai/integration-github"
  "sudocode:sudocode"
)

echo "=========================================="
echo "Pack Tarballs for Local Install Testing"
echo "=========================================="
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ] || [ ! -d "types" ] || [ ! -d "cli" ]; then
  echo "Error: Must run from repository root"
  exit 1
fi

# Get repository root
REPO_ROOT=$(pwd)
TARBALL_DIR="$REPO_ROOT/scripts/profile-install/tarballs"

# Clean and recreate tarballs directory
echo "Cleaning tarballs directory..."
rm -rf "$TARBALL_DIR"/*.tgz
mkdir -p "$TARBALL_DIR"
echo "✓ Cleaned tarballs directory"
echo ""

# Build all packages
echo "=========================================="
echo "Building all packages..."
echo "=========================================="
npm run build

# Build plugins (not included in main build)
echo ""
echo "Building plugins..."
npm run build --workspace=plugins/integration-beads
npm run build --workspace=plugins/integration-openspec
npm run build --workspace=plugins/integration-speckit
npm run build --workspace=plugins/integration-github

echo ""
echo "✓ Built ${#PACKAGES[@]} packages"
echo ""

# Pack tarballs
echo "=========================================="
echo "Packing tarballs..."
echo "=========================================="
echo ""

TARBALL_COUNT=0

for pkg in "${PACKAGES[@]}"; do
  IFS=':' read -r dir name <<< "$pkg"

  cd "$REPO_ROOT/$dir"

  # Get package version
  VERSION=$(node -p "require('./package.json').version")

  # Pack the package
  echo "Packing $name@$VERSION..."
  TARBALL=$(npm pack 2>&1 | tail -n 1)

  # Move tarball to staging directory
  mv "$TARBALL" "$TARBALL_DIR/"

  echo "✓ $TARBALL"
  ((TARBALL_COUNT++))

  cd "$REPO_ROOT"
done

echo ""
echo "=========================================="
echo "✓ Packed $TARBALL_COUNT tarballs"
echo "=========================================="
echo ""
echo "Tarballs ready in: $TARBALL_DIR"
echo ""
echo "Contents:"
ls -lh "$TARBALL_DIR"/*.tgz | awk '{printf "  %s  %s\n", $5, $9}' | sed "s|$TARBALL_DIR/||"
echo ""
