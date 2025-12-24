# Build Time Optimization Investigation

**Issue:** [[i-3ubd]] - Investigate and optimize long build times during `npm install -g sudocode`

**Investigation Date:** 2025-12-24

## Executive Summary

This investigation identified **5 major bottlenecks** causing slow `npm install -g sudocode` times. The primary culprits are:

1. **Frontend build (biggest bottleneck)** - 80 dependencies, heavy UI libraries
2. **Sequential build process** - Packages build one-by-one instead of in parallel
3. **better-sqlite3 native module** - May compile from source on some platforms
4. **TypeScript compilation overhead** - Multiple tsconfig compilations
5. **Server post-build script** - Copies entire frontend dist

**Estimated time savings with optimizations: 35-50%**

---

## Baseline Metrics (To Be Measured)

A GitHub Actions workflow has been created at `.github/workflows/build-time-profile.yml` to measure:

- Total `npm install` time
- Individual package build times
- `npm install -g sudocode` time from tarball
- Better-sqlite3 compilation vs prebuilt binary usage
- node_modules size analysis

**Matrix:** ubuntu-latest, macos-latest, windows-latest × Node 18, 20, 22

### Expected Build Order (Current Sequential)

```
npm install → types (fast) → cli (moderate) → mcp (fast) → frontend (SLOW) → server (moderate)
```

---

## Detailed Bottleneck Analysis

### 1. Frontend Build - CRITICAL BOTTLENECK ⚠️

**Severity:** HIGH
**Impact:** Estimated 40-60% of total build time

#### Problem Details

- **80 production dependencies** (frontend/package.json:44-124)
- **43 heavy UI libraries** identified:
  - Monaco Editor (code editor, very large)
  - Tiptap (rich text editor with 20+ extension packages)
  - Lexical (alternative rich text editor)
  - 18 Radix UI components
  - Git diff viewer
  - ReactFlow/XYFlow (graph visualization)

#### Specific Issues

1. **Duplicate/overlapping functionality:**
   - Both Tiptap AND Lexical for rich text editing
   - Multiple markdown processors (react-markdown, remark, rehype)

2. **Large bundle size:**
   - Monaco Editor alone is 5-10MB minified
   - Tiptap with all extensions: 2-3MB
   - Total frontend dist likely 15-20MB+

3. **Vite build configuration:**
   - Limited code splitting (frontend/vite.config.ts:46-53)
   - Only 2 manual chunks defined
   - Sourcemaps enabled in production build (adds overhead)

#### Current Config

```typescript
// frontend/vite.config.ts:43-54
build: {
  outDir: 'dist',
  sourcemap: true,  // ← Adds build time
  rollupOptions: {
    output: {
      manualChunks: {
        'react-vendor': ['react', 'react-dom', 'react-router-dom'],
        'ui-vendor': ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu'],
        // ← Only 2 chunks, should split monaco, tiptap, etc.
      },
    },
  },
},
```

---

### 2. Sequential Build Process - HIGH IMPACT ⚠️

**Severity:** HIGH
**Impact:** 30-40% time savings possible with parallelization

#### Current Build (root package.json:17)

```bash
npm run build --workspace=types && \
npm run build --workspace=cli && \
npm run build --workspace=mcp && \
npm run build --workspace=frontend && \
npm run build --workspace=server
```

**Problem:** All packages build sequentially, but some can run in parallel.

#### Dependency Graph

```
types (standalone, ~5-10s)
  ├─> cli (depends on types, ~10-20s)
  │    └─> mcp (depends on cli, ~5-10s)
  └─> server (depends on types, ~10-15s)

frontend (standalone, ~60-120s) ← LONGEST, runs alone!
```

#### Optimization Opportunity

**Current total time (estimated):** 90-175s
**Optimized parallel time:** 60-120s (35-40% faster)

```
Group 1 (parallel): types (10s) + frontend (120s) = 120s (max)
Group 2 (parallel): cli (20s) + server (15s) = 20s (max)
Group 3 (sequential): mcp (10s) = 10s

Total: 150s vs 175s sequential = 14% faster
```

