# npm Install Profiling Infrastructure

This directory contains Docker-based tooling for profiling `npm install -g sudocode` performance in an isolated, reproducible environment.

## Problem

The `npm install -g sudocode` command takes >60 seconds in fresh environments (e.g., GitHub Codespaces), creating a poor user experience. This infrastructure helps:

1. Reproduce the slow install locally without affecting your development environment
2. Profile and identify bottlenecks
3. Test fixes with fast iteration
4. Validate performance improvements

## Quick Start

**Run complete profiling workflow (recommended):**

```bash
# From repository root
npm run profile:install
```

This will:
1. Build all packages and create tarballs (~50s)
2. Build Docker image (cached after first run)
3. Run installation in isolated container (~90s)
4. Display results with bottleneck analysis
5. Save detailed JSON results
6. Compare with previous runs

**Manual steps for debugging:**

```bash
# 1. Pack tarballs only
npm run profile:pack

# 2. Build Docker image
docker build -t sudocode-profiler scripts/profile-install/

# 3. Run interactively for debugging
docker run -it -v $(pwd)/scripts/profile-install/tarballs:/profiling/tarballs:ro sudocode-profiler /bin/bash

# Inside the container
npm install -g /profiling/tarballs/sudocode-*.tgz --timing
```

## Docker Environment

**Base Image:** `node:20-slim` (Debian-based, matching GitHub Codespaces)

**Characteristics:**
- Fresh Node.js 20 environment
- Clean npm cache on every run (no caching between runs)
- No global packages pre-installed
- Includes build tools (gcc, python3) for native modules
- Basic debugging utilities (git, curl)

**Environment Variables:**
- `npm_config_cache=/tmp/npm-cache` - Temporary cache location
- `npm_config_prefer_offline=false` - Never use cached packages

## Directory Structure

```
scripts/profile-install/
├── README.md              # This file
├── Dockerfile             # Fresh Node.js environment
├── profile.sh             # Main orchestration script (run via npm run profile:install)
├── pack-tarballs.sh       # Build and pack all packages
├── measure-install.cjs    # Measure installation time (runs in container)
├── .gitignore             # Ignore results and temp files
├── tarballs/              # Packed .tgz files (gitignored)
└── results/               # Profiling results (gitignored)
    └── .gitkeep
```

## Usage

### Interactive Debugging

Shell into a fresh container to manually test installations:

```bash
docker run -it sudocode-profiler /bin/bash
```

Inside the container:
```bash
# Check Node/npm versions
node --version  # Should be v20.x.x
npm --version

# Verify clean state
npm list -g --depth=0  # Should only show npm

# Test install (when tarball is available)
time npm install -g /path/to/sudocode.tgz
```

### Mounting Local Files

To test with locally built packages:

```bash
# Build packages first
npm run build

# Pack all packages
cd sudocode && npm pack && cd ..
cd cli && npm pack && cd ..
# ... etc for other packages

# Run container with mounted tarballs
docker run -it -v $(pwd):/workspace sudocode-profiler /bin/bash

# Inside container
cd /workspace
npm install -g sudocode/*.tgz
```

## Automated Profiling Workflow

The `profile.sh` orchestration script automates the complete profiling workflow:

```bash
npm run profile:install
```

**Complete workflow (takes ~2-3 minutes):**

1. **Pack tarballs** (~50s)
   - Builds all 9 packages in dependency order
   - Creates `.tgz` files and collects in `tarballs/`

2. **Build Docker image** (~2s after first run due to caching)
   - Creates fresh Node.js 20 environment
   - Installs build tools for native compilation

3. **Run installation in container** (~90s)
   - Mounts tarballs into container
   - Installs `sudocode` meta-package
   - Captures timing data with npm's `--timing` flag

4. **Analyze and display results**
   - Parses timing data
   - Identifies bottlenecks
   - Saves JSON results to `results/profile-TIMESTAMP.json`
   - Compares with previous runs

**Example output:**

```
==========================================
Profiling npm install -g sudocode
==========================================

[1/4] Packing tarballs...
✓ Created 9 tarballs (51s)

[2/4] Building Docker image...
✓ Image ready (cached)

[3/4] Running install in container...
✓ Install completed (97s)

[4/4] Analyzing results...

========================================
Results
========================================

Version: 1.1.17
Total install time: 97.9s

(Phase breakdown not available from npm timing data)

Results saved to: scripts/profile-install/results/profile-20260104-154417.json

==========================================
Comparison with previous run
==========================================

Previous: 89.7s
Current:  97.9s
Regression: +8127ms (9.0% slower)
```

### Individual Steps

You can also run individual steps for debugging:

**Step 1: Pack Tarballs**

```bash
npm run profile:pack
```

**Step 2: Measure Installation**

```bash
docker build -t sudocode-profiler scripts/profile-install/
docker run --rm \
  -v $(pwd)/scripts/profile-install/tarballs:/profiling/tarballs:ro \
  -v $(pwd)/scripts/profile-install/measure-install.cjs:/profiling/measure-install.cjs:ro \
  sudocode-profiler \
  node /profiling/measure-install.cjs /profiling/tarballs
```
- Measure total installation time
- Capture npm's built-in timing data
- Output JSON with detailed metrics

**Output Format:**
```json
{
  "timestamp": "2026-01-04T19:30:00Z",
  "version": "0.1.17",
  "environment": {
    "node": "20.11.0",
    "npm": "10.2.4",
    "os": "linux",
    "arch": "x64"
  },
  "timing": {
    "total": 62340,
    "phases": {
      "resolve": 2100,
      "fetch": 450,
      "build": 48200,
      "postinstall": 5600
    }
  }
}
```

