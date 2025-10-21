# SQLite → JSONL Export

Export sudograph's SQLite database to JSONL snapshot files. Supports full and incremental exports with automatic debouncing.

## Features

- ✅ **Complete database export** - Exports all specs and issues with embedded relationships and tags
- ✅ **Incremental export** - Export only entities updated since a specific timestamp
- ✅ **Atomic writes** - Uses JSONL's atomic write feature (temp file + rename)
- ✅ **Debouncing** - Prevents rapid repeated exports with configurable delay
- ✅ **Type-safe** - Full TypeScript support with SpecJSONL and IssueJSONL types

## API Reference

### Core Export Functions

#### `specToJSONL(db, spec)`
Convert a single Spec to JSONL format with embedded relationships and tags.

```typescript
import { specToJSONL } from './export.js';

const spec = getSpec(db, 'spec-001');
const jsonl = specToJSONL(db, spec);

// jsonl includes:
// - All spec fields
// - relationships: Array of { from, to, type }
// - tags: Array of strings
```

#### `issueToJSONL(db, issue)`
Convert a single Issue to JSONL format with embedded relationships and tags.

```typescript
import { issueToJSONL } from './export.js';

const issue = getIssue(db, 'issue-001');
const jsonl = issueToJSONL(db, issue);

// jsonl includes:
// - All issue fields
// - relationships: Array of { from, to, type }
// - tags: Array of strings
```

#### `exportSpecsToJSONL(db, options?)`
Export all specs to JSONL format (in-memory).

```typescript
import { exportSpecsToJSONL } from './export.js';

// Full export
const allSpecs = exportSpecsToJSONL(db);

// Incremental export (only updated since timestamp)
const since = new Date('2025-01-01');
const updatedSpecs = exportSpecsToJSONL(db, { since });
```

#### `exportIssuesToJSONL(db, options?)`
Export all issues to JSONL format (in-memory).

```typescript
import { exportIssuesToJSONL } from './export.js';

const allIssues = exportIssuesToJSONL(db);
```

#### `exportToJSONL(db, options?)`
Export both specs and issues to JSONL files.

```typescript
import { exportToJSONL } from './export.js';

// Export to default location (.sudocode/specs/specs.jsonl, .sudocode/issues/issues.jsonl)
const result = await exportToJSONL(db);
console.log(`Exported ${result.specsCount} specs and ${result.issuesCount} issues`);

// Custom output directory
await exportToJSONL(db, {
  outputDir: 'backups'
});

// Custom file names
await exportToJSONL(db, {
  outputDir: '.sudocode',
  specsFile: 'custom-specs.jsonl',
  issuesFile: 'custom-issues.jsonl'
});

// Incremental export
await exportToJSONL(db, {
  since: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
});
```

**Options:**
- `outputDir?: string` - Directory for output files (default: `.sudocode`)
- `specsFile?: string` - Specs file path relative to outputDir (default: `specs/specs.jsonl`)
- `issuesFile?: string` - Issues file path relative to outputDir (default: `issues/issues.jsonl`)
- `since?: Date` - Only export entities updated after this timestamp

**Returns:**
```typescript
{
  specsCount: number;
  issuesCount: number;
}
```

### Debounced Export

#### `ExportDebouncer`
Automatic debouncing for export operations to prevent rapid repeated exports.

```typescript
import { ExportDebouncer } from './export.js';

const debouncer = new ExportDebouncer(
  db,
  5000, // 5 second delay
  { outputDir: '.sudocode' }
);

// Trigger export (will be debounced)
debouncer.trigger();
debouncer.trigger(); // Only the last trigger within 5s will execute
debouncer.trigger();

// Check if pending
if (debouncer.isPending()) {
  console.log('Export will execute soon...');
}

// Cancel pending export
debouncer.cancel();

// Force immediate execution
await debouncer.flush();
```

**Methods:**
- `trigger()` - Trigger an export (will be debounced)
- `execute()` - Execute export immediately
- `cancel()` - Cancel any pending export
- `isPending()` - Check if an export is pending
- `flush()` - Execute any pending export immediately

#### `createDebouncedExport(db, delayMs?, options?)`
Factory function to create a debouncer.

