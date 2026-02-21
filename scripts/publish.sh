#!/bin/bash
# Publish script for sudocode packages
# Usage: ./scripts/publish.sh [--dry-run] [--tag <tag>]

set -e

# Parse arguments
DRY_RUN=""
TAG="latest"
SKIP_TESTS=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run)
      DRY_RUN="--dry-run"
      shift
      ;;
    --tag)
      TAG="$2"
      shift 2
      ;;
    --skip-tests)
      SKIP_TESTS="true"
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--dry-run] [--tag <tag>] [--skip-tests]"
      exit 1
      ;;
  esac
done

echo "=========================================="
echo "Publishing sudocode packages"
echo "=========================================="
echo "Dry run: ${DRY_RUN:-false}"
echo "Tag: $TAG"
echo "Skip tests: ${SKIP_TESTS:-false}"
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ] || [ ! -d "types" ] || [ ! -d "cli" ]; then
  echo "Error: Must run from repository root"
  exit 1
fi

# Check if logged into npm
if [ -z "$DRY_RUN" ]; then
  echo "Checking npm authentication..."
  npm whoami > /dev/null 2>&1 || {
    echo "Error: Not logged into npm. Run 'npm login' first."
    exit 1
  }
  echo "✓ Logged in as: $(npm whoami)"
  echo ""
fi

# Run tests unless skipped
if [ -z "$SKIP_TESTS" ]; then
  echo "=========================================="
  echo "Running tests..."
  echo "=========================================="
  npm test || {
    echo "Error: Tests failed. Fix tests or use --skip-tests to skip."
    exit 1
  }
  echo "✓ All tests passed"
  echo ""
fi

# Clean and build all packages
echo "=========================================="
echo "Building all packages..."
echo "=========================================="
npm run clean || true
npm run build

# Build plugins (not included in main build)
echo ""
echo "Building plugins..."
npm run build --workspace=plugins/integration-beads
npm run build --workspace=plugins/integration-openspec
npm run build --workspace=plugins/integration-speckit
npm run build --workspace=plugins/integration-github

echo ""
echo "✓ All packages built successfully"
echo ""

# Publish packages in dependency order
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

# Check for already published versions
echo "=========================================="
echo "Checking for already published versions..."
echo "=========================================="

SKIP_PACKAGES=()

for pkg in "${PACKAGES[@]}"; do
  IFS=':' read -r dir name <<< "$pkg"

  VERSION=$(node -p "require('./$dir/package.json').version")

  # Check if version already exists on npm
  if npm view "$name@$VERSION" version > /dev/null 2>&1; then
    echo "⚠ $name@$VERSION already published - will skip"
    SKIP_PACKAGES+=("$name")
  else
    echo "✓ $name@$VERSION not yet published"
  fi
done

echo ""

if [ ${#SKIP_PACKAGES[@]} -eq ${#PACKAGES[@]} ]; then
  echo "All packages are already published at their current versions."
  echo "No packages to publish. Exiting."
  exit 0
fi

if [ ${#SKIP_PACKAGES[@]} -gt 0 ]; then
  echo "Warning: Some packages will be skipped because they're already published."
  echo "This may cause dependency version mismatches."
  echo ""
  read -p "Continue anyway? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi
fi

echo "=========================================="
echo "Publishing packages..."
echo "=========================================="

# Save repo root to handle nested package directories correctly
REPO_ROOT=$(pwd)

for pkg in "${PACKAGES[@]}"; do
  IFS=':' read -r dir name <<< "$pkg"

  # Skip if already published
  if [[ " ${SKIP_PACKAGES[@]} " =~ " ${name} " ]]; then
    echo ""
    echo "------------------------------------------"
    echo "Skipping $name (already published)"
    echo "------------------------------------------"
    continue
  fi

  echo ""
  echo "------------------------------------------"
  echo "Publishing $name..."
  echo "------------------------------------------"

  cd "$REPO_ROOT/$dir"

  # For the meta-package, remove node_modules/ before packing.
  # npm auto-bundles node_modules/ when bin entries reference it,
  # which would ship stale or duplicate packages in the tarball.
  if [ "$name" = "sudocode" ]; then
    rm -rf node_modules
    echo "Cleaned node_modules/ to prevent bundling"

    # Validate tarball is clean
    PACK_OUTPUT=$(npm pack --dry-run 2>&1)
    BUNDLED_DEPS=$(echo "$PACK_OUTPUT" | grep "bundled deps:" | grep -oE '[0-9]+' || true)
    if [ -n "$BUNDLED_DEPS" ] && [ "$BUNDLED_DEPS" -gt 0 ]; then
      echo "Error: Meta-package would still bundle $BUNDLED_DEPS dependencies!"
      cd "$REPO_ROOT"
      exit 1
    fi
    echo "✓ Tarball validated (no bundled deps)"
  fi

  # Get package version
  VERSION=$(node -p "require('./package.json').version")
  echo "Version: $VERSION"

  # Publish with appropriate tag
  if [ -n "$DRY_RUN" ]; then
    echo "Dry run: npm publish --access public --tag $TAG $DRY_RUN"
    npm publish --access public --tag "$TAG" $DRY_RUN || {
      echo "Error: Failed to publish $name (dry run)"
      cd "$REPO_ROOT"
      exit 1
    }
  else
    npm publish --access public --tag "$TAG" || {
      echo "Error: Failed to publish $name"
      cd "$REPO_ROOT"
      exit 1
    }
    echo "✓ Published $name@$VERSION with tag '$TAG'"
  fi

  cd "$REPO_ROOT"
done

echo ""
echo "=========================================="
echo "✓ All packages published successfully!"
echo "=========================================="
echo ""
echo "Published packages:"
for pkg in "${PACKAGES[@]}"; do
  IFS=':' read -r dir name <<< "$pkg"
  VERSION=$(node -p "require('./$dir/package.json').version")
  echo "  - $name@$VERSION"
done

if [ -n "$DRY_RUN" ]; then
  echo ""
  echo "This was a dry run. No packages were actually published."
  echo "Remove --dry-run to publish for real."
else
  echo ""
  echo "=========================================="
  echo "Next: Build binaries"
  echo "=========================================="
  echo ""
  echo "  gh workflow run build-binaries.yml -f channel=stable"
  echo ""
  echo "  Monitor: https://github.com/sudocode-ai/sudocode/actions"
  echo ""
fi
