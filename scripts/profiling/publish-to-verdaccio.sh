#!/usr/bin/env bash

# Publish sudocode packages to local Verdaccio registry
# This script builds and publishes all packages without 2FA

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
VERDACCIO_REGISTRY="http://localhost:4873/"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}Publishing sudocode to Verdaccio...${NC}"

# Check if Verdaccio is running
if ! curl -s "$VERDACCIO_REGISTRY" > /dev/null 2>&1; then
    echo -e "${RED}Error: Verdaccio is not running at $VERDACCIO_REGISTRY${NC}"
    echo "Start it with: ./scripts/profiling/start-verdaccio.sh"
    exit 1
fi

# Save current npm registry
ORIGINAL_REGISTRY=$(npm config get registry)
echo "Current registry: $ORIGINAL_REGISTRY"
echo "Switching to Verdaccio: $VERDACCIO_REGISTRY"

# Set registry to Verdaccio
npm set registry "$VERDACCIO_REGISTRY"

# Ensure user is logged in
echo ""
echo -e "${YELLOW}Checking authentication...${NC}"
if ! npm whoami --registry "$VERDACCIO_REGISTRY" &>/dev/null; then
    echo "Not authenticated to Verdaccio."

    # In CI environment, try non-interactive authentication
    if [ -n "$CI" ] || [ -n "$GITHUB_ACTIONS" ]; then
        echo "CI environment detected. Using non-interactive authentication..."
        "$SCRIPT_DIR/setup-verdaccio-auth.sh"
    else
        echo "You need to log in to Verdaccio first."
        echo "Running: npm adduser --registry $VERDACCIO_REGISTRY"
        echo ""
        echo -e "${YELLOW}Note: You can use any username/password (no 2FA required)${NC}"
        echo "Example: username=test, password=test, email=test@test.com"
        echo ""
        npm adduser --registry "$VERDACCIO_REGISTRY"
    fi
fi

VERDACCIO_USER=$(npm whoami --registry "$VERDACCIO_REGISTRY")
echo -e "${GREEN}Authenticated as: $VERDACCIO_USER${NC}"

# Build all packages
echo ""
echo -e "${GREEN}Building all packages...${NC}"
cd "$REPO_ROOT"
npm run build

# Publish packages in dependency order
echo ""
echo -e "${GREEN}Publishing packages...${NC}"

# 1. types (no dependencies)
echo -e "${YELLOW}Publishing @sudocode-ai/types...${NC}"
cd "$REPO_ROOT/types"
npm publish --registry "$VERDACCIO_REGISTRY" || echo "Already published or error"

# 2. cli (depends on types)
echo -e "${YELLOW}Publishing @sudocode-ai/cli...${NC}"
cd "$REPO_ROOT/cli"
npm publish --registry "$VERDACCIO_REGISTRY" || echo "Already published or error"

# 3. mcp (depends on cli)
echo -e "${YELLOW}Publishing @sudocode-ai/mcp...${NC}"
cd "$REPO_ROOT/mcp"
npm publish --registry "$VERDACCIO_REGISTRY" || echo "Already published or error"

# 4. frontend (independent)
echo -e "${YELLOW}Publishing @sudocode-ai/local-ui...${NC}"
cd "$REPO_ROOT/frontend"
npm publish --registry "$VERDACCIO_REGISTRY" || echo "Already published or error"

# 5. server (depends on cli)
echo -e "${YELLOW}Publishing @sudocode-ai/local-server...${NC}"
cd "$REPO_ROOT/server"
npm publish --registry "$VERDACCIO_REGISTRY" || echo "Already published or error"

# 6. sudocode meta-package (depends on all)
echo -e "${YELLOW}Publishing sudocode (meta-package)...${NC}"
cd "$REPO_ROOT/sudocode"
npm publish --registry "$VERDACCIO_REGISTRY" || echo "Already published or error"

# Restore original registry
echo ""
echo -e "${GREEN}Restoring original npm registry...${NC}"
npm set registry "$ORIGINAL_REGISTRY"

echo ""
echo -e "${GREEN}✓ Publishing complete!${NC}"
echo ""
echo "Packages are now available at: $VERDACCIO_REGISTRY"
echo "To install: npm install -g sudocode --registry $VERDACCIO_REGISTRY"
echo ""
echo "Original registry restored: $ORIGINAL_REGISTRY"