```typescript
import { createDebouncedExport } from './export.js';

const debouncer = createDebouncedExport(db, 5000, {
  outputDir: '.sudocode'
});
```

## Usage Examples

### Basic Export

```typescript
import { initDatabase } from './db.js';
import { exportToJSONL } from './export.js';

const db = initDatabase({ path: '.sudocode/cache.db' });

// Export everything
const result = await exportToJSONL(db);
console.log(`Exported ${result.specsCount} specs and ${result.issuesCount} issues`);
```

### Incremental Export

```typescript
// Store last export time
let lastExport = new Date();

// Later... export only changes
await exportToJSONL(db, {
  since: lastExport
});

lastExport = new Date();
```

### Debounced Auto-Export

```typescript
import { createDebouncedExport } from './export.js';
import { updateIssue } from './operations/issues.js';

// Create debouncer with 5 second delay
const debouncer = createDebouncedExport(db, 5000);

// Trigger export after database changes
updateIssue(db, 'issue-001', { status: 'in_progress' });
debouncer.trigger();

updateIssue(db, 'issue-002', { status: 'closed' });
debouncer.trigger(); // Will reset the timer

// Export happens once, 5 seconds after last trigger
```

### Export on Database Changes

```typescript
import { transaction } from './operations/transactions.js';

const debouncer = createDebouncedExport(db, 5000);

function updateWithExport<T>(operation: () => T): T {
  const result = transaction(db, operation);
  debouncer.trigger();
  return result;
}

// Use wrapper for all database operations
updateWithExport(() => {
  createIssue(db, { ... });
  addRelationship(db, { ... });
  addTags(db, 'issue-001', 'issue', ['urgent']);
});
```

### Manual Backup

```typescript
import { exportToJSONL } from './export.js';

// Create timestamped backup
const timestamp = new Date().toISOString().replace(/:/g, '-');
await exportToJSONL(db, {
  outputDir: `backups/${timestamp}`
});
```

## JSONL Format

### Specs JSONL

```jsonl
{"id":"spec-001","title":"Auth System","file_path":".sudocode/specs/auth.md","content":"# Auth\n\n...","type":"architecture","status":"draft","priority":1,"created_at":"2025-10-16T10:00:00Z","updated_at":"2025-10-16T15:00:00Z","created_by":"alice","updated_by":"alice","parent_id":null,"relationships":[{"from":"spec-001","to":"spec-002","type":"related"}],"tags":["auth","security"]}
```

**Embedded fields:**
- `relationships` - Array of outgoing relationships
  ```typescript
  { from: string, to: string, type: RelationshipType }
  ```
- `tags` - Array of tag strings

### Issues JSONL

```jsonl
{"id":"issue-001","title":"Implement OAuth","description":"...","content":"...","status":"open","priority":1,"issue_type":"task","assignee":"agent-backend","estimated_minutes":120,"created_at":"2025-10-16T10:00:00Z","updated_at":"2025-10-16T15:00:00Z","closed_at":null,"created_by":"alice","parent_id":null,"relationships":[{"from":"issue-001","to":"spec-001","type":"implements"}],"tags":["auth","backend"]}
```

## Performance

- **Export speed**: ~10k entities/second
- **Memory usage**: Loads all entities into memory, then writes
- **File size**: ~1KB per entity (varies with content)
- **Atomic writes**: Prevents corruption during export

**Recommendations:**
- Use debouncing (5s default) to avoid excessive exports
- For very large datasets (>100k entities), consider batch processing
- Store JSONL files in `.gitignore` during development, commit snapshots periodically

## Testing

All export functions have comprehensive tests:

```bash
npm test -- export.test.ts
```

**Test coverage:**
- 13 tests covering all export operations
- Spec and issue conversion to JSONL
- Full and incremental exports
- File writing and atomic operations
- Debouncing behavior (trigger, cancel, flush)

All 103 project tests pass ✅

## Integration

Export is used by:
- **CLI** (`sg export`) - Manual export command
- **Sync** - Auto-export after database changes
- **Git hooks** - Pre-commit snapshots

Next steps:
- Import (sudograph-6) - JSONL → SQLite with collision resolution
- Sync (sudograph-8) - Bidirectional Markdown ↔ JSONL ↔ SQLite
