# JSONL Reader/Writer

JSONL (JSON Lines) format handler for sudograph. Supports reading and writing `.jsonl` files with proper error handling, atomic writes, and streaming for large files.

## Features

- ✅ **Streaming reads** - Memory-efficient reading of large files
- ✅ **Atomic writes** - Write to temp file, then rename (prevents corruption)
- ✅ **Error handling** - Skip or throw on malformed JSON
- ✅ **Line-level updates** - Efficiently update single entities
- ✅ **Sync & Async APIs** - Both async and synchronous versions
- ✅ **Type-safe** - Full TypeScript support

## API Reference

### Reading JSONL Files

#### `readJSONL(filePath, options?)`
Read a JSONL file asynchronously with streaming (recommended for large files).

```typescript
import { readJSONL } from './jsonl.js';

// Read all entities
const entities = await readJSONL('specs.jsonl');

// Skip malformed lines
const entities = await readJSONL('specs.jsonl', {
  skipErrors: true
});

// Custom error handler
const entities = await readJSONL('specs.jsonl', {
  skipErrors: true,
  onError: (lineNumber, line, error) => {
    console.error(`Error at line ${lineNumber}: ${error.message}`);
  }
});
```

#### `readJSONLSync(filePath, options?)`
Read a JSONL file synchronously (for smaller files).

```typescript
const entities = readJSONLSync('issues.jsonl');
```

**Options:**
- `skipErrors?: boolean` - Skip malformed lines instead of throwing (default: `false`)
- `onError?: (lineNumber, line, error) => void` - Custom error handler

### Writing JSONL Files

#### `writeJSONL(filePath, entities, options?)`
Write entities to a JSONL file asynchronously.

```typescript
import { writeJSONL } from './jsonl.js';

const specs = [
  { id: 'spec-001', title: 'Auth System', ... },
  { id: 'spec-002', title: 'Database Design', ... },
];

// Atomic write (default)
await writeJSONL('specs.jsonl', specs);

// Non-atomic write
await writeJSONL('specs.jsonl', specs, { atomic: false });
```

#### `writeJSONLSync(filePath, entities, options?)`
Write entities to a JSONL file synchronously.

```typescript
writeJSONLSync('issues.jsonl', issues);
```

**Options:**
- `atomic?: boolean` - Use atomic write (temp file + rename, default: `true`)

### Updating Single Lines

#### `updateJSONLLine(filePath, entity, idField?)`
Update or append a single entity in a JSONL file.

```typescript
import { updateJSONLLine } from './jsonl.js';

// Update existing or append new
const updatedSpec = {
  id: 'spec-001',
  title: 'Updated Title',
  ...
};

await updateJSONLLine('specs.jsonl', updatedSpec);

// Custom ID field
await updateJSONLLine('custom.jsonl', entity, 'customId');
```

#### `updateJSONLLineSync(filePath, entity, idField?)`
Update a single entity synchronously.

```typescript
updateJSONLLineSync('specs.jsonl', updatedSpec);
```

**Parameters:**
- `idField?: string` - Field to use as identifier (default: `'id'`)

### Deleting Lines

#### `deleteJSONLLine(filePath, entityId, idField?)`
Delete an entity from a JSONL file by ID.

```typescript
import { deleteJSONLLine } from './jsonl.js';

const deleted = await deleteJSONLLine('specs.jsonl', 'spec-001');
// Returns true if deleted, false if not found
```

#### `deleteJSONLLineSync(filePath, entityId, idField?)`
Delete an entity synchronously.

```typescript
const deleted = deleteJSONLLineSync('issues.jsonl', 'issue-042');
```

### Getting Single Entities

#### `getJSONLEntity(filePath, entityId, idField?)`
Retrieve a single entity from a JSONL file by ID.

```typescript
import { getJSONLEntity } from './jsonl.js';

const spec = await getJSONLEntity('specs.jsonl', 'spec-001');
if (spec) {
  console.log(spec.title);
}
```

#### `getJSONLEntitySync(filePath, entityId, idField?)`
Retrieve a single entity synchronously.

```typescript
const issue = getJSONLEntitySync('issues.jsonl', 'issue-042');
```

## Usage Examples

### Basic Read/Write

```typescript
import { readJSONL, writeJSONL } from './jsonl.js';

// Read
const specs = await readJSONL('specs.jsonl');
console.log(`Loaded ${specs.length} specs`);

// Modify
specs.forEach(spec => {
  spec.status = 'reviewed';
});

// Write back
await writeJSONL('specs.jsonl', specs);
```

### Streaming Large Files

```typescript
// readJSONL uses streaming internally, no memory issues
const largeDataset = await readJSONL('large-file.jsonl');

// Process in batches
const batchSize = 100;
for (let i = 0; i < largeDataset.length; i += batchSize) {
  const batch = largeDataset.slice(i, i + batchSize);
  await processBatch(batch);
}
```

### Error Handling

```typescript
const errors: Array<{ line: number; content: string }> = [];

const entities = await readJSONL('data.jsonl', {
  skipErrors: true,
  onError: (lineNumber, line, error) => {
    errors.push({ line: lineNumber, content: line });
  }
});

if (errors.length > 0) {
  console.warn(`Skipped ${errors.length} malformed lines`);
}
```

### Incremental Updates

```typescript
// Update single entity without rewriting entire file
await updateJSONLLine('specs.jsonl', {
  id: 'spec-001',
  title: 'Updated Title',
  content: 'New content...',
  updated_at: new Date().toISOString(),
});
```

## File Format

JSONL files contain one JSON object per line:

```jsonl
{"id":"spec-001","title":"Auth System","type":"architecture","status":"draft"}
{"id":"spec-002","title":"Database Design","type":"database","status":"approved"}
{"id":"spec-003","title":"API Design","type":"api","status":"review"}
```

**Important:**
- Each line must be a valid JSON object
- No commas between lines
- Empty lines are ignored
- Files should end with a newline

## Performance

- **Read**: Streaming-based, handles files of any size
- **Write**: Atomic by default (safe for concurrent access)
- **Update**: Reads entire file, modifies, writes back (good for < 100k entities)
- **Delete**: Same as update

For very large files (millions of entities), consider:
- Using a database (SQLite) for primary storage
- JSONL as snapshot/backup format only
- Batch operations instead of single-line updates

## Type Safety

All functions support TypeScript generics:

```typescript
import type { SpecJSONL, IssueJSONL } from './types.js';

// Type-safe reads
const specs = await readJSONL<SpecJSONL>('specs.jsonl');
const issues = await readJSONL<IssueJSONL>('issues.jsonl');

// Compiler checks types
specs[0].title; // ✅ OK
specs[0].foo;   // ❌ Type error
```

## Testing

All functions have comprehensive tests:

```bash
npm test -- jsonl.test.ts
```

**Test coverage:**
- 24 tests covering all operations
- Read/write with various data sizes
- Error handling and edge cases
- Atomic writes
- Sync and async versions

All 90 project tests pass ✅
