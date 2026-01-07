# Codespace Deployment

This module provides utilities for managing GitHub Codespaces lifecycle operations.

## Modules

### `utils/gh-cli.ts`

Low-level GitHub CLI wrappers for Codespace operations.

**Functions:**

- `checkGhCliInstalled()` - Verify GitHub CLI is installed
- `checkGhAuthenticated()` - Verify GitHub authentication
- `getCurrentGitRepo()` - Get current repository in `owner/repo` format
- `createCodespace(config)` - Create a new Codespace
- `waitForCodespaceReady(name, maxRetries?)` - Poll until Codespace is Available
- `deleteCodespace(name)` - Delete a Codespace
- `listCodespaces()` - List all user Codespaces

## Usage

```typescript
import {
  checkGhCliInstalled,
  checkGhAuthenticated,
  createCodespace,
  waitForCodespaceReady,
  deleteCodespace,
  listCodespaces
} from './utils/gh-cli';

// Verify prerequisites
await checkGhCliInstalled();
await checkGhAuthenticated();

// Create Codespace
const codespace = await createCodespace({
  repository: 'owner/repo',
  machine: 'basicLinux32gb',
  idleTimeout: 240,
  retentionPeriod: 14
});

// Wait for ready
await waitForCodespaceReady(codespace.name);

// List Codespaces
const codespaces = await listCodespaces();

// Delete Codespace
await deleteCodespace(codespace.name);
```

## Testing

### Unit Tests

Run unit tests with mocked GitHub CLI responses:

```bash
npm --prefix cli test -- --run tests/unit/deploy/gh-cli.test.ts
```

### Integration Tests

⚠️ **WARNING**: Integration tests create and delete REAL Codespaces, consuming GitHub credits.

Prerequisites:
- GitHub CLI installed (`gh --version`)
- Authenticated with GitHub (`gh auth login`)
- Must be run from a GitHub repository

```bash
npm --prefix cli test -- --run tests/integration/deploy/gh-cli.test.ts
```

Integration tests automatically clean up all created Codespaces after each test.

## TypeScript Types

```typescript
interface CodespaceConfig {
  repository: string;      // owner/repo format
  machine: string;         // e.g., 'basicLinux32gb'
  idleTimeout: number;     // minutes (max 240)
  retentionPeriod: number; // days
}

interface CodespaceInfo {
  name: string;           // e.g., 'friendly-space-abc123'
  url: string;            // https://<name>.github.dev
  state: string;          // 'Available', 'Starting', etc.
  repository?: string;    // owner/repo format (from listCodespaces)
  createdAt?: string;     // ISO timestamp (from listCodespaces)
}
```

## Error Handling

All functions throw descriptive errors with context:

- Include Codespace name when applicable
- Include the command that failed
- Provide actionable error messages

Example:
```typescript
try {
  await createCodespace(config);
} catch (error) {
  // Error: Failed to create Codespace: API rate limit exceeded
  console.error(error.message);
}
```
