#!/bin/bash
# Orchestrate end-to-end profiling workflow
# Usage: ./scripts/profile-install/profile.sh
#
# This script coordinates:
# 1. Pack tarballs (via npm run profile:pack)
# 2. Build Docker image (cached after first run)
# 3. Run measurement in container
# 4. Display and save results

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TARBALL_DIR="$SCRIPT_DIR/tarballs"
RESULTS_DIR="$SCRIPT_DIR/results"
DOCKERFILE="$SCRIPT_DIR/Dockerfile"
MEASURE_SCRIPT="$SCRIPT_DIR/measure-install.cjs"
IMAGE_NAME="sudocode-profiler"
CONTAINER_NAME="sudocode-profiler-$$" # Use PID for unique container name

# Ensure results directory exists
mkdir -p "$RESULTS_DIR"

# Function to print section headers
print_section() {
  echo ""
  echo "=========================================="
  echo "$1"
  echo "=========================================="
  echo ""
}

# Function to print step headers
print_step() {
  echo -e "${BLUE}[$1] $2${NC}"
}

# Function to print success
print_success() {
  echo -e "${GREEN}✓${NC} $1"
}

# Function to print error
print_error() {
  echo -e "${RED}✗${NC} $1"
}

# Function to print warning
print_warning() {
  echo -e "${YELLOW}⚠${NC} $1"
}

# Function to cleanup Docker container on exit
cleanup() {
  if [ -n "$CONTAINER_NAME" ]; then
    if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
      echo ""
      print_step "cleanup" "Removing Docker container..."
      docker rm -f "$CONTAINER_NAME" > /dev/null 2>&1 || true
      print_success "Container removed"
    fi
  fi
}

# Register cleanup on exit
trap cleanup EXIT INT TERM

# Check prerequisites
print_section "Profiling npm install -g sudocode"

# Check Docker is running
if ! docker info > /dev/null 2>&1; then
  print_error "Docker is not running"
  echo "Please start Docker and try again"
  exit 1
fi

# Check we're in the repository root
cd "$REPO_ROOT"
if [ ! -f "package.json" ] || [ ! -d "types" ] || [ ! -d "cli" ]; then
  print_error "Must run from repository root"
  exit 1
fi

# Step 1: Pack tarballs
print_step "1/4" "Packing tarballs..."
START_PACK=$(date +%s)

# Run pack-tarballs.sh
if ! npm run profile:pack > /dev/null 2>&1; then
  print_error "Failed to pack tarballs"
  echo "Run 'npm run profile:pack' manually to see errors"
  exit 1
fi

END_PACK=$(date +%s)
PACK_TIME=$((END_PACK - START_PACK))