## Next Steps

Additional scripts will be added for:

1. **profile.sh** - Orchestration script to automate the full workflow
2. **analyze-results.js** - Parse and display bottlenecks with comparisons

## Design Decisions

**Why Docker?**
- True isolation without affecting development environment
- Reproducible clean slate every run
- Fast local execution (no CI wait times)
- Easy to debug (shell into container)
- Standard tool available on all dev machines

**Why node:20-slim?**
- Matches production Node.js version
- Debian-based (similar to GitHub Codespaces)
- Includes npm by default
- Slim variant keeps image size manageable

**Why clear npm cache?**
- Ensures every run starts fresh
- Reproduces first-install experience
- Eliminates cache-related variability
- More realistic simulation of user experience

## Troubleshooting

**Docker build fails:**
```bash
# Check Docker is running
docker ps

# Build with verbose output
docker build --progress=plain -t sudocode-profiler scripts/profile-install/
```

**Container won't start:**
```bash
# Check if image exists
docker images | grep sudocode-profiler

# Try running with explicit bash
docker run -it sudocode-profiler bash
```

**Want to rebuild from scratch:**
```bash
# Remove old image
docker rmi sudocode-profiler

# Rebuild without cache
docker build --no-cache -t sudocode-profiler scripts/profile-install/
```

## Performance Targets

- **Current baseline:** >60 seconds (unacceptable)
- **Target:** <20 seconds (acceptable)
- **Stretch goal:** <10 seconds (excellent)

## Baseline Results

**Baseline established:** 2026-01-05 (commit 0f2f683)

**Environment:**
- Node.js: v20.19.5
- npm: v10.8.2
- OS: Linux (Docker)
- Architecture: arm64

**Install Time Statistics (3 runs with enhanced profiling):**
- **Best time:** 90.1s
- **Mean time:** 95.2s ± 4.5s
- **Range:** 90.1s - 101.1s
- **Coefficient of variation:** 4.7%

**Phase Breakdown:**
- **Build (native compilation):** 83.2s (87.4%) ← PRIMARY BOTTLENECK
- **Resolve (dependency resolution):** 20.5s (21.5%)
- **Fetch (package download):** 4.7s (4.9%)
- **Postinstall (scripts):** 0.1s (0.1%)

**Top Package Bottlenecks:**

1. **better-sqlite3: 79.7s (88.5%)**
   - Native compilation: 76.4s
   - Package install: 3.3s
   - **This is the primary bottleneck** - SQLite native module compilation

2. **node-pty: 8.1s (9.0%)**
   - Native compilation: 3.6s
   - Package install: 4.4s
   - Postinstall: 0.04s

3. **@anthropic-ai/claude-agent-sdk: 4.5s (5.0%)**
   - Package install: 4.5s (no native compilation)

**Key Findings:**

1. **better-sqlite3 is the smoking gun:** Native compilation of better-sqlite3 accounts for ~85% of total install time. This single package takes 79.7 seconds to build from source.

2. **Improved variance:** The 4.7% CV meets our reproducibility target (better than the ±5% threshold), indicating consistent profiling results.

3. **Native module compilation dominates:** 87% of install time is spent compiling native modules (better-sqlite3 and node-pty), with better-sqlite3 being responsible for nearly all of it.

4. **Total time well above target:** Even the best run (90.1s) is 4.5x slower than the target (20s) and 9x slower than the stretch goal (10s).

**Root Cause Analysis:**

The install is slow because:
- **better-sqlite3 compiles from source** instead of using prebuilt binaries
- The Docker environment (arm64 Linux) may not have prebuilt binaries available
- Native compilation requires node-gyp, Python, and full build toolchain
- Compilation is single-threaded and CPU-intensive

**Optimization Opportunities:**

1. **Use prebuilt binaries for better-sqlite3** (highest impact)
   - Check if arm64 prebuilt binaries are available
   - Configure npm to prefer prebuilt binaries
   - Consider bundling prebuilt binaries in distribution

2. **Reduce dependency on better-sqlite3** (medium impact)
   - Evaluate if SQLite is required for all use cases
   - Consider optional dependencies for CLI vs server

3. **Optimize native compilation** (low impact)
   - Use faster build flags
   - Cache compiled modules between installs

4. **Bundle optimization** (low impact)
   - Reduce overall package count (currently ~400+ packages)
   - Tree-shake unused dependencies

**Interpreting Results:**

When comparing future profiling runs against this baseline:
- Improvements >20% are significant and worth investigating
- Changes <10% may be within normal variance
- Focus on mean time rather than single runs
- Run multiple iterations to confirm improvements

**Profiling Cycle Time:**

The original spec targeted a profiling cycle time of <30s for rapid iteration. Current performance:
- **Tarball packing:** 57-91s (one-time per code change)
- **Install measurement:** 104-147s (the actual profiling)
- **Total cycle time:** ~165-210s (2.7-3.5 minutes)

The <30s target is aspirational and will only be achievable after optimizations are implemented. The current cycle time is acceptable for establishing baselines and testing major optimizations, but too slow for rapid iteration during fix development. Future work should focus on:
1. Optimizing the actual install time (primary goal)
2. Optionally adding a "quick mode" for faster validation

## References

- Spec: `specs/s-4uvr_npm_install_performance_profiling_and_optimization.md`
- Issue: `i-3ukv` - Create Docker environment
- npm timing docs: https://docs.npmjs.com/cli/v10/commands/npm-install#timing
