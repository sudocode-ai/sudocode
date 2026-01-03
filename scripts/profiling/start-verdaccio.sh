#!/usr/bin/env bash

# Start Verdaccio local npm registry for profiling
# This script starts Verdaccio without 2FA for realistic npm install testing

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERDACCIO_CONFIG="$SCRIPT_DIR/verdaccio-config.yaml"
VERDACCIO_STORAGE="$SCRIPT_DIR/storage"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting Verdaccio local registry...${NC}"

# Check if Verdaccio is installed
if ! command -v verdaccio &> /dev/null; then
    echo -e "${YELLOW}Verdaccio not found. Installing globally...${NC}"
    npm install -g verdaccio
fi

# Create storage directory if it doesn't exist
mkdir -p "$VERDACCIO_STORAGE"

# Check if Verdaccio is already running
if lsof -Pi :4873 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "${YELLOW}Verdaccio is already running on port 4873${NC}"
    echo "To stop it, run: pkill -f verdaccio"
    exit 0
fi

# Start Verdaccio in the background
echo "Starting Verdaccio with config: $VERDACCIO_CONFIG"
verdaccio --config "$VERDACCIO_CONFIG" --listen 4873 &
VERDACCIO_PID=$!

# Wait for Verdaccio to be ready
echo "Waiting for Verdaccio to start..."
sleep 2

# Check if the process is still running
if ! kill -0 $VERDACCIO_PID 2>/dev/null; then
    echo -e "${YELLOW}Verdaccio failed to start${NC}"
    exit 1
fi

echo -e "${GREEN}Verdaccio is running!${NC}"
echo "  Registry URL: http://localhost:4873/"
echo "  PID: $VERDACCIO_PID"
echo ""
echo "To use this registry:"
echo "  npm set registry http://localhost:4873/"
echo ""
echo "To stop Verdaccio:"
echo "  pkill -f verdaccio"
echo ""
echo "To register a user (no 2FA):"
echo "  npm adduser --registry http://localhost:4873/"
echo ""
