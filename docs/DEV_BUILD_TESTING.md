# Dev/Beta Build Testing Guide

## Overview

This guide explains how to create, test, and validate development and beta builds before production releases. Dev/beta builds allow you to test installation workflows end-to-end without affecting production releases.

## Purpose

Dev/beta builds are used for:
- Testing installation scripts and workflows
- Validating tarball builds across all platforms
- End-to-end verification before production release
- Testing fixes for installation-related issues
- Training and demonstration purposes

## Prerequisites

- GitHub repository access
- Ability to trigger GitHub Actions workflows
- (Optional) Local machine for manual testing

## 1. Creating a Dev/Beta Build

### Via GitHub Actions (Recommended)

1. Navigate to the **Actions** tab in GitHub
2. Select **"Build Dev/Beta Tarballs"** workflow
3. Click **"Run workflow"**
4. Fill in the inputs:
   - **version**: Enter version tag (e.g., `v0.1.17-dev.1` or `v0.1.17-beta.1`)
   - **ref**: (Optional) Git ref to build from (default: `main`)
5. Click **"Run workflow"** button
6. Wait ~10-15 minutes for completion

### What Gets Created

The workflow creates:
- **GitHub Release** with tag `v0.1.17-dev.1` (marked as pre-release)
- **12 platform-specific tarballs**:
  - Linux x64 (Node 20, 22)
  - macOS arm64 (Node 20, 22)
  - macOS x64 (Node 20, 22)
  - Windows x64 (Node 20, 22)
- **SHA256 checksums** for each tarball
- **Release notes** with installation instructions

### Naming Convention

```
sudocode-{version}-{platform}-{arch}-node{nodeVersion}.tgz
```

Examples:
- `sudocode-0.1.17-dev.1-linux-x64-node20.tgz`
- `sudocode-0.1.17-dev.1-darwin-arm64-node20.tgz`
- `sudocode-0.1.17-beta.1-darwin-x64-node22.tgz`

## 2. Running Automated E2E Tests

### Via GitHub Actions

1. Navigate to the **Actions** tab in GitHub
2. Select **"Dev/Beta E2E Installation Tests"** workflow
3. Click **"Run workflow"**
4. Fill in the input:
   - **version**: Enter the dev/beta version (e.g., `v0.1.17-dev.1`)
5. Click **"Run workflow"** button
6. Wait for all test jobs to complete (~15-20 minutes)

### What Gets Tested

The E2E workflow runs two test suites across multiple platforms:

#### Test Suite 1: install.sh Tests
Tests the installation script on:
- Ubuntu 22.04 (Node 20, 22)
- macOS arm64 / M1+ (Node 20, 22)
- macOS x64 / Intel (Node 20, 22)

**Total: 6 test jobs**

#### Test Suite 2: Direct Tarball Tests
Tests direct tarball installation on:
- Ubuntu 22.04 (Node 20, 22)
- macOS arm64 / M1+ (Node 20, 22)
- macOS x64 / Intel (Node 20, 22)

**Total: 6 test jobs**

**Combined Total: 12 test jobs**

### What Gets Verified

Each test job verifies:
1. ✓ Platform detection (OS, architecture, Node version)
2. ✓ Tarball download from GitHub releases
3. ✓ SHA256 checksum verification
4. ✓ Installation via npm
5. ✓ Command availability (`sudocode`, `sudocode-server`, `sudocode-mcp`)
6. ✓ Version output matches expected version
7. ✓ **18 smoke test checks** including:
   - Binary existence and execution
   - `sudocode init` functionality
   - Basic CRUD operations (spec, issue)
   - Server startup and API endpoints
   - Database operations
   - MCP server functionality

### Reviewing Test Results

#### Via GitHub Actions UI

1. Go to the workflow run page
2. Check the summary:
   - ✅ Green checkmarks = tests passed
   - ❌ Red X marks = tests failed
3. Click on individual jobs to see detailed logs
4. Review the **Summary** section for aggregated results

#### Via Test Artifacts

1. Scroll to bottom of workflow run page
2. Download test artifacts:
   - `test-report-install-sh-{platform}-node{version}` (6 files)
   - `test-report-tarball-{platform}-node{version}` (6 files)
   - `test-summary` (aggregate report)
