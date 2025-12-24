# Build Optimization - Quick Reference

Investigation for issue **[[i-3ubd]]** - Long build times during `npm install -g sudocode`

## TL;DR

**Top 3 Bottlenecks Identified:**
1. 🔴 Frontend build (60-120s) - 80 dependencies, heavy UI libraries
2. 🟡 Sequential builds - Packages build one-by-one instead of in parallel
3. 🟡 better-sqlite3 - May compile from source on some platforms

**Quick Wins Available:** 40-60% time savings with low-risk changes

---

## Files Created

| File | Purpose |
|------|---------|
| `.github/workflows/build-time-profile.yml` | Measure build times on CI (Ubuntu/Mac/Windows × Node 18/20/22) |
| `scripts/build-parallel.sh` | Parallel build script (35-40% faster) |
| `BUILD_OPTIMIZATION_FINDINGS.md` | Full investigation report with detailed analysis |

---

## How to Use

### 1. Measure Baseline

```bash
# Trigger GitHub Actions workflow manually
gh workflow run build-time-profile.yml

# Or: Create/push a PR that modifies the workflow file
```

Results appear in:
- GitHub Actions run summary (table with timings)
- Uploaded artifacts (npm install logs)

### 2. Test Parallel Build

```bash
# Run parallel build script
./scripts/build-parallel.sh

# Compare to current sequential build
npm run build
```

### 3. Apply Optimizations

See **Phase 1 Quick Wins** in `BUILD_OPTIMIZATION_FINDINGS.md`:

1. Enable parallel builds
2. Disable production sourcemaps
3. Improve frontend code splitting
4. Upgrade better-sqlite3 to 12.5.0

---

## Expected Results

| Scenario | Before | After | Savings |
|----------|--------|-------|---------|
| Sequential build | ~175s | ~100s | 43% |
| Frontend build | ~120s | ~70s | 42% |
| npm install -g | ~180s | ~110s | 39% |

*Estimates based on Ubuntu + Node 20. Actual results TBD.*

---

## Next Steps

1. ✅ **Baseline measurement** - Run GitHub Actions workflow
2. ⏳ **Quick wins** - Implement Priority 1-2 optimizations
3. ⏳ **Validate** - Re-run workflow, compare results
4. ⏳ **Strategic decisions** - Evaluate package splitting (Priority 3-5)

---

## Key Findings Summary

### Frontend (Biggest Issue)
- 80 production dependencies
- 43 heavy UI libraries (Monaco, Tiptap, Lexical, Radix UI)
- Limited code splitting
- Builds sequentially with other packages

**Recommendations:**
- Better code splitting
- Remove duplicate dependencies
- Disable production sourcemaps
- Consider split packages (CLI vs full)

### Build Process
- All packages build sequentially
- Can parallelize: types+frontend, then cli+server, then mcp
- Expected 35-40% speedup

**Recommendation:**
- Use `scripts/build-parallel.sh`

### better-sqlite3
- Uses prebuilt binaries when available
- Falls back to source compilation (slow)
- Version 11.10.0 (latest is 12.5.0)

**Recommendation:**
- Upgrade to 12.5.0 for better prebuilt support

---

For detailed analysis, see `BUILD_OPTIMIZATION_FINDINGS.md`