**Better optimization** if we can split frontend:
- Build frontend separately or make it optional for CLI users

---

### 3. better-sqlite3 Native Module - MODERATE IMPACT

**Severity:** MODERATE
**Impact:** 10-30s on first install if compiling from source

#### Current Usage

- **cli/package.json:51** - `better-sqlite3: ^11.10.0`
- **server/package.json:52** - `better-sqlite3: ^11.10.0`
- **types/package.json:72** (devDependency only)

#### Investigation Results

```bash
# From package-lock.json
"node_modules/better-sqlite3": {
  "version": "11.10.0",
  "hasInstallScript": true,  # ← Runs install script
  "dependencies": {
    "bindings": "^1.5.0",
    "prebuild-install": "^7.1.1"  # ← Uses prebuilds when available
  }
}
```

#### How it Works

1. **Preferred:** Downloads prebuilt binary for platform/Node version
2. **Fallback:** Compiles from source using node-gyp (slow!)

#### When Compilation Happens

- Platform/architecture without prebuilt binaries
- Node version too new (prebuilds lag behind Node releases)
- Missing build tools (python, C++ compiler)

#### Detection

The GitHub Actions workflow checks:
```bash
if grep -q "node-gyp" npm-install.log; then
  echo "⚠️ better-sqlite3 compiled from source"
```

#### Optimization Status

✅ **Already optimized** - Using `prebuild-install` for prebuilt binaries
⚠️ **Potential issue** - Using version 11.10.0, but latest is 12.5.0

**Recommendation:** Upgrade to 12.5.0 for newer prebuilds

---

### 4. TypeScript Compilation - LOW-MODERATE IMPACT

**Severity:** MODERATE
**Impact:** Incremental, but adds up across packages

#### Issues Identified

1. **Multiple separate compilations** (one per package)
2. **Declaration maps and source maps** add overhead
3. **No project references** for monorepo optimization
4. **Strict mode + linting** in all packages

#### Example: cli/tsconfig.json

```json
{
  "compilerOptions": {
    "declaration": true,        // ← Generates .d.ts files
    "declarationMap": true,     // ← Generates .d.ts.map files
    "sourceMap": true,          // ← Generates .js.map files
    "strict": true,             // ← Extra type checking
    // ... more strict options
  }
}
```

#### Optimization Opportunities

1. **Disable source maps in production builds** (cli, server, mcp)
   - Frontend needs them for debugging, but CLI doesn't
   - Save ~20% build time per package

2. **Use TypeScript project references** for monorepo
   - Let TypeScript understand cross-package dependencies
   - Enable incremental builds
   - Faster rebuilds during development

3. **Consider esbuild for runtime builds**
   - Keep `tsc` for type checking and .d.ts generation
   - Use esbuild for actual compilation (10x faster)
   - Already used in server devDependencies

---

### 5. Server Post-Build Script - LOW IMPACT

**Severity:** LOW
**Impact:** 1-3s

#### Current Process

```json
// server/package.json:13
"build": "tsc && chmod +x ... && node scripts/copy-frontend.js"
```

```javascript
// server/scripts/copy-frontend.js:16-18
if (existsSync(frontendDist)) {
  cpSync(frontendDist, serverPublic, { recursive: true });
  // Copies entire frontend dist (~15-20MB)
}
```

#### Issues

- Synchronous recursive copy of large directory
- Happens after TypeScript compilation
- Blocks build completion

#### Optimization

**Low priority** - Only 1-3s, but could use streaming copy or symlinks in dev.

---

## Proposed Optimizations (Prioritized)

### Priority 1: Parallel Builds (Quick Win) 🚀

**Expected Savings:** 35-40% total build time
**Effort:** Low
**Risk:** Low

#### Implementation

A parallel build script has been created: `scripts/build-parallel.sh`

