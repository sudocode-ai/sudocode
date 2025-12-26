# Pre-built Tarball System

## Overview

The sudocode project provides pre-built tarballs for all major platforms to eliminate local build times during installation. Instead of waiting ~84 seconds for `npm install -g sudocode` to build locally, users can download a pre-built tarball and install in seconds.

## How It Works

### Automatic Builds

When a new version tag is pushed (e.g., `v0.1.17`), the `build-tarballs.yml` GitHub Actions workflow automatically:

1. Builds sudocode on all supported platforms
2. Creates platform-specific tarballs
3. Generates SHA256 checksums for verification
4. Uploads everything to the GitHub Release

### Supported Platforms

| Platform | Architecture | Node Versions |
|----------|--------------|---------------|
| Linux    | x64          | 20, 22        |
| macOS    | arm64 (M1+)  | 20, 22        |
| macOS    | x64 (Intel)  | 20, 22        |
| Windows  | x64          | 20, 22        |

**Total:** 8 tarballs per release

## Tarball Naming Convention

```
sudocode-{version}-{platform}-{arch}-node{nodeVersion}.tgz
```

### Examples

- `sudocode-0.1.17-linux-x64-node20.tgz`
- `sudocode-0.1.17-darwin-arm64-node20.tgz`
- `sudocode-0.1.17-darwin-x64-node20.tgz`
- `sudocode-0.1.17-win32-x64-node20.tgz`
- `sudocode-0.1.17-linux-x64-node22.tgz`
- etc.

### Platform Identifiers

- `linux` - Linux (Ubuntu, Debian, RHEL, etc.)
- `darwin` - macOS
- `win32` - Windows

### Architecture Identifiers

- `x64` - 64-bit Intel/AMD
- `arm64` - 64-bit ARM (Apple Silicon)

## Installation

### Quick Install (Recommended)

```bash
# Linux (Node 20)
npm install -g https://github.com/sudocodeai/sudocode/releases/download/v0.1.17/sudocode-0.1.17-linux-x64-node20.tgz

# macOS ARM64 (M1/M2/M3 - Node 20)
npm install -g https://github.com/sudocodeai/sudocode/releases/download/v0.1.17/sudocode-0.1.17-darwin-arm64-node20.tgz

# macOS Intel (Node 20)
npm install -g https://github.com/sudocodeai/sudocode/releases/download/v0.1.17/sudocode-0.1.17-darwin-x64-node20.tgz

# Windows (Node 20)
npm install -g https://github.com/sudocodeai/sudocode/releases/download/v0.1.17/sudocode-0.1.17-win32-x64-node20.tgz
```

### Download and Install

```bash
# 1. Download the tarball for your platform
curl -LO https://github.com/sudocodeai/sudocode/releases/download/v0.1.17/sudocode-0.1.17-linux-x64-node20.tgz

# 2. Install globally
npm install -g ./sudocode-0.1.17-linux-x64-node20.tgz

# 3. Verify installation
sudocode --version
```

## Verification

Each tarball includes a SHA256 checksum file (`.sha256`) for security verification.

### Linux/macOS

```bash
# Download tarball and checksum
curl -LO https://github.com/sudocodeai/sudocode/releases/download/v0.1.17/sudocode-0.1.17-linux-x64-node20.tgz
curl -LO https://github.com/sudocodeai/sudocode/releases/download/v0.1.17/sudocode-0.1.17-linux-x64-node20.tgz.sha256

# Verify checksum
shasum -a 256 -c sudocode-0.1.17-linux-x64-node20.tgz.sha256

# Expected output: sudocode-0.1.17-linux-x64-node20.tgz: OK
```

### Windows PowerShell