3. Review markdown reports for detailed results

## 3. Manual Local Testing

Manual testing is recommended to validate user experience on your specific platform.

### Test install.sh Locally

```bash
# On your machine (macOS or Linux)
curl -fsSL https://raw.githubusercontent.com/sudocode-ai/sudocode/main/scripts/install.sh | sh -s -- v0.1.17-dev.1

# Verify installation
sudocode --version
# Expected: v0.1.17-dev.1

# Run manual smoke tests
sudocode init
sudocode spec create "Test Spec" --description "Testing dev build"
sudocode spec list
sudocode issue create "Test Issue" --description "Testing issue creation"
sudocode issue list
sudocode ready

# Test server
sudocode server --port 3000
# Open http://localhost:3000 in browser
# Verify UI loads and basic functionality works
```

### Test Direct Tarball Install

```bash
# Configure for your platform
VERSION=v0.1.17-dev.1
OS=darwin      # or linux, win32
ARCH=arm64     # or x64
NODE=node20    # or node22

# Remove 'v' prefix for tarball name
VERSION_NO_V="${VERSION#v}"

# Construct tarball name and URL
TARBALL="sudocode-${VERSION_NO_V}-${OS}-${ARCH}-${NODE}.tgz"
URL="https://github.com/sudocode-ai/sudocode/releases/download/${VERSION}/${TARBALL}"

# Download tarball
curl -LO "$URL"

# Download checksum
curl -LO "${URL}.sha256"

# Verify checksum (macOS/Linux)
shasum -a 256 -c "${TARBALL}.sha256"
# Expected: {tarball}: OK

# Install globally
npm install -g "$TARBALL"

# Verify installation
sudocode --version
which sudocode

# Run smoke tests (same as above)
```

### Windows Testing (Git Bash or WSL)

```bash
# Use Git Bash or WSL with the same commands above
# For native Windows PowerShell, use the tarball install with PowerShell commands

# PowerShell checksum verification
$hash = Get-FileHash -Algorithm SHA256 sudocode-0.1.17-dev.1-win32-x64-node20.tgz
$expected = (Get-Content sudocode-0.1.17-dev.1-win32-x64-node20.tgz.sha256).Split()[0]
if ($hash.Hash -eq $expected) { Write-Host "OK" -ForegroundColor Green } else { Write-Host "FAILED" -ForegroundColor Red }
```

## 4. Validation Checklist

Use this checklist before approving a build for production release.

### Installation Validation

- [ ] **install.sh** works on macOS arm64 (M1/M2/M3)
- [ ] **install.sh** works on macOS x64 (Intel)
- [ ] **install.sh** works on Linux x64
- [ ] **Direct tarball** installation works on all platforms
- [ ] All **SHA256 checksums** verify correctly
- [ ] Installation completes in **<10 seconds** (vs ~84s for local build)

### Functionality Validation (Post-Install)

- [ ] `sudocode --version` shows correct version
- [ ] All binaries available:
  - [ ] `sudocode` (main CLI)
  - [ ] `sdc` (alias)
  - [ ] `sudocode-server` (local server)
  - [ ] `sudocode-mcp` (MCP server)
- [ ] `sudocode init` creates `.sudocode` directory structure
- [ ] Spec operations work:
  - [ ] `sudocode spec create`
  - [ ] `sudocode spec list`
  - [ ] `sudocode spec show`
- [ ] Issue operations work:
  - [ ] `sudocode issue create`
  - [ ] `sudocode issue list`
  - [ ] `sudocode issue show`
- [ ] `sudocode ready` displays correctly
- [ ] Server functionality:
  - [ ] `sudocode server` starts successfully
  - [ ] UI loads at http://localhost:3000
  - [ ] API endpoints respond (check Network tab)
- [ ] MCP server runs:
  - [ ] `sudocode-mcp` executable works

### GitHub Actions Validation

- [ ] **Build Dev/Beta Tarballs** workflow completed successfully
  - [ ] All 8 platform builds succeeded
  - [ ] All tarballs uploaded to release
  - [ ] All checksums generated
- [ ] **Dev/Beta E2E Tests** workflow completed successfully
  - [ ] All 6 install.sh tests passed
  - [ ] All 6 tarball tests passed
  - [ ] No errors in workflow logs
  - [ ] Test artifacts uploaded successfully

