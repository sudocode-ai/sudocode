# Homebrew Tap for sudocode

This directory contains the Homebrew formula for sudocode. To use it, you'll need to set up a separate tap repository.

## Setup Instructions

### 1. Create the Tap Repository

Create a new GitHub repository named `homebrew-sudocode` under your organization:

```bash
gh repo create sudocode-ai/homebrew-sudocode --public --description "Homebrew tap for sudocode"
```

### 2. Initialize the Tap

```bash
cd /tmp
git clone https://github.com/sudocode-ai/homebrew-sudocode.git
cd homebrew-sudocode

# Create the Formula directory structure
mkdir -p Formula

# Copy the formula from this repo
cp /path/to/sudocode/homebrew/Formula/sudocode.rb Formula/

# Create a README
cat > README.md << 'EOF'
# Homebrew Tap for sudocode

Git-native spec and issue management for AI-assisted development.

## Installation

```bash
brew tap sudocode-ai/sudocode
brew install sudocode
```

## Usage

```bash
# Initialize a project
sudocode init

# Create specs and issues
sudocode spec create "My Feature"
sudocode issue create "Implement feature"

# Start the local server with UI
sudocode-server
```

## Updating

```bash
brew update
brew upgrade sudocode
```

## Links

- [Website](https://sudocode.ai)
- [Documentation](https://github.com/sudocode-ai/sudocode)
- [npm Package](https://www.npmjs.com/package/sudocode)
EOF

git add .
git commit -m "Initial formula for sudocode v1.1.15"
git push origin main
```

### 3. Test the Tap

```bash
# Tap the repository
brew tap sudocode-ai/sudocode

# Install sudocode
brew install sudocode

# Verify installation
sudocode --version
```

## Local Testing

Before pushing to the tap, test the formula locally:

```bash
# From this directory
brew install --build-from-source ./Formula/sudocode.rb

# Run Homebrew's audit
brew audit --strict ./Formula/sudocode.rb

# Test the formula
brew test ./Formula/sudocode.rb
```

## Updating the Formula

### Automatic (Recommended)

The formula is automatically updated when you publish to npm with the `latest` tag:

1. Run the publish workflow: `npm run publish` or trigger via GitHub Actions
2. The `homebrew-bump.yml` workflow runs automatically after publish
3. It calculates the new SHA256 and updates the tap repository

**Required Setup for Automation:**

1. Create a GitHub PAT with `repo` scope (to push to homebrew-sudocode)
2. Add it as a secret named `HOMEBREW_TAP_TOKEN` in the sudocode repository

### Manual

If you need to update manually:

1. Publish to npm: `npm run publish`
2. Get the new SHA256: `curl -sL https://registry.npmjs.org/sudocode/-/sudocode-<VERSION>.tgz | shasum -a 256`
3. Update `Formula/sudocode.rb` with new version and SHA256
4. Commit and push to the tap repository

Or trigger the workflow manually: Actions → "Bump Homebrew Formula" → Run workflow

## Binaries Included

The formula installs three binaries:

| Binary | Description |
|--------|-------------|
| `sudocode` / `sdc` | Main CLI for spec and issue management |
| `sudocode-mcp` | MCP server for Claude integration |
| `sudocode-server` | Local server with web UI |
