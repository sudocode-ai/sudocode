#!/bin/bash
# Version management script for sudocode packages
# Keeps all package versions synchronized
# Meta-package (sudocode) version = packages version + 1 major version
# Usage: ./scripts/version.sh <version> [--dry-run]

set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <version> [--dry-run]"
  echo ""
  echo "Examples:"
  echo "  $0 0.2.0          # Set packages to 0.2.0, meta-package to 1.2.0"
  echo "  $0 1.0.0          # Set packages to 1.0.0, meta-package to 2.0.0"
  echo "  $0 0.1.1 --dry-run  # Show what would change without applying"
  exit 1
fi

VERSION=$1
DRY_RUN=""

if [ "$2" = "--dry-run" ]; then
  DRY_RUN="true"
fi

# Validate version format (semver)
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
  echo "Error: Invalid version format. Must be semver (e.g., 1.2.3 or 1.2.3-beta.1)"
  exit 1
fi

# Calculate meta-package version (major version + 1)
IFS='.' read -r MAJOR MINOR PATCH <<< "$VERSION"
META_MAJOR=$((MAJOR + 1))
META_VERSION="$META_MAJOR.$MINOR.$PATCH"

echo "=========================================="
echo "Version Update"
echo "=========================================="
echo "Target version: $VERSION"
echo "Meta-package version: $META_VERSION"
if [ -n "$DRY_RUN" ]; then
  echo "Mode: DRY RUN (no changes will be made)"
else
  echo "Mode: APPLY CHANGES"
fi
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ] || [ ! -d "types" ]; then
  echo "Error: Must run from repository root"
  exit 1
fi

# Packages to update
PACKAGES=(
  "types:@sudocode-ai/types:$VERSION"
  "cli:@sudocode-ai/cli:$VERSION"
  "mcp:@sudocode-ai/mcp:$VERSION"
  "server:@sudocode-ai/local-server:$VERSION"
  "frontend:@sudocode-ai/local-ui:$VERSION"
  "sudocode:sudocode:$META_VERSION"
)

# Note: frontend (@sudocode-ai/local-ui) is NOT bundled in the meta-package
# It's included in the server package as static files (dist/public)

echo "Changes to be made:"
echo ""

for pkg in "${PACKAGES[@]}"; do
  IFS=':' read -r dir name target_version <<< "$pkg"

  if [ ! -f "$dir/package.json" ]; then
    echo "Error: Package not found: $dir"
    exit 1
  fi

  CURRENT=$(node -p "require('./$dir/package.json').version")
  echo "  $name: $CURRENT → $target_version"
done

echo ""

if [ -n "$DRY_RUN" ]; then
  echo "Dry run complete. No changes were made."
  exit 0
fi

# Confirm before proceeding
read -p "Proceed with version updates? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

echo ""
echo "Updating package versions..."
echo ""

# Update each package
for pkg in "${PACKAGES[@]}"; do
  IFS=':' read -r dir name target_version <<< "$pkg"

  echo "Updating $name to $target_version..."

  # Use npm version to update (this also updates package-lock.json)
  (
    cd "$dir"
    npm version "$target_version" --no-git-tag-version --allow-same-version
  )

  echo "✓ Updated $name"
done

echo ""
echo "Updating interdependencies..."
echo ""

# Update interdependencies in each package
# For workspace packages, update references to other @sudocode-ai packages
for pkg in "${PACKAGES[@]}"; do
  IFS=':' read -r dir name target_version <<< "$pkg"

  PKG_FILE="$dir/package.json"

  # For meta-package, update all @sudocode-ai/* dependencies
  if [ "$name" = "sudocode" ]; then
    echo "  Updating @sudocode-ai dependencies in meta-package..."
    node -e "
      const fs = require('fs');
      const pkg = JSON.parse(fs.readFileSync('$PKG_FILE', 'utf8'));
      if (pkg.dependencies) {
        for (const dep of Object.keys(pkg.dependencies)) {
          if (dep.startsWith('@sudocode-ai/')) {
            pkg.dependencies[dep] = '^$VERSION';
          }
        }
      }
      fs.writeFileSync('$PKG_FILE', JSON.stringify(pkg, null, 2) + '\n');
    "
    continue
  fi

  # Update @sudocode-ai/types reference
  if grep -q '"@sudocode-ai/types"' "$PKG_FILE"; then
    echo "  Updating @sudocode-ai/types in $name..."
    node -e "
      const fs = require('fs');
      const pkg = JSON.parse(fs.readFileSync('$PKG_FILE', 'utf8'));
      if (pkg.dependencies && pkg.dependencies['@sudocode-ai/types']) {
        pkg.dependencies['@sudocode-ai/types'] = '^$VERSION';
      }
      if (pkg.devDependencies && pkg.devDependencies['@sudocode-ai/types']) {
        pkg.devDependencies['@sudocode-ai/types'] = '^$VERSION';
      }
      fs.writeFileSync('$PKG_FILE', JSON.stringify(pkg, null, 2) + '\n');
    "
  fi

  # Update @sudocode-ai/cli reference
  if grep -q '"@sudocode-ai/cli"' "$PKG_FILE"; then
    echo "  Updating @sudocode-ai/cli in $name..."
    node -e "
      const fs = require('fs');
      const pkg = JSON.parse(fs.readFileSync('$PKG_FILE', 'utf8'));
      if (pkg.dependencies && pkg.dependencies['@sudocode-ai/cli']) {
        pkg.dependencies['@sudocode-ai/cli'] = '^$VERSION';
      }
      if (pkg.devDependencies && pkg.devDependencies['@sudocode-ai/cli']) {
        pkg.devDependencies['@sudocode-ai/cli'] = '^$VERSION';
      }
      fs.writeFileSync('$PKG_FILE', JSON.stringify(pkg, null, 2) + '\n');
    "
  fi
done

echo "✓ Interdependencies updated"

echo ""
echo "=========================================="
echo "✓ All versions updated successfully!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "  1. Review the changes: git diff"
echo "  2. Commit: git add -A && git commit -m 'Bump version to $VERSION'"
echo "  3. Tag: git tag v$VERSION"
echo "  4. Push: git push && git push --tags"
echo "  5. Publish: ./scripts/publish.sh"
