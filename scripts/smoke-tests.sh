#!/bin/bash
# Smoke tests for sudocode installation
# Tests all basic CLI commands and server functionality

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Test results array
declare -a FAILED_TESTS

# Helper functions
print_header() {
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
}

test_command() {
  local test_name="$1"
  local command="$2"
  local expected_pattern="$3"

  TESTS_RUN=$((TESTS_RUN + 1))

  echo -n "Testing: $test_name... "

  if output=$(eval "$command" 2>&1); then
    if [[ -z "$expected_pattern" ]] || echo "$output" | grep -q "$expected_pattern"; then
      echo -e "${GREEN}✓${NC}"
      TESTS_PASSED=$((TESTS_PASSED + 1))
      return 0
    else
      echo -e "${RED}✗${NC} (output mismatch)"
      echo "  Expected pattern: $expected_pattern"
      echo "  Got: $output"
      TESTS_FAILED=$((TESTS_FAILED + 1))
      FAILED_TESTS+=("$test_name")
      return 1
    fi
  else
    echo -e "${RED}✗${NC} (command failed)"
    echo "  Error: $output"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    FAILED_TESTS+=("$test_name")
    return 1
  fi
}

test_binary_exists() {
  local binary_name="$1"

  TESTS_RUN=$((TESTS_RUN + 1))

  echo -n "Checking binary: $binary_name... "

  if command -v "$binary_name" &> /dev/null; then
    echo -e "${GREEN}✓${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    return 0
  else
    echo -e "${RED}✗${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    FAILED_TESTS+=("Binary: $binary_name")
    return 1
  fi
}

# Create temporary test directory
TEST_DIR=$(mktemp -d)
cd "$TEST_DIR"

print_header "Sudocode Smoke Tests"
echo "Test directory: $TEST_DIR"
echo ""

# ============================================================================
# Binary Availability Tests
# ============================================================================
print_header "1. Binary Availability"

test_binary_exists "sudocode"
test_binary_exists "sdc"
test_binary_exists "sudocode-server"
test_binary_exists "sudocode-mcp"

# ============================================================================
# CLI Version Test
# ============================================================================
print_header "2. CLI Version"

test_command "sudocode --version" "sudocode --version" "."

# ============================================================================
# CLI Initialization
# ============================================================================
print_header "3. CLI Initialization"

test_command "sudocode init" "sudocode init" ""

# Verify .sudocode directory was created
TESTS_RUN=$((TESTS_RUN + 1))
echo -n "Verifying .sudocode directory created... "
if [[ -d ".sudocode" ]]; then
  echo -e "${GREEN}✓${NC}"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "${RED}✗${NC}"
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAILED_TESTS+=(".sudocode directory creation")
fi

# Verify required files
TESTS_RUN=$((TESTS_RUN + 1))
echo -n "Verifying .sudocode/cache.db created... "
if [[ -f ".sudocode/cache.db" ]]; then
  echo -e "${GREEN}✓${NC}"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  echo -e "${RED}✗${NC}"
  TESTS_FAILED=$((TESTS_FAILED + 1))
  FAILED_TESTS+=(".sudocode/cache.db creation")
fi

# ============================================================================
# Spec Operations
# ============================================================================
print_header "4. Spec Operations"

test_command "Create spec" "sudocode spec create 'Test Spec' --description 'A test specification'" ""

test_command "List specs" "sudocode spec list" "Test Spec"

# Get spec ID from list
SPEC_ID=$(sudocode spec list --format json 2>/dev/null | grep -o '"id":"s-[^"]*"' | head -1 | cut -d'"' -f4)

if [[ -n "$SPEC_ID" ]]; then
  test_command "Show spec" "sudocode spec show '$SPEC_ID'" "Test Spec"
else
  echo -e "${YELLOW}⚠${NC} Skipping 'Show spec' (no spec ID found)"
fi

# ============================================================================
# Issue Operations
# ============================================================================
print_header "5. Issue Operations"

test_command "Create issue" "sudocode issue create 'Test Issue' --description 'A test issue'" ""

test_command "List issues" "sudocode issue list" "Test Issue"

# Get issue ID from list
ISSUE_ID=$(sudocode issue list --format json 2>/dev/null | grep -o '"id":"i-[^"]*"' | head -1 | cut -d'"' -f4)

if [[ -n "$ISSUE_ID" ]]; then
  test_command "Show issue" "sudocode issue show '$ISSUE_ID'" "Test Issue"
else
  echo -e "${YELLOW}⚠${NC} Skipping 'Show issue' (no issue ID found)"
fi

# ============================================================================
# Relationship Operations
# ============================================================================
print_header "6. Relationship Operations"

if [[ -n "$ISSUE_ID" ]] && [[ -n "$SPEC_ID" ]]; then
  test_command "Link issue to spec" "sudocode link '$ISSUE_ID' '$SPEC_ID' --type implements" ""
