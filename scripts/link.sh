#!/bin/bash
set -e

# Get the root directory (parent of scripts/)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Linking sudocode packages..."

cd "$ROOT/cli" && npm link
echo "✓ CLI linked"

cd "$ROOT/server" && npm link
echo "✓ Server linked"

cd "$ROOT/mcp" && npm link
echo "✓ MCP linked"

echo ""
echo "All packages linked successfully!"
echo "You can now use: sudocode, sudocode-server, sudocode-mcp"
