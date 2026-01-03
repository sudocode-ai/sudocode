# Verdaccio Setup for npm Install Profiling

## Quick Reference

### One-Command Test

```bash
./scripts/profiling/test-verdaccio-workflow.sh
```

This runs the complete workflow: start Verdaccio → publish → profile → results.

---

## Manual Workflow

### 1. Start Verdaccio

```bash
./scripts/profiling/start-verdaccio.sh
```

Verdaccio will run on `http://localhost:4873/`

### 2. Login (First Time Only)

**Option A: Automatic (CI-friendly)**
```bash
./scripts/profiling/setup-verdaccio-auth.sh
```

This script automatically handles authentication using `npm-cli-login` (non-interactive).

**Option B: Manual**
```bash
npm adduser --registry http://localhost:4873/
```

Use any credentials:
- Username: `test`
- Password: `test`
- Email: `test@test.com`

**No 2FA required!**

### 3. Publish Packages

```bash
./scripts/profiling/publish-to-verdaccio.sh
```

This builds and publishes all sudocode packages in dependency order.

### 4. Profile Installation

```bash
NPM_REGISTRY=http://localhost:4873/ SCENARIO=verdaccio node scripts/profiling/benchmark.cjs
```

### 5. Stop Verdaccio

```bash
pkill -f verdaccio
```

---

## Why Verdaccio?

| Problem | Solution |
|---------|----------|
| npm 2FA blocks automation | Verdaccio has no 2FA requirement |
| Can't test without publishing | Private local registry |
| Slow npm registry | Local network = fast |
| Fear of breaking production | Completely isolated testing |

---

## Troubleshooting

### Verdaccio won't start

```bash
# Check if port 4873 is in use
lsof -i :4873

# Kill existing Verdaccio
pkill -f verdaccio

# Try again
./scripts/profiling/start-verdaccio.sh
```

### "Not authenticated" error

```bash
npm adduser --registry http://localhost:4873/
```

### Publish fails

```bash
# Make sure you're authenticated
npm whoami --registry http://localhost:4873/

# Check if Verdaccio is running
curl http://localhost:4873/
```

### Benchmark fails

```bash
# Verify package is published
curl http://localhost:4873/sudocode

# Check if you can see package metadata
npm view sudocode --registry http://localhost:4873/
```

---

## File Structure

```
scripts/profiling/
├── verdaccio-config.yaml       # Verdaccio config (no 2FA)
├── start-verdaccio.sh          # Start Verdaccio server
├── publish-to-verdaccio.sh     # Build & publish packages
├── test-verdaccio-workflow.sh  # End-to-end test
├── benchmark.cjs               # Profiling script (supports NPM_REGISTRY)
├── storage/                    # Verdaccio package storage (gitignored)
└── results/                    # Benchmark results
```

---

## Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `NPM_REGISTRY` | Custom registry URL | `http://localhost:4873/` |
| `SCENARIO` | Benchmark scenario name | `verdaccio`, `fresh-install` |
| `TARBALL_PATH` | Local tarball path | `sudocode-0.1.17.tgz` |

---

## Comparison Workflow

```bash
# 1. Local tarball (fastest, baseline)
TARBALL_PATH=sudocode-0.1.17.tgz SCENARIO=local node benchmark.cjs

# 2. Verdaccio (realistic npm flow, local network)
NPM_REGISTRY=http://localhost:4873/ SCENARIO=verdaccio node benchmark.cjs

# 3. npm registry (production, internet speed dependent)
SCENARIO=npm-production node benchmark.cjs

# 4. Compare
cat results/benchmark-local-*.json | grep '"total"'
cat results/benchmark-verdaccio-*.json | grep '"total"'
cat results/benchmark-npm-production-*.json | grep '"total"'
```

---

## GitHub Actions Usage

The setup is **fully compatible with GitHub Actions**. Non-interactive authentication is handled automatically.

### Example Workflow

See `.github/workflows/verdaccio-profiling.yml` for the complete workflow.

**Key steps:**

```yaml
- name: Start Verdaccio
  run: ./scripts/profiling/start-verdaccio.sh &

- name: Setup authentication (non-interactive)
  run: |
    npm install -g npm-cli-login
    npm-cli-login -u test -p test -e test@test.com -r http://localhost:4873/

- name: Publish packages
  run: ./scripts/profiling/publish-to-verdaccio.sh

- name: Profile installation
  run: NPM_REGISTRY=http://localhost:4873/ node scripts/profiling/benchmark.cjs
```

### CI Detection

Scripts automatically detect CI environments (`$CI` or `$GITHUB_ACTIONS`) and use non-interactive authentication:

- **Local**: Tries `npm-cli-login`, falls back to interactive `npm adduser`
- **CI**: Installs and uses `npm-cli-login` automatically

---

## Benefits for CI/CD

1. **No secrets needed**: No npm auth tokens required
2. **Deterministic**: Same packages every time
3. **Fast**: Local network only (no internet dependency)
4. **Isolated**: Won't affect production registry
5. **Repeatable**: Can test same version multiple times
6. **Non-interactive**: Works in automated CI pipelines

---

## Next Steps

After successful Verdaccio profiling:

1. Compare results with npm registry
2. Identify bottlenecks using phase breakdown
3. Test with optimized `.npmignore`
4. Measure improvement
5. Publish to npm when satisfied