# Count tarballs
TARBALL_COUNT=$(ls -1 "$TARBALL_DIR"/*.tgz 2>/dev/null | wc -l | tr -d ' ')
print_success "Created $TARBALL_COUNT tarballs (${PACK_TIME}s)"

# Validate sudocode tarball exists
if ! ls "$TARBALL_DIR"/sudocode-*.tgz > /dev/null 2>&1; then
  print_error "sudocode tarball not found in $TARBALL_DIR"
  exit 1
fi

# Step 2: Build Docker image
print_step "2/4" "Building Docker image..."
START_BUILD=$(date +%s)

# Build image (will use cache if Dockerfile unchanged)
if docker build -t "$IMAGE_NAME" -f "$DOCKERFILE" "$SCRIPT_DIR" > /dev/null 2>&1; then
  END_BUILD=$(date +%s)
  BUILD_TIME=$((END_BUILD - START_BUILD))

  if [ $BUILD_TIME -lt 2 ]; then
    print_success "Image ready (cached)"
  else
    print_success "Image built (${BUILD_TIME}s)"
  fi
else
  print_error "Failed to build Docker image"
  echo "Run 'docker build -t $IMAGE_NAME -f $DOCKERFILE $SCRIPT_DIR' manually to see errors"
  exit 1
fi

# Step 3: Run installation in container
print_step "3/4" "Running install in container..."
echo ""

START_INSTALL=$(date +%s)

# Run container with tarballs mounted
# - Mount tarballs directory as read-only
# - Mount measure script
# - Run measure-install.cjs and capture JSON output
DOCKER_OUTPUT=$(mktemp)

if docker run \
  --rm \
  --name "$CONTAINER_NAME" \
  -v "$TARBALL_DIR:/profiling/tarballs:ro" \
  -v "$MEASURE_SCRIPT:/profiling/measure-install.cjs:ro" \
  "$IMAGE_NAME" \
  node /profiling/measure-install.cjs /profiling/tarballs > "$DOCKER_OUTPUT" 2>&1; then

  END_INSTALL=$(date +%s)
  INSTALL_TIME=$((END_INSTALL - START_INSTALL))

  echo ""
  print_success "Install completed (${INSTALL_TIME}s)"
else
  print_error "Installation failed in container"
  echo ""
  echo "Container output:"
  cat "$DOCKER_OUTPUT"
  rm -f "$DOCKER_OUTPUT"
  exit 1
fi

# Step 4: Analyze results
print_step "4/4" "Analyzing results..."
echo ""

# Extract JSON from output (last valid JSON object)
# The measure script writes JSON to stdout and human-readable to stderr
# Docker captures both, so we need to extract the JSON
# Use awk to extract complete JSON object from first { to matching }
RESULT_JSON=$(cat "$DOCKER_OUTPUT" | awk '/^\{/{p=1} p{print} /^\}$/{if(p)exit}')

if [ -z "$RESULT_JSON" ]; then
  print_error "Failed to extract results from container output"
  echo ""
  echo "Container output:"
  cat "$DOCKER_OUTPUT"
  rm -f "$DOCKER_OUTPUT"
  exit 1
fi

# Validate it's valid JSON
if ! echo "$RESULT_JSON" | node -e "JSON.parse(require('fs').readFileSync(0, 'utf8'))" > /dev/null 2>&1; then
  print_error "Extracted data is not valid JSON"
  echo ""
  echo "Extracted data:"
  echo "$RESULT_JSON"
  echo ""
  echo "Full container output:"
  cat "$DOCKER_OUTPUT"
  rm -f "$DOCKER_OUTPUT"
  exit 1
fi

# Save results to timestamped file
TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
RESULT_FILE="$RESULTS_DIR/profile-$TIMESTAMP.json"
echo "$RESULT_JSON" > "$RESULT_FILE"

# Parse JSON results using Node.js (available since we're in a Node project)
# Create a simple analysis script inline
ANALYZE_SCRIPT=$(mktemp)
cat > "$ANALYZE_SCRIPT" << 'EOF'
const fs = require('fs');
const resultFile = process.argv[2];
const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));

console.log('========================================');
console.log('Results');
console.log('========================================');
console.log('');
console.log(`Version: ${result.version}`);
console.log(`Total install time: ${(result.timing.total / 1000).toFixed(1)}s`);
console.log('');

// Phase breakdown
const phases = result.timing.phases;
const total = result.timing.total;

if (phases && (phases.resolve > 0 || phases.fetch > 0 || phases.build > 0 || phases.postinstall > 0)) {
  console.log('Breakdown by phase:');

  // Sort phases by time (descending)
  const phaseEntries = Object.entries(phases)
    .filter(([_, time]) => time > 0)
    .sort((a, b) => b[1] - a[1]);

  let maxBottleneck = { name: null, time: 0, percentage: 0 };

  for (const [phase, time] of phaseEntries) {
    const percentage = (time / total * 100).toFixed(1);
    const seconds = (time / 1000).toFixed(1);
    const label = phase.charAt(0).toUpperCase() + phase.slice(1);

    // Mark significant bottlenecks (>50% of time)
    const marker = percentage > 50 ? ' ← BOTTLENECK' : '';
    console.log(`  ${label.padEnd(14)} ${seconds.padStart(6)}s (${percentage.padStart(4)}%)${marker}`);

    // Track biggest bottleneck
    if (time > maxBottleneck.time) {
      maxBottleneck = { name: label, time, percentage: parseFloat(percentage) };
    }
  }

  console.log('');

  // Show top bottleneck analysis
  if (maxBottleneck.name && maxBottleneck.percentage > 20) {
    console.log('Top bottleneck:');
    console.log(`  ${maxBottleneck.name}: ${(maxBottleneck.time / 1000).toFixed(1)}s (${maxBottleneck.percentage.toFixed(1)}%)`);
    console.log('');

    // Provide suggestions based on bottleneck
    if (maxBottleneck.name === 'Build' && maxBottleneck.percentage > 50) {
      console.log('💡 Suggestions:');
      console.log('  - Native compilation (better-sqlite3) is likely the bottleneck');
      console.log('  - Consider using prebuilt binaries');
      console.log('  - Consider bundling native modules');
      console.log('');
    }
  }
} else {
  console.log('(Phase breakdown not available from npm timing data)');
  console.log('');
}

console.log(`Results saved to: ${resultFile.replace(process.cwd() + '/', '')}`);
console.log('');
EOF

# Run analysis script
node "$ANALYZE_SCRIPT" "$RESULT_FILE"

# Cleanup temp files
rm -f "$DOCKER_OUTPUT" "$ANALYZE_SCRIPT"

# Show historical comparison if previous results exist
PREVIOUS_RESULTS=$(ls -1t "$RESULTS_DIR"/profile-*.json 2>/dev/null | tail -n +2 | head -n 1)
if [ -n "$PREVIOUS_RESULTS" ] && [ -f "$PREVIOUS_RESULTS" ]; then
  # Try to parse previous results, skip comparison if invalid
  if PREV_TIME=$(node -p "JSON.parse(require('fs').readFileSync('$PREVIOUS_RESULTS', 'utf8')).timing.total" 2>/dev/null); then
    CURR_TIME=$(node -p "JSON.parse(require('fs').readFileSync('$RESULT_FILE', 'utf8')).timing.total")

    DIFF=$((CURR_TIME - PREV_TIME))

    # Only show comparison if we have bc available for floating point math
    if command -v bc > /dev/null 2>&1; then
      DIFF_PERCENT=$(echo "scale=1; ($DIFF * 100) / $PREV_TIME" | bc)

      echo "=========================================="
      echo "Comparison with previous run"
      echo "=========================================="
      echo ""
      echo "Previous: $(echo "scale=1; $PREV_TIME / 1000" | bc)s"
      echo "Current:  $(echo "scale=1; $CURR_TIME / 1000" | bc)s"

      if [ "$DIFF" -lt 0 ]; then
        echo -e "${GREEN}Improvement: ${DIFF#-}ms (${DIFF_PERCENT#-}% faster)${NC}"
      elif [ "$DIFF" -gt 0 ]; then
        echo -e "${RED}Regression: +${DIFF}ms (${DIFF_PERCENT#-}% slower)${NC}"
      else
        echo "No change"
      fi
      echo ""
    else
      # Fallback without bc (integer math only)
      echo "=========================================="
      echo "Comparison with previous run"
      echo "=========================================="
      echo ""
      echo "Previous: $((PREV_TIME / 1000))s"
      echo "Current:  $((CURR_TIME / 1000))s"

      if [ "$DIFF" -lt 0 ]; then
        echo -e "${GREEN}Improvement: ${DIFF#-}ms faster${NC}"
      elif [ "$DIFF" -gt 0 ]; then
        echo -e "${RED}Regression: +${DIFF}ms slower${NC}"
      else
        echo "No change"
      fi
      echo ""
    fi
  fi
fi
