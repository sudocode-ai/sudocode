# Integration Tests

Integration tests that verify end-to-end functionality with actual processes, databases, and worker isolation.

## Running Integration Tests

### Prerequisites

1. Build the server:
```bash
npm --prefix server run build
```

2. For multi-project tests, start the development server:
```bash
npm --prefix server run dev
```

### Running Tests

**Run all integration tests:**
```bash
npm --prefix server test -- --run tests/integration/
```

**Run specific test file:**
```bash
npm --prefix server test -- --run tests/integration/worker-isolation.test.ts
```

**Run with verbose output:**
```bash
npm --prefix server test -- --run tests/integration/worker-isolation.test.ts --reporter=verbose
```

### Test Suites

#### `worker-isolation.test.ts`
Tests worker pool isolation and lifecycle:
- Crash isolation (worker crashes don't affect main process)
- Concurrency control (max concurrent workers enforced)
- Graceful shutdown (workers terminate cleanly)
- Event forwarding (logs, status, completion)
- Cancellation (workers can be stopped)

**Run time:** ~2-3 minutes (spawns actual worker processes)

**Skip in CI:**
```bash
SKIP_INTEGRATION_TESTS=true npm test
```

#### `multi-project.test.ts`
Tests multi-project server functionality:
- Project lifecycle (open, close, reopen)
- Project switching (data isolation)
- Concurrent operations (multiple projects at once)
- Error handling (invalid paths, missing projects)
- Performance (fast project switching)

**Requires:** Server running at http://localhost:3000

**Run time:** ~30-60 seconds

### Environment Variables

- `SKIP_INTEGRATION_TESTS=true` - Skip integration tests (useful for CI)
- `API_URL` - Override API URL (default: http://localhost:3000/api)
- `WS_URL` - Override WebSocket URL (default: ws://localhost:3000/ws)

### Test Data Cleanup

Integration tests create temporary directories in `os.tmpdir()` and clean up after themselves. If tests are interrupted, you may need to manually clean up:

```bash
# Find test directories
ls -la $(node -e "console.log(require('os').tmpdir())") | grep sudocode

# Remove stale test directories
rm -rf $(node -e "console.log(require('os').tmpdir())")/sudocode-integration-tests-*
rm -rf $(node -e "console.log(require('os').tmpdir())")/worker-integration-*
```

## Writing Integration Tests

### Best Practices

1. **Use descriptive test names** that explain what is being tested
2. **Clean up resources** in `afterAll` hooks (databases, directories, processes)
3. **Use appropriate timeouts** for operations that spawn processes
4. **Handle test failures gracefully** to avoid leaving orphaned processes
5. **Skip tests in CI** if they require specific infrastructure

### Example Pattern

```typescript
describe.skipIf(SKIP_INTEGRATION_TESTS)('My Integration Test', () => {
  let testDir: string
  let pool: ExecutionWorkerPool

  beforeAll(() => {
    // Setup test infrastructure
    testDir = join(tmpdir(), `test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterAll(async () => {
    // Cleanup resources
    if (pool) {
      await pool.shutdown()
    }
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  it('should do something', async () => {
    // Test implementation
  }, 15000) // Timeout for slow operations
})
```

### Debugging

**Enable verbose worker logs:**
```typescript
const pool = new ExecutionWorkerPool('test', {
  verbose: true, // Enables stdout/stderr forwarding
})
```

**Check worker processes:**
```bash
# List running node processes
ps aux | grep "execution-worker"

# Kill orphaned workers
pkill -f "execution-worker"
```

**Inspect test database:**
```bash
# Find test database
find $(node -e "console.log(require('os').tmpdir())") -name "test.db"

# Open with sqlite3
sqlite3 /path/to/test.db
```
