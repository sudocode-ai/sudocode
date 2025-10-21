# Sudograph CRUD Operations

This directory contains all database CRUD operations for sudograph.

## Modules

### `specs.ts` - Spec Operations
- **createSpec** - Create a new spec
- **getSpec** - Retrieve a spec by ID
- **updateSpec** - Update spec fields
- **deleteSpec** - Delete a spec
- **listSpecs** - List specs with filters (status, type, priority, etc.)
- **getReadySpecs** - Get specs with no blockers
- **searchSpecs** - Full-text search in title and content

### `issues.ts` - Issue Operations
- **createIssue** - Create a new issue
- **getIssue** - Retrieve an issue by ID
- **updateIssue** - Update issue fields
- **deleteIssue** - Delete an issue
- **closeIssue** - Close an issue (sets status to closed, records closed_at)
- **reopenIssue** - Reopen a closed issue
- **listIssues** - List issues with filters (status, type, priority, assignee, etc.)
- **getReadyIssues** - Get issues with no blockers
- **getBlockedIssues** - Get issues blocked by dependencies
- **searchIssues** - Full-text search in title, description, and content

### `relationships.ts` - Relationship Operations
- **addRelationship** - Create a relationship between entities
- **removeRelationship** - Remove a specific relationship
- **getOutgoingRelationships** - Get relationships where entity is the source
- **getIncomingRelationships** - Get relationships where entity is the target
- **getDependencies** - Get what this entity depends on (blockers)
- **getDependents** - Get what depends on this entity (things it blocks)
- **getAllRelationships** - Get both incoming and outgoing relationships
- **relationshipExists** - Check if a relationship exists
- **removeAllRelationships** - Remove all relationships for an entity

### `tags.ts` - Tag Operations
- **addTag** - Add a single tag to an entity
- **addTags** - Add multiple tags at once
- **removeTag** - Remove a specific tag
- **getTags** - Get all tags for an entity
- **getEntitiesByTag** - Find entities with a specific tag
- **removeAllTags** - Remove all tags from an entity
- **hasTag** - Check if an entity has a tag
- **getAllTags** - Get all unique tags in the system
- **setTags** - Replace all tags for an entity

### `events.ts` - Event Operations
- **insertEvent** - Record an event in the audit trail
- **getEvent** - Get an event by ID
- **queryEvents** - Query events with filters
- **getEntityEvents** - Get all events for a specific entity
- **getRecentEvents** - Get recent events across all entities
- **getEventsByActor** - Get events by a specific actor
- **deleteEntityEvents** - Delete all events for an entity

### `transactions.ts` - Transaction Support
- **transaction** - Execute a function in a transaction with auto commit/rollback
- **batchTransaction** - Execute multiple operations in a single transaction
- **withRetry** - Execute with automatic retry on busy/locked errors
- **SavepointTransaction** - Nested transaction support using savepoints

## Usage Examples

### Creating and Linking Entities

```typescript
import { initDatabase } from '../db.js';
import { createSpec, createIssue, addRelationship, addTags } from './index.js';

const db = initDatabase({ path: '.sudocode/cache.db' });

// Create a spec
const spec = createSpec(db, {
  id: 'spec-001',
  title: 'Authentication System',
  file_path: '.sudocode/specs/auth.md',
  content: '# Auth System\n\nOAuth 2.0 implementation',
  type: 'architecture',
  status: 'draft',
  priority: 1,
  created_by: 'alice',
});

// Create an issue that implements the spec
const issue = createIssue(db, {
  id: 'issue-001',
  title: 'Implement OAuth endpoints',
  description: 'Add OAuth 2.0 endpoints',
  status: 'open',
  priority: 1,
  issue_type: 'task',
  assignee: 'agent-backend',
  created_by: 'alice',
});

// Link them
addRelationship(db, {
  from_id: 'issue-001',
  from_type: 'issue',
  to_id: 'spec-001',
  to_type: 'spec',
  relationship_type: 'implements',
  created_by: 'alice',
});

// Add tags
addTags(db, 'issue-001', 'issue', ['auth', 'backend', 'security']);
```

### Using Transactions

```typescript
import { transaction } from './transactions.js';
import { createIssue, addRelationship, insertEvent } from './index.js';

transaction(db, () => {
  // All operations succeed or fail together
  const issue = createIssue(db, { ... });

  addRelationship(db, { ... });

  insertEvent(db, {
    entity_id: issue.id,
    entity_type: 'issue',
    event_type: 'created',
    actor: 'alice',
    new_value: JSON.stringify(issue),
  });
});
```

### Querying Ready Work

```typescript
import { getReadyIssues, getDependencies } from './index.js';

// Get all issues ready to work on (no blockers)
const ready = getReadyIssues(db);

console.log(`Found ${ready.length} issues ready to work on:`);
for (const issue of ready) {
  console.log(`- ${issue.id}: ${issue.title}`);
}

// Check what blocks a specific issue
const blockers = getDependencies(db, 'issue-001', 'issue');
if (blockers.length > 0) {
  console.log(`Issue blocked by ${blockers.length} dependencies`);
}
```

## Error Handling

All CRUD operations throw errors on constraint violations:

```typescript
try {
  createIssue(db, {
    id: 'issue-001',
    title: 'Duplicate ID',
    created_by: 'alice',
  });
} catch (error) {
  if (error.message.includes('Constraint violation')) {
    console.error('Issue ID already exists');
  }
}
```

## Testing

All operations have comprehensive unit tests:

```bash
npm test
```

Test files:
- `specs.test.ts` - 16 tests for spec operations
- `issues.test.ts` - 15 tests for issue operations
- `relationships.test.ts` - 11 tests for relationship operations
- `tags.test.ts` - 15 tests for tag operations
- `transactions.test.ts` - 9 tests for transaction support

Total: 66 tests, all passing ✅
