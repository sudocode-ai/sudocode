#!/bin/bash
CODESPACE_NAME="crispy-parakeet-wg5v5q64rvfgxgp"
PORT=3001

echo "=== Making port 3001 public ==="
gh codespace ports visibility 3001:public --codespace "$CODESPACE_NAME"

sleep 2

echo ""
echo "Checking ports..."
gh codespace ports --codespace "$CODESPACE_NAME" --json sourcePort,visibility,browseUrl | jq '.[] | select(.sourcePort == 3001)'

echo ""
echo "Testing accessibility without auth..."
URL="https://crispy-parakeet-wg5v5q64rvfgxgp-3001.app.github.dev"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$URL")
echo "HTTP Status: $HTTP_CODE"

if [ "$HTTP_CODE" = "200" ]; then
    echo "✓ Port 3001 is now publicly accessible"
fi
