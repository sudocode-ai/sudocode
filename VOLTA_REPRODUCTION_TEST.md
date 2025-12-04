# Volta Installation Reproduction Test

This document describes how to reproduce the Volta installation failure for sudocode package.

## Issue Summary

When installing sudocode via `volta install sudocode`, the package appears to install successfully (shows up in `volta list`), but no shim symlinks are created in `~/.volta/bin/`, making the commands unavailable.

**Expected binaries**: `sudocode`, `sdc`, `sudocode-mcp`, `sudocode-server`  
**Actual result**: No shims created, commands not found in PATH

See spec [[s-1ygh]] for full details.

## Running the Reproduction Test

### Method 1: GitHub Actions (Recommended)

The automated test runs on three platforms:
- **macOS ARM64** (M1/M2) - Primary reproduction target
- **macOS x86_64** (Intel) - Architecture comparison
- **Linux ARM64** (Docker) - Alternative platform test

**To run manually:**

1. Go to the GitHub Actions tab in the repository
2. Select "Volta Installation Reproduction Test" workflow
3. Click "Run workflow" button
4. Wait for results (usually 5-10 minutes)

**To run on PR:**

The workflow automatically runs when you modify any of these files:
- `package.json`
- `cli/package.json`
- `mcp/package.json`
- `local-server/package.json`

### Method 2: Local Docker Test (ARM64)

For local testing with Docker:

```bash
# Create Dockerfile
cat > Dockerfile.volta-test << 'EOF'
FROM --platform=linux/arm64 ubuntu:22.04

# Install dependencies
RUN apt-get update && apt-get install -y curl git build-essential ca-certificates

# Install Volta
RUN curl https://get.volta.sh | bash
ENV VOLTA_HOME=/root/.volta
ENV PATH="$VOLTA_HOME/bin:$PATH"

# Install Node
RUN volta install node@22

# Install sudocode
RUN volta install sudocode || echo "Installation may have issues"

# Diagnostic script
CMD ["/bin/bash", "-c", "\
  echo '=== Volta version ===' && volta --version && \
  echo '' && \
  echo '=== Volta packages ===' && volta list && \
  echo '' && \
  echo '=== Shims in ~/.volta/bin ===' && ls -la $VOLTA_HOME/bin/ && \
  echo '' && \
  echo '=== Sudocode shims ===' && (ls -la $VOLTA_HOME/bin/ | grep sudo || echo 'NONE FOUND - BUG REPRODUCED') && \
  echo '' && \
  echo '=== Testing commands ===' && \
  (command -v sudocode && echo 'sudocode: AVAILABLE' || echo 'sudocode: NOT FOUND') && \
  (command -v sdc && echo 'sdc: AVAILABLE' || echo 'sdc: NOT FOUND')"]
EOF

# Build and run
docker build --platform linux/arm64 -f Dockerfile.volta-test -t volta-test .
docker run --platform linux/arm64 volta-test
```

### Method 3: Manual Local Test (macOS only)

**WARNING:** This will modify your local Volta installation. Only use in a test environment.

```bash
# Install Volta if not already installed
curl https://get.volta.sh | bash
source ~/.volta/env  # or restart shell

# Install Node
volta install node@22

# Capture BEFORE state
echo "=== BEFORE installation ==="
ls -la ~/.volta/bin/ | grep sudo || echo "No sudocode shims (expected)"
volta list

# Install sudocode
volta install sudocode

# Capture AFTER state
echo "=== AFTER installation ==="
volta list
ls -la ~/.volta/bin/ | grep sudo || echo "No sudocode shims (BUG REPRODUCED)"

# Test commands
echo "=== Testing commands ==="
which sudocode || echo "sudocode not found"
which sdc || echo "sdc not found"
which sudocode-mcp || echo "sudocode-mcp not found"
which sudocode-server || echo "sudocode-server not found"

# Try to run
sudocode --version || echo "Cannot run sudocode"
```

## Expected Results

### If Bug is Reproduced

```
=== Volta packages ===
sudocode, sdc, sudocode-mcp, sudocode-server (default)

=== Shims in ~/.volta/bin ===
[Shows node, npm, npx, etc. but NO sudocode-related files]

=== Testing commands ===
sudocode: NOT FOUND
sdc: NOT FOUND
```

### If Bug is NOT Reproduced

```
=== Volta packages ===
sudocode, sdc, sudocode-mcp, sudocode-server (default)

=== Shims in ~/.volta/bin ===
lrwxr-xr-x  sudocode -> ../tools/image/sudocode/...
lrwxr-xr-x  sdc -> ../tools/image/sudocode/...
lrwxr-xr-x  sudocode-mcp -> ../tools/image/sudocode/...
lrwxr-xr-x  sudocode-server -> ../tools/image/sudocode/...

=== Testing commands ===
sudocode: AVAILABLE
sdc: AVAILABLE
```

## Diagnostic Information to Collect

When the bug is reproduced, collect these details:

1. **Environment**:
   ```bash
   uname -a
   volta --version
   node --version
   npm --version
   echo $VOLTA_HOME
   echo $PATH
   ```

2. **Installation Evidence**:
   ```bash
   volta list
   volta list all
   npm list -g --depth=0
   ```

3. **File System State**:
   ```bash
   ls -la ~/.volta/bin/
   ls -la ~/.volta/tools/
   find ~/.volta -name "sudocode" -o -name "sdc"
   ```

4. **Package Metadata**:
   ```bash
   npm info sudocode bin
   npm info sudocode version
   ```

## Architecture Comparison

The test runs on multiple architectures to determine if this is architecture-specific:

| Platform | Architecture | Runner | Purpose |
|----------|-------------|---------|---------|
| macOS 14 | ARM64 (Apple Silicon) | `macos-14` | Primary target (user's environment) |
| macOS 13 | x86_64 (Intel) | `macos-13` | Check if Intel Macs have same issue |
| Linux (Docker) | ARM64 | `ubuntu-latest` + QEMU | Alternative platform test |

## Next Steps After Reproduction

Once the bug is confirmed:

1. Document exact environment where it occurs
2. Compare package.json bin configuration with working packages
3. Review Volta's shim creation logic
4. Identify why sudocode is treated differently
5. Implement fix (likely in package.json or build process)
6. Verify fix with this same test

## Related Issues

- Issue: [[i-8qtx]] - This reproduction task
- Spec: [[s-1ygh]] - Volta compatibility specification
- Blocking: [[i-8wih]] - Fix implementation (depends on this reproduction)

## References

- Volta documentation: https://volta.sh/
- Volta GitHub: https://github.com/volta-cli/volta
- User report: shamez.budhwani (M1 Mac, Volta 1.1.1, Node 22.12.0)