### Platform-Specific Checks

- [ ] **Linux x64**: Tested on Ubuntu 22.04 or similar
- [ ] **macOS arm64**: Tested on M1/M2/M3 Mac
- [ ] **macOS x64**: Tested on Intel Mac
- [ ] **Windows**: Tested via Git Bash or WSL (optional)

### Build Quality Checks

- [ ] No build errors or warnings in workflow logs
- [ ] Tarball sizes are reasonable (typically 15-25 MB each)
- [ ] Node version detection works correctly (20 and 22)
- [ ] Platform detection works correctly (OS and architecture)

## 5. Troubleshooting

### Build Workflow Issues

#### Workflow Failed to Complete

**Symptoms:**
- Build workflow shows red X
- Some platform builds failed
- Timeout errors

**Diagnosis:**
1. Check the failed job logs in GitHub Actions
2. Look for specific error messages
3. Note which platform(s) failed

**Common Causes:**
- Transient network issues (retry the workflow)
- Build timeout (rare, may need investigation)
- Dependency installation failures

**Resolution:**
- Retry the workflow (most transient issues resolve)
- Check for recent changes to dependencies
- Review error logs for specific failure reasons

#### Tarball Not Created

**Symptoms:**
- Release created but missing some tarballs
- Expected 12 files, only got 10 or fewer

**Diagnosis:**
1. Check which platforms completed successfully
2. Review failed job logs

**Resolution:**
- Re-run only the failed jobs if possible
- Or re-run entire workflow

### E2E Test Issues

#### install.sh Fails to Download Tarball

**Symptoms:**
```
Error: Failed to download tarball
Please check:
  - Is the version correct? (v0.1.17-dev.1)
  - Does the release exist for your platform?
```

**Diagnosis:**
1. Verify the dev build workflow completed successfully
2. Check that the release exists: `gh release view v0.1.17-dev.1`
3. Verify tarball exists in release assets

**Resolution:**
- Ensure dev build workflow completed before running E2E tests
- Check release page manually: https://github.com/sudocode-ai/sudocode/releases
- Verify version format is correct (must be `v0.1.17-dev.X` or `v0.1.17-beta.X`)

#### Checksum Verification Fails

**Symptoms:**
```
Error: Checksum verification failed
Expected: abc123...
Actual:   def456...
```

**Diagnosis:**
1. Check if tarball was uploaded correctly
2. Check if checksum file was generated correctly
3. Look for corruption during upload

**Resolution:**
- Re-run the dev build workflow
- Download tarball manually and verify locally
- Report issue if persists (may indicate build system problem)

#### E2E Tests Fail on Specific Platform

**Symptoms:**
- One or more platform tests fail
- Other platforms pass

**Diagnosis:**
1. Review failed job logs for that platform
2. Note specific step that failed
3. Check if platform-specific issue

**Resolution:**
- Try manual installation on that platform
- Check for platform-specific build issues
- May indicate platform-specific bug in build process

#### Smoke Tests Fail

**Symptoms:**
- Installation succeeds but smoke tests fail
- Specific functionality doesn't work

**Diagnosis:**
1. Note which smoke test failed
2. Review error message
3. Test locally to reproduce

**Common Failures:**
- Database initialization issues
- File permission problems
- Missing dependencies

**Resolution:**
- Check if this is a regression from previous version
- Test manually to isolate issue
- May indicate actual bug in the build

### Manual Testing Issues

#### Binary Not Found After Install

**Symptoms:**
```
sudocode: command not found
```

**Diagnosis:**
1. Check if installation succeeded
2. Verify npm global bin is in PATH

**Resolution:**
```bash
# Reload shell configuration
hash -r

# Add npm global bin to PATH
export PATH="$(npm bin -g):$PATH"

# Or find installation location
npm list -g sudocode
```

#### Wrong Version Installed

**Symptoms:**
- `sudocode --version` shows different version than expected

**Diagnosis:**
1. Check if old version was installed globally
2. Verify which binary is being executed

**Resolution:**
```bash
# Uninstall all versions
npm uninstall -g sudocode
npm uninstall -g @sudocode-ai/cli

# Reinstall dev version
curl -fsSL https://raw.githubusercontent.com/sudocode-ai/sudocode/main/scripts/install.sh | sh -s -- v0.1.17-dev.1

# Verify
which sudocode
sudocode --version
```