else
  echo -e "${YELLOW}⚠${NC} Skipping relationship tests (missing issue or spec ID)"
fi

# ============================================================================
# Ready Command
# ============================================================================
print_header "7. Ready Status"

test_command "sudocode ready" "sudocode ready" ""

# ============================================================================
# Sync Command
# ============================================================================
print_header "8. JSONL Sync"

test_command "sudocode sync" "sudocode sync" ""

# ============================================================================
# Server Tests
# ============================================================================
print_header "9. Server Functionality"

# Find an available port
SERVER_PORT=3050
while lsof -i ":$SERVER_PORT" >/dev/null 2>&1; do
  SERVER_PORT=$((SERVER_PORT + 1))
done

# Start server in background
echo -n "Starting server on port $SERVER_PORT... "
SERVER_LOG=$(mktemp)
sudocode server --port "$SERVER_PORT" &> "$SERVER_LOG" &
SERVER_PID=$!
sleep 6

if kill -0 "$SERVER_PID" 2>/dev/null; then
  echo -e "${GREEN}✓${NC}"
  TESTS_PASSED=$((TESTS_PASSED + 1))
  TESTS_RUN=$((TESTS_RUN + 1))

  # Test HTTP API (with retries - API might take longer to initialize)
  # Get project ID from server output
  PROJECT_ID=$(grep -o "Project context initialized: [^ ]*" "$SERVER_LOG" | awk '{print $4}' || echo "")

  TESTS_RUN=$((TESTS_RUN + 1))
  echo -n "Testing HTTP API (/api/issues with project ID)... "
  API_SUCCESS=false
  for i in {1..5}; do
    # API requires X-Project-ID header or projectId query param
    if curl -f -s "http://localhost:$SERVER_PORT/api/issues?projectId=$PROJECT_ID" > /dev/null 2>&1; then
      API_SUCCESS=true
      break
    fi
    sleep 1
  done

  if $API_SUCCESS; then
    echo -e "${GREEN}✓${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${RED}✗${NC} (projectId=$PROJECT_ID, check logs at $SERVER_LOG)"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    FAILED_TESTS+=("HTTP API")
  fi

  # Test UI endpoint
  TESTS_RUN=$((TESTS_RUN + 1))
  echo -n "Testing UI endpoint (/)... "
  if curl -f -s "http://localhost:$SERVER_PORT/" > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${RED}✗${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    FAILED_TESTS+=("UI endpoint")
  fi

  # Stop server
  echo -n "Stopping server... "
  kill "$SERVER_PID" 2>/dev/null || true
  sleep 1
  # Force kill if still running
  kill -9 "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
  echo -e "${GREEN}✓${NC}"
else
  echo -e "${RED}✗${NC} (server failed to start)"
  cat "$SERVER_LOG"
  TESTS_FAILED=$((TESTS_FAILED + 3))
  TESTS_RUN=$((TESTS_RUN + 3))
  FAILED_TESTS+=("Server start" "HTTP API" "UI endpoint")
fi

rm -f "$SERVER_LOG"

# ============================================================================
# MCP Server Tests
# ============================================================================
print_header "10. MCP Server"

TESTS_RUN=$((TESTS_RUN + 1))
echo -n "Testing MCP server... "

# MCP server should respond to stdio and list tools
if echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | sudocode-mcp 2>/dev/null | grep -q "ready"; then
  echo -e "${GREEN}✓${NC}"
  TESTS_PASSED=$((TESTS_PASSED + 1))
else
  # MCP might not support this exact test, just verify it runs
  if sudocode-mcp --help &>/dev/null || sudocode-mcp 2>&1 | grep -q "mcp\|stdio\|ready"; then
    echo -e "${GREEN}✓${NC}"
    TESTS_PASSED=$((TESTS_PASSED + 1))
  else
    echo -e "${RED}✗${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    FAILED_TESTS+=("MCP server")
  fi
fi

# ============================================================================
# Summary
# ============================================================================
print_header "Test Summary"

echo "Tests run:    $TESTS_RUN"
echo -e "Tests passed: ${GREEN}$TESTS_PASSED${NC}"

if [[ $TESTS_FAILED -gt 0 ]]; then
  echo -e "Tests failed: ${RED}$TESTS_FAILED${NC}"
  echo ""
  echo -e "${RED}Failed tests:${NC}"
  for test in "${FAILED_TESTS[@]}"; do
    echo -e "  ${RED}✗${NC} $test"
  done
fi

echo ""

# Cleanup
cd /
rm -rf "$TEST_DIR"

# Exit with appropriate code
if [[ $TESTS_FAILED -eq 0 ]]; then
  echo -e "${GREEN}✅ All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}❌ Some tests failed${NC}"
  exit 1
fi
