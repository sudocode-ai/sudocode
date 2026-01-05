# better-sqlite3 Prebuilt Binary Packages

This directory contains platform-specific packages that bundle prebuilt binaries for better-sqlite3, eliminating the need for native compilation during npm install.

## Overview

Instead of relying on `prebuild-install` to download binaries from GitHub (which can fail), we bundle the binaries directly in npm packages following the esbuild/sharp pattern:

- Each platform gets its own package (e.g., `@sudocode-ai/better-sqlite3-darwin-arm64`)
- Packages are listed as `optionalDependencies` in `cli/package.json` and `server/package.json`
- npm automatically installs only the package matching the current platform
- A custom loader (`better-sqlite3-loader.ts`) attempts to use bundled binaries first, falling back to standard better-sqlite3 if unavailable

## Supported Platforms

- `@sudocode-ai/better-sqlite3-linux-x64` - Linux x64
- `@sudocode-ai/better-sqlite3-linux-arm64` - Linux ARM64
- `@sudocode-ai/better-sqlite3-darwin-x64` - macOS Intel
- `@sudocode-ai/better-sqlite3-darwin-arm64` - macOS Apple Silicon
- `@sudocode-ai/better-sqlite3-win32-x64` - Windows x64

## Directory Structure

```
packages/
├── README.md (this file)
├── better-sqlite3-linux-x64/
│   ├── package.json
│   ├── README.md
│   ├── index.js
│   └── better_sqlite3.node (prebuilt binary)
├── better-sqlite3-linux-arm64/
├── better-sqlite3-darwin-x64/
├── better-sqlite3-darwin-arm64/
└── better-sqlite3-win32-x64/
```

## Updating Binaries

When better-sqlite3 releases a new version:

### 1. Update VERSION in Download Script

Edit `scripts/download-better-sqlite3-binaries.sh`:

```bash
VERSION="11.10.0"  # Change to new version
NAPI_VERSION="115" # Update if N-API version changes
```

### 2. Download New Binaries

```bash
bash scripts/download-better-sqlite3-binaries.sh
```

This script:
- Downloads prebuilt binaries from better-sqlite3 GitHub releases
- Extracts `.node` files
- Places them in the appropriate package directories
- Verifies file sizes

### 3. Update Package Versions

Update `version` in package.json for all 5 platform packages:

```bash
# Update version in all platform packages
for dir in packages/better-sqlite3-*/; do
  cd "$dir"
  npm version 11.10.0 --no-git-tag-version
  cd ../..
done
```

### 4. Update optionalDependencies

Update `cli/package.json` and `server/package.json`:

```json
{
  "optionalDependencies": {
    "@sudocode-ai/better-sqlite3-linux-x64": "11.10.0",
    "@sudocode-ai/better-sqlite3-linux-arm64": "11.10.0",
    "@sudocode-ai/better-sqlite3-darwin-x64": "11.10.0",
    "@sudocode-ai/better-sqlite3-darwin-arm64": "11.10.0",
    "@sudocode-ai/better-sqlite3-win32-x64": "11.10.0"
  }
}
```

### 5. Update better-sqlite3 Dependency

Update the main `better-sqlite3` dependency in `cli/package.json` and `server/package.json`:

```json
{
  "dependencies": {
    "better-sqlite3": "^11.10.0"
  }
}
```

### 6. Test Locally

Build and test the packages:

```bash
# Build CLI with new loader
npm run build:cli

# Verify binary loading works
node -e "const db = require('./cli/dist/db.js'); console.log('✓ Works')"
```

### 7. Publish to npm

```bash
# Publish all platform packages
for dir in packages/better-sqlite3-*/; do
  cd "$dir"
  npm publish --access public
  cd ../..
done

# Then publish cli and server as usual
npm publish --workspace=@sudocode-ai/cli
npm publish --workspace=@sudocode-ai/local-server
```

## How It Works

### The Loader Pattern

The `better-sqlite3-loader.ts` file in both `cli/src/` and `server/src/`:

1. Detects the current platform (`${process.platform}-${process.arch}`)
2. Tries to resolve the corresponding platform package
3. If found, extracts the path to `better_sqlite3.node`
4. Creates a Database instance with `nativeBinding` option pointing to the bundled binary
5. Falls back to standard better-sqlite3 if platform package not available

### Example Loader Code

```typescript
function tryLoadPrebuiltBinary(): string | null {
  const platform = `${process.platform}-${process.arch}`;
  const packageName = `@sudocode-ai/better-sqlite3-${platform}`;

  try {
    const packagePath = require.resolve(packageName);
    const packageDir = path.dirname(packagePath);
    const binaryPath = path.join(packageDir, "better_sqlite3.node");

    if (fs.existsSync(binaryPath)) {
      return binaryPath;
    }
  } catch (err) {
    // Platform package not installed
  }

  return null;
}

export function createDatabase(filename: string, options?: Database.Options): Database.Database {
  const binaryPath = getPrebuiltBinaryPath();

  if (binaryPath) {
    return new Database(filename, { ...options, nativeBinding: binaryPath });
  } else {
    return new Database(filename, options);
  }
}
```

### Usage in Code

The `db.ts` files have been updated to use the loader:

```typescript
// OLD:
import Database from "better-sqlite3";
const db = new Database(path);

// NEW:
import type Database from "better-sqlite3";
import createDatabase from "./better-sqlite3-loader.js";
const db = createDatabase(path);
```

## Maintenance Burden

**Estimated time per better-sqlite3 update:** ~30 minutes

Steps:
1. Update script version (1 min)
2. Run download script (2-3 min)
3. Update package versions (2 min)
4. Update dependencies (2 min)
5. Test locally (5 min)
6. Publish packages (10-15 min)

## Troubleshooting

### Binary not loading

Check if the platform package was installed:

```bash
ls node_modules/@sudocode-ai/better-sqlite3-*
```

### Wrong platform binary

Verify the platform detection:

```bash
node -e "console.log(\`${process.platform}-${process.arch}\`)"
```

### Binary download fails

Check GitHub releases manually:
https://github.com/WiseLibs/better-sqlite3/releases/tag/v11.10.0

Verify the asset naming pattern matches:
`better-sqlite3-v{VERSION}-node-v{NAPI}-{platform}.tar.gz`

### N-API version mismatch

Check Node.js compatibility:
- N-API v108: Node.js 18.0+
- N-API v115: Node.js 20.6+
- N-API v127: Node.js 22.0+

Current script uses v115 for best compatibility with Node.js 18+.

## References

- better-sqlite3: https://github.com/WiseLibs/better-sqlite3
- esbuild pattern: https://www.npmjs.com/package/esbuild
- sharp pattern: https://www.npmjs.com/package/sharp
- npm optionalDependencies: https://docs.npmjs.com/cli/v10/configuring-npm/package-json#optionaldependencies

## Benefits

✅ **Deterministic installs** - No reliance on GitHub download availability
✅ **Faster installs** - No compilation from source (60s → <15s)
✅ **Better reliability** - Binaries always available
✅ **Follows best practices** - Same pattern as esbuild and sharp
✅ **Graceful degradation** - Falls back to standard better-sqlite3 if needed

## Trade-offs

⚠️ **Maintenance overhead** - Need to update when better-sqlite3 updates
⚠️ **Extra packages** - 5 additional npm packages to maintain
⚠️ **Storage** - Each binary is ~1-2MB
⚠️ **Publishing** - Need to publish 5 packages + cli + server

Overall, the benefits outweigh the costs for a better user experience.
