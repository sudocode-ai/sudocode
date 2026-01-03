#!/usr/bin/env bash

# Non-interactive authentication setup for Verdaccio
# Works in both local and CI environments

set -e

VERDACCIO_REGISTRY="http://localhost:4873/"
VERDACCIO_USER="${VERDACCIO_USER:-test}"
VERDACCIO_PASSWORD="${VERDACCIO_PASSWORD:-test}"
VERDACCIO_EMAIL="${VERDACCIO_EMAIL:-test@test.com}"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Setting up Verdaccio authentication...${NC}"

# Check if already authenticated
if npm whoami --registry "$VERDACCIO_REGISTRY" &>/dev/null; then
    CURRENT_USER=$(npm whoami --registry "$VERDACCIO_REGISTRY")
    echo -e "${GREEN}✓ Already authenticated as: $CURRENT_USER${NC}"
    exit 0
fi

# Method 1: Try using npm-cli-login (works non-interactively)
if command -v npm-cli-login &> /dev/null; then
    echo "Using npm-cli-login for non-interactive authentication..."
    npm-cli-login -u "$VERDACCIO_USER" -p "$VERDACCIO_PASSWORD" -e "$VERDACCIO_EMAIL" -r "$VERDACCIO_REGISTRY"
    echo -e "${GREEN}✓ Authenticated successfully using npm-cli-login${NC}"
    exit 0
fi

# Method 2: Install npm-cli-login if not available (CI environment)
if [ -n "$CI" ] || [ -n "$GITHUB_ACTIONS" ]; then
    echo -e "${YELLOW}Installing npm-cli-login for CI environment...${NC}"
    npm install -g npm-cli-login
    npm-cli-login -u "$VERDACCIO_USER" -p "$VERDACCIO_PASSWORD" -e "$VERDACCIO_EMAIL" -r "$VERDACCIO_REGISTRY"
    echo -e "${GREEN}✓ Authenticated successfully${NC}"
    exit 0
fi

# Method 3: Manual setup using expect (if available on local machine)
if command -v expect &> /dev/null; then
    echo "Using expect for automated authentication..."
    expect << EOF
spawn npm adduser --registry $VERDACCIO_REGISTRY
expect "Username:"
send "$VERDACCIO_USER\r"
expect "Password:"
send "$VERDACCIO_PASSWORD\r"
expect "Email:"
send "$VERDACCIO_EMAIL\r"
expect eof
EOF
    echo -e "${GREEN}✓ Authenticated successfully using expect${NC}"
    exit 0
fi

# Method 4: Fall back to interactive (local development)
echo -e "${YELLOW}No non-interactive authentication method available.${NC}"
echo "Please run manually: npm adduser --registry $VERDACCIO_REGISTRY"
echo "Use credentials: $VERDACCIO_USER / $VERDACCIO_PASSWORD / $VERDACCIO_EMAIL"
exit 1
