# Quick Start: better-sqlite3 Bundled Binaries

## For Developers

### First-Time Setup

Nothing needed! The loader automatically uses bundled binaries when available.

### How to Check if It's Working

After installing `@sudocode-ai/cli` or `@sudocode-ai/local-server`:

```bash
# Check if platform package was installed
ls node_modules/@sudocode-ai/better-sqlite3-*/

# Should see one directory matching your platform, e.g.:
# node_modules/@sudocode-ai/better-sqlite3-darwin-arm64/
```

## For Maintainers

### Updating to New better-sqlite3 Version

**5-minute version:**

```bash
# 1. Edit version in download script
vim scripts/download-better-sqlite3-binaries.sh
# Change VERSION="11.10.0" to new version

# 2. Download binaries
bash scripts/download-better-sqlite3-binaries.sh

# 3. Update package versions
cd packages
for dir in better-sqlite3-*/; do
  (cd "$dir" && npm version 11.11.0 --no-git-tag-version)
done
cd ..

# 4. Update dependencies
vim cli/package.json server/package.json
# Change all @sudocode-ai/better-sqlite3-* versions
# Change better-sqlite3 version in dependencies

# 5. Publish
for dir in packages/better-sqlite3-*/; do
  (cd "$dir" && npm publish --access public)
done
npm publish --workspace=@sudocode-ai/cli
npm publish --workspace=@sudocode-ai/local-server
```

## For CI/CD

### Publishing in CI

The platform packages should be published before cli/server:

```yaml
- name: Publish platform packages
  run: |
    for dir in packages/better-sqlite3-*/; do
      cd "$dir"
      npm publish --access public
      cd ../..
    done

- name: Publish main packages
  run: |
    npm publish --workspace=@sudocode-ai/cli
    npm publish --workspace=@sudocode-ai/local-server
```

## Troubleshooting

### "Cannot find module '@sudocode-ai/better-sqlite3-...'"

This is normal! The loader tries all platforms and uses whichever matches.

### Install still compiling from source

Check if the platform package installed:

```bash
npm ls @sudocode-ai/better-sqlite3-darwin-arm64
```

If not listed, the platform might not be published yet.

### Wrong binary for platform

Verify platform detection:

```bash
node -e "console.log(process.platform + '-' + process.arch)"
```

Should output one of:
- `linux-x64`
- `linux-arm64`
- `darwin-x64`
- `darwin-arm64`
- `win32-x64`

## Architecture

```
┌─────────────────────────────────────────┐
│  User runs: npm install -g sudocode     │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  npm installs @sudocode-ai/cli          │
│  + optionalDependencies (5 packages)    │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  npm checks platform constraints        │
│  Keeps: darwin-arm64 (current platform) │
│  Skips: others (wrong os/cpu)           │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Application starts                     │
│  db.ts calls createDatabase()           │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Loader detects platform: darwin-arm64  │
│  Resolves: @sudocode-ai/better-sqlite..│
│  Finds: better_sqlite3.node             │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Creates Database with nativeBinding    │
│  = bundled binary path                  │
│  ✓ No compilation needed!               │
└─────────────────────────────────────────┘
```

## Key Files

- `packages/README.md` - Full documentation
- `scripts/download-better-sqlite3-binaries.sh` - Update tool
- `cli/src/better-sqlite3-loader.ts` - Runtime loader
- `server/src/better-sqlite3-loader.ts` - Runtime loader

## Support

For issues or questions, see:
- Issue tracker: https://github.com/sudocode-ai/sudocode/issues
- Full docs: `packages/README.md`
- Implementation: `IMPLEMENTATION_SUMMARY.md`