```powershell
# Download tarball and checksum
Invoke-WebRequest -Uri "https://github.com/sudocodeai/sudocode/releases/download/v0.1.17/sudocode-0.1.17-win32-x64-node20.tgz" -OutFile "sudocode-0.1.17-win32-x64-node20.tgz"
Invoke-WebRequest -Uri "https://github.com/sudocodeai/sudocode/releases/download/v0.1.17/sudocode-0.1.17-win32-x64-node20.tgz.sha256" -OutFile "sudocode-0.1.17-win32-x64-node20.tgz.sha256"

# Verify checksum
$hash = Get-FileHash -Algorithm SHA256 sudocode-0.1.17-win32-x64-node20.tgz
$expected = (Get-Content sudocode-0.1.17-win32-x64-node20.tgz.sha256).Split()[0]
if ($hash.Hash -eq $expected) { Write-Host "OK" -ForegroundColor Green } else { Write-Host "FAILED" -ForegroundColor Red }
```

## Performance Comparison

| Method | Time | Build Required? |
|--------|------|-----------------|
| `npm install -g sudocode` (from registry) | ~84s | Yes (local) |
| `npm install -g <tarball-url>` | ~5s | No (pre-built) |
| **Improvement** | **~94% faster** | ✅ |

## For Maintainers

### Triggering Builds

#### Automatic (Recommended)

Builds trigger automatically when pushing a version tag:

```bash
git tag v0.1.17
git push origin v0.1.17
```

#### Manual

You can also trigger builds manually via GitHub Actions:

1. Go to **Actions** → **Build Release Tarballs**
2. Click **Run workflow**
3. Enter the tag (e.g., `v0.1.17-beta.1`)
4. Click **Run workflow**

### Build Matrix

The workflow builds for:
- 3 operating systems: Ubuntu 22.04, macOS 13/14, Windows 2022
- 2 Node versions: 20, 22
- 2 architectures for macOS: x64, arm64

**Total builds per release:** 8 parallel jobs

### Testing Tarballs

Before releasing, test the tarballs:

```bash
# Trigger a beta build
git tag v0.1.17-beta.1
git push origin v0.1.17-beta.1

# Wait for builds to complete (~5-10 minutes)

# Test installation
npm install -g https://github.com/sudocodeai/sudocode/releases/download/v0.1.17-beta.1/sudocode-0.1.17-beta.1-linux-x64-node20.tgz

# Verify all binaries work
sudocode --version
sudocode-server --version
sudocode-mcp --version

# Test basic functionality
sudocode init
sudocode spec list
sudocode issue list
```

### Workflow Location

`.github/workflows/build-tarballs.yml`

### Artifacts

Tarballs are:
1. Uploaded as GitHub Actions artifacts (90-day retention)
2. Attached to the GitHub Release (permanent)

## Troubleshooting

### Wrong Platform/Architecture

If you install the wrong tarball, you may see errors like:

```
Error: The module '/path/to/better-sqlite3/build/Release/better_sqlite3.node'
was compiled against a different Node.js version
```

**Solution:** Download the correct tarball for your platform and Node version.

### Checksum Mismatch

If checksum verification fails:

```
sudocode-0.1.17-linux-x64-node20.tgz: FAILED
```

**Possible causes:**
- Incomplete download (try re-downloading)
- Corrupted file
- Man-in-the-middle attack (unlikely but possible)

**Solution:** Re-download from the official GitHub release page.

### Installation Fails

If `npm install -g` fails:

```bash
# Check Node version (must be 18+)
node --version

# Check npm version
npm --version

# Try with verbose logging
npm install -g <tarball-url> --loglevel verbose
```

## Related Documents

- **Build Optimization Spec:** `.sudocode/specs/s-8sb7_build_time_optimization_and_validation.md`
- **Build Time Profiling:** `.github/workflows/build-time-profile.yml`
- **Publishing Workflow:** `.github/workflows/publish.yml`

## Future Improvements

- [ ] Automated install script (detects platform/arch automatically)
- [ ] Tarball hosting on CDN for faster downloads
- [ ] Automated E2E testing of all tarballs before release
- [ ] Support for more architectures (arm64 Linux)
