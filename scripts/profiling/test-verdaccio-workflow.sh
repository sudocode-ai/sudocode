#!/usr/bin/env bash

# End-to-end test for Verdaccio profiling workflow
# This script tests the complete flow: start Verdaccio → publish → profile

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERDACCIO_REGISTRY="http://localhost:4873/"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Verdaccio Profiling Workflow Test${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Step 1: Check if Verdaccio is running
echo -e "${YELLOW}[1/5] Checking Verdaccio status...${NC}"
if curl -s "$VERDACCIO_REGISTRY" > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Verdaccio is already running${NC}"
else
    echo -e "${YELLOW}Verdaccio not running. Starting it now...${NC}"
    "$SCRIPT_DIR/start-verdaccio.sh"
    sleep 3

    if ! curl -s "$VERDACCIO_REGISTRY" > /dev/null 2>&1; then
        echo -e "${RED}✗ Failed to start Verdaccio${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ Verdaccio started successfully${NC}"
fi
echo ""

# Step 2: Check authentication
echo -e "${YELLOW}[2/5] Checking authentication...${NC}"
if npm whoami --registry "$VERDACCIO_REGISTRY" &>/dev/null; then
    VERDACCIO_USER=$(npm whoami --registry "$VERDACCIO_REGISTRY")
    echo -e "${GREEN}✓ Authenticated as: $VERDACCIO_USER${NC}"
else
    echo -e "${YELLOW}Not authenticated. Setting up authentication...${NC}"

    # Try non-interactive authentication (works in CI and local if tools available)
    if "$SCRIPT_DIR/setup-verdaccio-auth.sh"; then
        VERDACCIO_USER=$(npm whoami --registry "$VERDACCIO_REGISTRY")
        echo -e "${GREEN}✓ Authenticated as: $VERDACCIO_USER${NC}"
    else
        echo -e "${RED}✗ Authentication failed${NC}"
        echo "Please run manually: npm adduser --registry $VERDACCIO_REGISTRY"
        echo "You can use any credentials (e.g., test/test/test@test.com)"
        exit 1
    fi
fi
echo ""

# Step 3: Build and publish packages
echo -e "${YELLOW}[3/5] Building and publishing packages...${NC}"
if ! "$SCRIPT_DIR/publish-to-verdaccio.sh"; then
    echo -e "${RED}✗ Failed to publish packages${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Packages published successfully${NC}"
echo ""

# Step 4: Run profiling benchmark
echo -e "${YELLOW}[4/5] Running profiling benchmark...${NC}"
echo "This will install sudocode from Verdaccio and measure timing..."
echo ""

# Clear npm cache to simulate fresh install
npm cache clean --force

# Run benchmark with Verdaccio registry
NPM_REGISTRY="$VERDACCIO_REGISTRY" SCENARIO="verdaccio-test" node "$SCRIPT_DIR/benchmark.cjs"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Benchmark completed successfully${NC}"
else
    echo -e "${RED}✗ Benchmark failed${NC}"
    exit 1
fi
echo ""

# Step 5: Verify results
echo -e "${YELLOW}[5/5] Verifying results...${NC}"
LATEST_RESULT=$(ls -t "$SCRIPT_DIR/results/"benchmark-verdaccio-test-*.json 2>/dev/null | head -n 1)

if [ -z "$LATEST_RESULT" ]; then
    echo -e "${RED}✗ No benchmark results found${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Results saved to: $LATEST_RESULT${NC}"
echo ""
echo -e "${BLUE}Benchmark Results:${NC}"
cat "$LATEST_RESULT" | grep -E '(total|registry|scenario)' | head -n 10

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}✓ All tests passed!${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo "Next steps:"
echo "  1. Review results in: $LATEST_RESULT"
echo "  2. Compare with npm registry results"
echo "  3. To stop Verdaccio: pkill -f verdaccio"
echo ""
