# Install Script Documentation

## Overview

The `install.sh` script provides a one-line installation method for sudocode by automatically detecting the user's platform and downloading the appropriate pre-built tarball from GitHub Releases.

## Usage

### One-Line Install (Latest Version)

```bash
curl -fsSL https://raw.githubusercontent.com/sudocode-ai/sudocode/main/scripts/install.sh | sh
```

### Install Specific Version

```bash
curl -fsSL https://raw.githubusercontent.com/sudocode-ai/sudocode/main/scripts/install.sh | sh -s -- v0.1.17
```

### Download and Inspect First (Recommended)

```bash
# Download the script
curl -fsSL https://raw.githubusercontent.com/sudocode-ai/sudocode/main/scripts/install.sh -o install.sh

# Review the script
cat install.sh

# Run it
bash install.sh

# Or install specific version
bash install.sh v0.1.17
```

## Supported Platforms

The install script automatically detects and supports:

- **Linux** (x64, arm64)
- **macOS** (x64, arm64)
- **Windows** (x64) via Git Bash/WSL

**Node.js Requirements:**
- Node.js 20 or 22 required
- Falls back to Node 20 tarball for other versions

## How It Works

### 1. Platform Detection

The script detects:
- Operating system via `uname -s`
- Architecture via `uname -m`
- Node.js version via `node --version`

### 2. Download

- Constructs tarball URL from GitHub Releases
- Downloads using `curl` or `wget` (with retries)
- Downloads SHA256 checksum if available

### 3. Verification

- Verifies checksum using `sha256sum` or `shasum`
- Skips verification if tools unavailable (with warning)

### 4. Installation

- Installs via `npm install -g <tarball>`
- Verifies installation succeeded

### 5. Cleanup

- Removes downloaded tarball and checksum
- Prints success message with next steps

## Error Handling

### No Node.js Installed

```
Error: Node.js not found
Please install Node.js 20 or 22 first:
  - https://nodejs.org/
  - Or use nvm: https://github.com/nvm-sh/nvm
```

**Solution:** Install Node.js first

### Unsupported Platform

```
Error: Unsupported platform: {os}-{arch}
Supported platforms:
  - Linux (x64, arm64)
  - macOS (x64, arm64)
  - Windows (x64)
```

**Solution:** Install manually or use `npm install -g sudocode`

### Download Failed

```
Error: Failed to download tarball
Please check:
  - Is the version correct? (v0.1.17)
  - Does the release exist for your platform? (darwin-arm64-node22)
  - Do you have internet connectivity?
```

**Solutions:**
- Check version exists: https://github.com/sudocode-ai/sudocode/releases
- Verify internet connectivity
- Try manual download

### Checksum Mismatch

```
Error: Checksum verification failed
Expected: abc123...
Actual:   def456...

Downloaded file may be corrupted or tampered with.
```

**Solutions:**
- Retry download
- Report issue if persistent
- Manual installation

### Permission Denied

```
Error: Installation failed

If you got a permission error, try one of these solutions:
  1. Use a Node version manager (nvm, fnm, volta)
  2. Run with sudo: sudo npm install -g <tarball>
  3. Configure npm to use a different prefix:
     mkdir -p ~/.npm-global
     npm config set prefix ~/.npm-global
     export PATH=~/.npm-global/bin:$PATH
```

## Testing

### Test Platform Detection

```bash
# Run the test script
./scripts/test-install.sh
```

This will show:
- Detected OS
- Detected architecture
- Node.js version
- Expected tarball name
- Expected download URL
- Available tools (curl, wget, sha256sum)

### Manual Testing Checklist

- [ ] Test on Ubuntu 22.04 (x64)
- [ ] Test on Ubuntu 22.04 (arm64)
- [ ] Test on macOS (x64)
- [ ] Test on macOS (arm64)
- [ ] Test on Windows (Git Bash)
- [ ] Test with Node 20
- [ ] Test with Node 22
- [ ] Test with no Node.js (error handling)
- [ ] Test with invalid version (error handling)
- [ ] Test checksum verification
- [ ] Test network interruption (retry logic)

## Security Considerations

### Checksum Verification

The script downloads and verifies SHA256 checksums to ensure:
- File integrity (no corruption)
- Authenticity (no tampering)

If checksum tools are unavailable, it prints a warning but continues.

### Code Review

Always recommend users review scripts before piping to `sh`:

```bash
# GOOD: Review first
curl -fsSL <url> -o install.sh
cat install.sh
bash install.sh

# RISKY: Direct pipe
curl -fsSL <url> | sh
```

### HTTPS

All downloads use HTTPS:
- GitHub Releases (https://github.com/...)
- GitHub Raw (https://raw.githubusercontent.com/...)

## Future Enhancements

### Custom Domain (get.sudocode.ai)

Option 1: GitHub Pages redirect
```bash
curl -fsSL https://get.sudocode.ai/install.sh | sh
```

Option 2: Cloudflare Pages with CDN

### Homebrew Formula

```bash
brew install sudocode
```

### NPX Alternative

```bash
npx @sudocode-ai/create
```

## Troubleshooting

### Script hangs during download

**Cause:** Network issue or slow connection

**Solution:**
- Check internet connectivity
- Try again with verbose output:
  ```bash
  bash -x install.sh
  ```

### Binary not found after install

**Cause:** npm global bin directory not in PATH

**Solution:**
```bash
# Reload shell configuration
hash -r

# Or add npm global bin to PATH
export PATH="$(npm bin -g):$PATH"

# Or restart terminal
```

### Installation succeeds but commands fail

**Cause:** Incompatible Node.js version or missing dependencies

**Solution:**
```bash
# Check Node version
node --version

# Check sudocode installation
which sudocode
sudocode --version

# Reinstall with correct Node version
nvm install 20
nvm use 20
bash install.sh
```

## Related Documentation

- [Build Tarballs Workflow](.github/workflows/build-tarballs.yml)
- [Spec: Build Time Optimization](../.sudocode/specs/s-8sb7_build_time_optimization_and_validation.md)
- [Issue: i-44ru - Create automated tarball build workflow](../.sudocode/issues/i-44ru.md)
- [Issue: i-1np6 - Create install.sh script](../.sudocode/issues/i-1np6.md)
