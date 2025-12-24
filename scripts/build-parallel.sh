#!/bin/bash
# Parallel build script for sudocode packages
# This script builds packages in parallel where possible to reduce total build time
#
# Build dependency graph:
# types (standalone) -> cli, server
# frontend (standalone, longest build)
# cli -> mcp
#
# Parallel groups:
# Group 1: types, frontend (can run in parallel)
# Group 2: cli, server (wait for types, then parallel)
# Group 3: mcp (wait for cli)

set -e

echo "=========================================="
echo "Parallel Build for sudocode"
echo "=========================================="
echo ""

# Function to build a package and report timing
build_package() {
  local workspace=$1
  local name=$2

  echo "[$name] Starting build..."
  START=$(date +%s)

  if npm run build --workspace="$workspace" > "/tmp/build-${name}.log" 2>&1; then
    END=$(date +%s)
    DURATION=$((END - START))
    echo "[$name] ✓ Complete in ${DURATION}s"
    return 0
  else
    END=$(date +%s)
    DURATION=$((END - START))
    echo "[$name] ✗ Failed after ${DURATION}s"
    cat "/tmp/build-${name}.log"
    return 1
  fi
}

export -f build_package

# Record overall start time
OVERALL_START=$(date +%s)

# Group 1: Build types and frontend in parallel (no dependencies)
echo "Group 1: Building types and frontend in parallel..."
echo ""

build_package "types" "types" &
TYPES_PID=$!

build_package "frontend" "frontend" &
FRONTEND_PID=$!

# Wait for both
wait $TYPES_PID
TYPES_EXIT=$?

wait $FRONTEND_PID
FRONTEND_EXIT=$?

if [ $TYPES_EXIT -ne 0 ]; then
  echo "Error: types build failed"
  exit 1
fi

if [ $FRONTEND_EXIT -ne 0 ]; then
  echo "Error: frontend build failed"
  exit 1
fi

echo ""
echo "Group 1: Complete"
echo ""

# Group 2: Build cli and server in parallel (both depend on types)
echo "Group 2: Building cli and server in parallel..."
echo ""

build_package "cli" "cli" &
CLI_PID=$!

build_package "server" "server" &
SERVER_PID=$!

# Wait for both
wait $CLI_PID
CLI_EXIT=$?

wait $SERVER_PID
SERVER_EXIT=$?

if [ $CLI_EXIT -ne 0 ]; then
  echo "Error: cli build failed"
  exit 1
fi

if [ $SERVER_EXIT -ne 0 ]; then
  echo "Error: server build failed"
  exit 1
fi

echo ""
echo "Group 2: Complete"
echo ""

# Group 3: Build mcp (depends on cli)
echo "Group 3: Building mcp..."
echo ""

build_package "mcp" "mcp"

echo ""
echo "Group 3: Complete"
echo ""

# Calculate total time
OVERALL_END=$(date +%s)
TOTAL_DURATION=$((OVERALL_END - OVERALL_START))

echo "=========================================="
echo "✓ All packages built successfully!"
echo "Total time: ${TOTAL_DURATION}s"
echo "=========================================="
echo ""
echo "Compared to sequential build:"
echo "- Sequential: types + cli + mcp + frontend + server"
echo "- Parallel: max(types, frontend) + max(cli, server) + mcp"
echo "- Expected savings: ~30-40% on fresh builds"