#### Installation Works But Commands Fail

**Symptoms:**
- Installation succeeds
- Commands run but produce errors
- Functionality doesn't work

**Diagnosis:**
1. Check Node version compatibility
2. Review error messages
3. Check for missing native dependencies

**Resolution:**
```bash
# Verify Node version (must be 18+)
node --version

# Check installation
which sudocode
npm list -g sudocode

# Try with verbose logging
sudocode init --verbose
```

## 6. Best Practices

### Version Naming

- Use **`dev`** for development builds: `v0.1.17-dev.1`, `v0.1.17-dev.2`
- Use **`beta`** for pre-release testing: `v0.1.17-beta.1`, `v0.1.17-beta.2`
- Increment the number for each iteration: `.1`, `.2`, `.3`, etc.
- Always use `v` prefix: `v0.1.17-dev.1` (not `0.1.17-dev.1`)

### Testing Workflow

1. **Build** → Wait for completion
2. **Automated E2E** → Review results
3. **Manual Testing** → Spot-check on your platform
4. **Validation** → Use checklist
5. **Cleanup** → Delete pre-release or keep for reference

### When to Run Dev Builds

- Before publishing a new production version
- After making changes to build/install scripts
- When adding new platforms or Node versions
- When investigating installation-related issues
- When testing major dependency updates

### Cleanup

After testing is complete:

**Delete Pre-Release:**
```bash
# Via GitHub CLI
gh release delete v0.1.17-dev.1 --yes

# Or via GitHub web UI:
# 1. Go to Releases page
# 2. Find the pre-release
# 3. Click "Delete"
```

**Uninstall Dev Build:**
```bash
# Uninstall globally
npm uninstall -g sudocode

# Verify removal
which sudocode
# Should return nothing
```

**Keep for Reference:**
Alternatively, you can keep the pre-release for historical reference. It's marked as "pre-release" so it won't be confused with production releases.

## 7. Integration with Production Release

### Promoting Dev to Production

Once dev build is validated:

1. Ensure all E2E tests pass
2. Complete validation checklist
3. Tag production release:
   ```bash
   git tag v0.1.17
   git push origin v0.1.17
   ```
4. Production workflow runs automatically
5. Publish to npm registry

### Differences: Dev vs Production

| Aspect | Dev/Beta Build | Production Build |
|--------|---------------|------------------|
| Release Type | Pre-release | Full release |
| npm Registry | No | Yes |
| Trigger | Manual workflow dispatch | Git tag push |
| Purpose | Testing | Public distribution |
| Cleanup | Can delete after testing | Keep permanently |
| Version Format | `v0.1.17-dev.1` | `v0.1.17` |

## 8. Related Documentation

- [TARBALL_BUILDS.md](./TARBALL_BUILDS.md) - Pre-built tarball system overview
- [scripts/INSTALL_README.md](../scripts/INSTALL_README.md) - Install script documentation
- [Build Dev/Beta Workflow](../.github/workflows/build-dev-tarballs.yml)
- [Dev/Beta E2E Tests Workflow](../.github/workflows/test-dev-e2e.yml)

## 9. Quick Reference

### Create Dev Build

```bash
# Via GitHub Actions:
# Actions → Build Dev/Beta Tarballs → Run workflow
# Version: v0.1.17-dev.1
```

### Run E2E Tests

```bash
# Via GitHub Actions:
# Actions → Dev/Beta E2E Installation Tests → Run workflow
# Version: v0.1.17-dev.1
```

### Manual Test

```bash
# Install
curl -fsSL https://raw.githubusercontent.com/sudocode-ai/sudocode/main/scripts/install.sh | sh -s -- v0.1.17-dev.1

# Verify
sudocode --version
sudocode init
sudocode spec create "Test"
sudocode issue create "Test"
sudocode server --port 3000

# Cleanup
npm uninstall -g sudocode
gh release delete v0.1.17-dev.1 --yes
```

### Check Status

```bash
# Via GitHub CLI
gh release view v0.1.17-dev.1
gh run list --workflow="Dev/Beta E2E Installation Tests"
gh run view <run-id>
```
