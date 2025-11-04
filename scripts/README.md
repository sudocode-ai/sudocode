# Publishing Scripts

This directory contains scripts for version management and publishing sudocode packages to npm.

## Version Management

All packages maintain synchronized versions, except the meta-package which has its major version incremented by 1:

- **Packages**: `@sudocode-ai/types`, `@sudocode-ai/cli`, `@sudocode-ai/mcp`, `@sudocode-ai/local-server`
- **Meta-package**: `sudocode` (major version = packages major + 1)

### Version Examples

| Packages Version | Meta-package Version |
|-----------------|---------------------|
| 0.1.0           | 1.1.0              |
| 0.2.0           | 1.2.0              |
| 1.0.0           | 2.0.0              |
| 1.5.3           | 2.5.3              |

## Scripts

### `version.sh` - Update Package Versions

Updates all package versions in sync.

**Usage:**
```bash
./scripts/version.sh <version> [--dry-run]
```

**Examples:**
```bash
# Preview version changes without applying
./scripts/version.sh 0.2.0 --dry-run

# Update all packages to version 0.2.0 (meta-package becomes 1.2.0)
./scripts/version.sh 0.2.0

# Use npm script
npm run version 0.2.0
```

**Workflow:**
1. Shows proposed changes
2. Asks for confirmation
3. Updates all package.json files
4. Displays next steps for committing and tagging

### `publish.sh` - Publish Packages to NPM

Builds and publishes all packages to npm in dependency order.

**Usage:**
```bash
./scripts/publish.sh [--dry-run] [--tag <tag>] [--skip-tests]
```

**Options:**
- `--dry-run`: Preview what would be published without actually publishing
- `--tag <tag>`: Set npm dist-tag (default: `latest`)
- `--skip-tests`: Skip running tests before publishing

**Examples:**
```bash
# Dry run to preview (recommended first step)
./scripts/publish.sh --dry-run

# Publish to latest (stable release)
./scripts/publish.sh

# Publish to beta tag
./scripts/publish.sh --tag beta

# Skip tests (use cautiously)
./scripts/publish.sh --skip-tests

# Use npm scripts
npm run publish:dry-run
npm run publish
```

**Features:**
- ✅ Checks npm authentication
- ✅ Runs tests before publishing (unless skipped)
- ✅ Detects already-published versions and skips them
- ✅ Builds all packages
- ✅ Publishes in dependency order: types → cli → mcp → server → meta-package
- ✅ Uses public access for scoped packages
- ✅ Supports dist-tags for prerelease versions

## Publishing Workflow

### Local Publishing

1. **Update versions:**
   ```bash
   ./scripts/version.sh 0.2.0
   ```

2. **Review changes:**
   ```bash
   git diff
   ```

3. **Commit and tag:**
   ```bash
   git add -A
   git commit -m "Bump version to 0.2.0"
   git tag v0.2.0
   git push && git push --tags
   ```

4. **Test publish (dry-run):**
   ```bash
   ./scripts/publish.sh --dry-run
   ```

5. **Publish for real:**
   ```bash
   ./scripts/publish.sh
   ```

### GitHub Actions Publishing

Publishing is automated via GitHub Actions in two ways:

#### 1. Manual Trigger (Workflow Dispatch)

Manually trigger a publish from the GitHub Actions UI:
- Go to Actions → "Publish to NPM" → "Run workflow"
- Select dist-tag (`latest`, `beta`, `alpha`, `next`)
- Optionally skip tests
- Click "Run workflow"

#### 2. Automatic on Git Tags

Automatically publishes when you push a version tag:

```bash
# After updating versions and committing
git tag v0.2.0
git push --tags
```

The workflow will:
- Automatically detect if it's a prerelease (contains `alpha`, `beta`, `rc`, or `next`)
- Use `latest` tag for stable releases, `next` for prereleases
- Build and publish all packages
- Skip already-published versions

## Setup Requirements

### Local Publishing

1. **Login to npm:**
   ```bash
   npm login
   ```

2. **Verify authentication:**
   ```bash
   npm whoami
   ```

### GitHub Actions

1. **Create npm access token:**
   - Go to npmjs.com → Account Settings → Access Tokens
   - Create "Automation" token with "Read and Publish" permissions
   - Copy the token

2. **Add token to GitHub:**
   - Go to GitHub repo → Settings → Secrets and variables → Actions
   - Create new repository secret named `NPM_TOKEN`
   - Paste your npm token

3. **Verify permissions:**
   - Ensure you're logged into npm with publish access to the `@sudocode-ai` scope

## Package Publishing Order

Packages are published in dependency order to ensure consumers can install without errors:

1. **@sudocode-ai/types** - Type definitions (no dependencies)
2. **@sudocode-ai/cli** - CLI tool (depends on types)
3. **@sudocode-ai/mcp** - MCP server (depends on cli, types)
4. **@sudocode-ai/local-server** - Backend server (depends on cli, types)
5. **sudocode** - Meta-package (bundles all packages)

## Troubleshooting

### Already Published Error

If you see "Cannot publish over existing version":
- This is expected - the script detects and skips already-published packages
- Update versions with `./scripts/version.sh <new-version>` first

### Authentication Failed

If npm publish fails with 401/403:
```bash
# Re-login to npm
npm logout
npm login

# Verify you have publish access
npm access ls-packages @sudocode-ai
```

### Build Failures

If builds fail:
```bash
# Clean and rebuild
npm run clean
npm run build

# Check for errors
npm run test
```

### GitHub Actions Failures

Check the workflow logs:
1. Go to Actions tab in GitHub
2. Click on the failed workflow run
3. Expand the failed step
4. Check for error messages

Common issues:
- Missing `NPM_TOKEN` secret
- Package version already published
- Test failures (use `skip-tests` input if needed)

## Version History

To check what's currently published:

```bash
# Check specific package
npm view @sudocode-ai/cli versions

# Check all packages
npm view @sudocode-ai/types version
npm view @sudocode-ai/cli version
npm view @sudocode-ai/mcp version
npm view @sudocode-ai/local-server version
npm view sudocode version
```