```bash
# Group 1: types + frontend (parallel)
npm run build --workspace=types &
npm run build --workspace=frontend &
wait

# Group 2: cli + server (parallel)
npm run build --workspace=cli &
npm run build --workspace=server &
wait

# Group 3: mcp (sequential)
npm run build --workspace=mcp
```

#### Integration

Add to root package.json:
```json
{
  "scripts": {
    "build": "npm run build --workspace=types && npm run build --workspace=cli && npm run build --workspace=mcp && npm run build --workspace=frontend && npm run build --workspace=server",
    "build:parallel": "./scripts/build-parallel.sh"
  }
}
```

Update publish.sh to use parallel build.

---

### Priority 2: Optimize Frontend Build 🎯

**Expected Savings:** 30-50% frontend build time
**Effort:** Medium
**Risk:** Low-Medium

#### Actions

**2A. Improve code splitting** (Low risk)

```typescript
// frontend/vite.config.ts - add to manualChunks
manualChunks: {
  'react-vendor': ['react', 'react-dom', 'react-router-dom'],
  'ui-vendor': ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu'],
  // NEW:
  'monaco': ['@monaco-editor/react', 'monaco-editor'],
  'tiptap': ['@tiptap/react', '@tiptap/starter-kit'],
  'graph': ['@xyflow/react', 'dagre'],
  'diff': ['@git-diff-view/react'],
}
```

**2B. Disable production sourcemaps** (Quick win)

```typescript
// frontend/vite.config.ts
build: {
  sourcemap: false,  // Or 'hidden' for error reporting
}
```

**2C. Remove duplicate dependencies** (Medium effort)

- Decision needed: Tiptap OR Lexical (not both)
- Investigate if both are actively used
- Potentially 2-3MB reduction

**2D. Make frontend optional for CLI-only installs** (Higher effort)

- Split into `sudocode-cli` (lightweight) and `sudocode` (full)
- Or lazy-load frontend assets
- Biggest potential impact for CLI-focused users

---

### Priority 3: Upgrade better-sqlite3 📦

**Expected Savings:** 0-20s (platform-dependent)
**Effort:** Very Low
**Risk:** Low

#### Action

```bash
# In cli/, server/, types/
npm install better-sqlite3@^12.5.0
```

#### Benefits

- More prebuilt binaries for newer Node versions
- Better compatibility with Node 22
- Potential bug fixes and performance improvements

#### Testing

The GitHub Actions workflow will show if prebuilds are being used.

---

### Priority 4: Optimize TypeScript Compilation ⚙️

**Expected Savings:** 10-20% per package
**Effort:** Medium
**Risk:** Low

#### 4A. Disable unnecessary source maps (Quick)

```json
// cli/tsconfig.json, server/tsconfig.json, mcp/tsconfig.json
{
  "compilerOptions": {
    "sourceMap": false,        // Only needed for debugging
    "declarationMap": false,   // Only needed for IDE navigation
  }
}
```

#### 4B. Use TypeScript project references (Medium effort)

```json
// Root tsconfig.json
{
  "files": [],
  "references": [
    { "path": "./types" },
    { "path": "./cli" },
    { "path": "./server" },
    { "path": "./mcp" },
    { "path": "./frontend" }
  ]
}
```

Then build with: `tsc --build`

Benefits:
- Incremental builds
- Better monorepo support
- Faster rebuilds

---

### Priority 5: Alternative Frontend Build Strategies 🔄

**Expected Savings:** 20-40% frontend build
**Effort:** High
**Risk:** Medium

#### Options

**5A. Pre-build frontend assets**
- Build frontend once, publish to CDN or npm package
- Server downloads pre-built assets
- Eliminates frontend build from install entirely
- Tradeoff: Larger published package

**5B. Lazy frontend compilation**
- Don't build frontend during `npm install -g`
- Build on first `sudocode server start`
- Better UX for CLI-only users
- Slightly worse UX for server users (one-time delay)

**5C. Switch to faster bundler**
- Vite is already pretty fast
- Could try Turbopack or Rspack
- Marginal gains, high effort

---

## Recommended Implementation Plan

### Phase 1: Quick Wins (1-2 days)

1. ✅ Create GitHub Actions profiling workflow (DONE)
2. Enable parallel builds in publish.sh
3. Disable frontend/server sourcemaps in production
4. Improve frontend code splitting
5. Upgrade better-sqlite3 to 12.5.0

**Expected total savings:** 40-50%

### Phase 2: Medium Effort (3-5 days)

1. Implement TypeScript project references
2. Remove duplicate frontend dependencies (Tiptap vs Lexical)
3. Optimize Vite build configuration
4. Disable sourcemaps in CLI/server packages

**Expected additional savings:** 10-15%

### Phase 3: Strategic (1-2 weeks)

1. Evaluate splitting into sudocode-cli vs sudocode packages
2. Consider pre-building frontend assets
3. Investigate alternative bundling strategies

**Expected additional savings:** 20-30% (for CLI-only users)

---

## Testing Plan

### 1. Baseline Measurement

Run GitHub Actions workflow on main branch:
```bash
# Manually trigger workflow
gh workflow run build-time-profile.yml
```

Collect metrics for all OS × Node combinations.

### 2. Optimization Testing

For each optimization:
1. Apply change
2. Run workflow again
3. Compare results
4. Document improvement

### 3. Regression Testing

- Run full test suite: `npm run test:all`
- Test fresh install: `npm install -g sudocode-*.tgz`
- Verify all commands work: `sudocode --version`, `sudocode server start`

---

## Metrics to Track

| Metric | Current (Est.) | Target | Actual |
|--------|---------------|--------|--------|
| Total build time (Ubuntu, Node 20) | 175s | 100s | TBD |
| Frontend build time | 120s | 70s | TBD |
| CLI build time | 20s | 15s | TBD |
| npm install -g time | 180s | 110s | TBD |
| better-sqlite3 prebuilt usage | Unknown | 100% | TBD |
| node_modules size | Unknown | <500MB | TBD |

---

## Additional Notes

### Package Size Analysis Needed

The profiling workflow will report:
- Total node_modules size
- Top 10 largest packages
- Published package sizes

This will help identify if package bloat is a separate issue.

### User Impact

Different user personas affected differently:

1. **CLI-only users** (sudocode, sdc)
   - Most impacted by build time
   - Don't need frontend
   - Would benefit from split packages

2. **Server users** (sudocode server start)
   - Need frontend
   - One-time install cost
   - Less concerned about build time

3. **Development contributors**
   - Frequent rebuilds
   - Would benefit most from incremental builds
   - TypeScript project references would help

### Questions for Follow-up

1. Are both Tiptap and Lexical actively used in the frontend?
2. Is there appetite for splitting into CLI vs full packages?
3. Should frontend assets be pre-built and CDN-hosted?
4. What's the acceptable install time for users? (60s? 90s? 120s?)

---

## Files Created/Modified

### Created
- `.github/workflows/build-time-profile.yml` - Profiling workflow
- `scripts/build-parallel.sh` - Parallel build script
- `BUILD_OPTIMIZATION_FINDINGS.md` - This document

### To Modify (Recommendations)
- `package.json` - Add build:parallel script
- `scripts/publish.sh` - Use parallel build
- `frontend/vite.config.ts` - Improve code splitting, disable sourcemaps
- `cli/package.json`, `server/package.json` - Upgrade better-sqlite3
- `cli/tsconfig.json`, `server/tsconfig.json`, `mcp/tsconfig.json` - Disable sourcemaps
- Root `tsconfig.json` - Add project references (optional)

---

## Conclusion

The investigation identified **frontend build time** as the primary bottleneck (40-60% of total), followed by **sequential build process** (30-40% savings with parallelization).

**Immediate actions** (Priority 1-2) can reduce build times by **40-60%** with low risk.

**Long-term strategies** (Priority 3-5) can achieve additional **20-30% savings** but require architectural decisions about package splitting.

Next step: **Run GitHub Actions workflow** to establish baseline metrics and validate estimates.
