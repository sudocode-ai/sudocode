# Storage Layer Architecture

This document defines the storage layer for sudocode, inspired by the beads project's dual-storage pattern: human-editable files (Markdown) + machine-optimized cache (SQLite) with JSONL as the git-committed source of truth.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     User Interaction                         │
│  (CLI commands, text editor, git operations)                 │
└────────────┬─────────────────────────────┬──────────────────┘
             │                             │
             ▼                             ▼
   ┌──────────────────┐          ┌──────────────────┐
   │  Markdown Files  │          │   JSONL Files    │
   │  .sudocode/specs/│          │.sudocode/specs/  │
   │  .sudocode/issues│          │.sudocode/issues/ │
   │                  │          │                  │
   │  ✓ Git-tracked   │          │  ✓ Git-tracked   │
   │  ✓ Human-editable│          │  ✓ Source of     │
   │  ✓ Text diffs    │          │    truth         │
   └─────────┬────────┘          └────────┬─────────┘
             │                            │
             │     ┌──────────────────────┘
             │     │
             ▼     ▼
      ┌──────────────────┐
      │   SQLite Cache   │
      │ .sudocode/       │
      │   cache.db   │
      │                  │
      │  ✗ Gitignored    │
      │  ✓ Fast queries  │
      │  ✓ Relationships │
      └──────────────────┘
```

## Design Principles

1. **JSONL = Source of Truth**: Git-tracked, append-friendly, readable snapshots
2. **Markdown = Human Interface**: Primary editing surface, synced to JSONL
3. **SQLite = Query Cache**: Fast local operations, rebuilt from JSONL after git pull
4. **Auto-Sync**: Changes flow bidirectionally with debouncing
5. **Offline-First**: All operations work without network
6. **Git-Friendly**: Avoid binary files in commits, use text-based formats

---

## Storage Hierarchy

```
.sudocode/
├── specs/
│   ├── auth-system.md          # Markdown files (git-tracked)
│   ├── database-design.md
│   └── specs.jsonl             # JSONL snapshot (git-tracked)
├── issues/
│   ├── issue-001.md            # Markdown files (git-tracked)
│   ├── issue-002.md
│   └── issues.jsonl            # JSONL snapshot (git-tracked)
├── meta.json                   # ID counters, config (git-tracked)
├── cache.db                # SQLite cache (gitignored)
└── .gitignore                  # Ignore *.db
```

---

## SQLite Schema

### Core Tables

#### 1. Specs Table

```sql
CREATE TABLE specs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL CHECK(length(title) <= 500),
    file_path TEXT NOT NULL,               -- Relative path to markdown file
    content TEXT NOT NULL DEFAULT '',      -- Markdown content (no frontmatter)
    type TEXT NOT NULL DEFAULT 'feature',  -- architecture|api|database|feature|research
    status TEXT NOT NULL DEFAULT 'draft',  -- draft|review|approved|deprecated
    priority INTEGER NOT NULL DEFAULT 2 CHECK(priority >= 0 AND priority <= 4),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    parent_id TEXT,                         -- Optional parent spec
    FOREIGN KEY (parent_id) REFERENCES specs(id) ON DELETE SET NULL
);

CREATE INDEX idx_specs_status ON specs(status);
CREATE INDEX idx_specs_type ON specs(type);
CREATE INDEX idx_specs_priority ON specs(priority);
CREATE INDEX idx_specs_parent ON specs(parent_id);
CREATE INDEX idx_specs_created_at ON specs(created_at);
CREATE INDEX idx_specs_updated_at ON specs(updated_at);
```

#### 2. Issues Table

```sql
CREATE TABLE issues (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL CHECK(length(title) <= 500),
    description TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',      -- Full markdown content (no frontmatter)
    status TEXT NOT NULL DEFAULT 'open',   -- open|in_progress|blocked|needs_review|closed
    priority INTEGER NOT NULL DEFAULT 2 CHECK(priority >= 0 AND priority <= 4),
    issue_type TEXT NOT NULL DEFAULT 'task', -- bug|feature|task|epic|chore
    assignee TEXT,
    estimated_minutes INTEGER,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at DATETIME,
    created_by TEXT NOT NULL,
    parent_id TEXT,                         -- Optional parent issue
    FOREIGN KEY (parent_id) REFERENCES issues(id) ON DELETE SET NULL
);

CREATE INDEX idx_issues_status ON issues(status);
CREATE INDEX idx_issues_priority ON issues(priority);
CREATE INDEX idx_issues_type ON issues(issue_type);
CREATE INDEX idx_issues_assignee ON issues(assignee);
CREATE INDEX idx_issues_parent ON issues(parent_id);
CREATE INDEX idx_issues_created_at ON issues(created_at);
CREATE INDEX idx_issues_updated_at ON issues(updated_at);
CREATE INDEX idx_issues_closed_at ON issues(closed_at);
```

#### 3. Relationships Table (Polymorphic)

Captures edges between any entities (spec→spec, issue→issue, spec→issue).

```sql
CREATE TABLE relationships (
    from_id TEXT NOT NULL,
    from_type TEXT NOT NULL,               -- spec|issue
    to_id TEXT NOT NULL,
    to_type TEXT NOT NULL,                 -- spec|issue
    relationship_type TEXT NOT NULL,       -- blocks|related|parent-child|discovered-from|implements
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT NOT NULL,
    metadata TEXT,                          -- Optional JSON metadata
    PRIMARY KEY (from_id, from_type, to_id, to_type, relationship_type)
);

CREATE INDEX idx_rel_from ON relationships(from_id, from_type);
CREATE INDEX idx_rel_to ON relationships(to_id, to_type);
CREATE INDEX idx_rel_type ON relationships(relationship_type);
CREATE INDEX idx_rel_created_at ON relationships(created_at);
```

**Note**: We use a polymorphic relationship table instead of separate tables for spec_deps and issue_deps. This allows:
- Flexible linking (e.g., issue implements spec)
- Unified graph queries
- Easier extension to future entity types

#### 4. Tags Table (Shared)

```sql
CREATE TABLE tags (
    entity_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,             -- spec|issue
    tag TEXT NOT NULL,
    PRIMARY KEY (entity_id, entity_type, tag)
);

CREATE INDEX idx_tags_entity ON tags(entity_id, entity_type);
CREATE INDEX idx_tags_tag ON tags(tag);
```

#### 5. Events Table (Audit Trail)

```sql
CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,             -- spec|issue
    event_type TEXT NOT NULL,              -- created|updated|status_changed|relationship_added|etc
    actor TEXT NOT NULL,
    old_value TEXT,                         -- JSON snapshot before change
    new_value TEXT,                         -- JSON snapshot after change
    comment TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    git_commit_sha TEXT                    -- Optional: git commit that caused this change
);

CREATE INDEX idx_events_entity ON events(entity_id, entity_type);
CREATE INDEX idx_events_type ON events(event_type);
CREATE INDEX idx_events_actor ON events(actor);
CREATE INDEX idx_events_created_at ON events(created_at);
CREATE INDEX idx_events_git_commit ON events(git_commit_sha);
```

**Event Population Strategy:**

The events table is populated through three mechanisms:

1. **Real-time (Immediate)**: When CLI commands execute, events are inserted in the same transaction
   ```typescript
   async function updateIssue(id: string, updates: Record<string, any>): Promise<void> {
       const tx = await db.beginTransaction();
       try {
           const oldState = await db.getIssue(tx, id);
           await db.updateIssueInTx(tx, id, updates);
           await db.insertEventInTx(tx, {
               entityId: id,
               entityType: 'issue',
               eventType: 'updated',
               actor: getCurrentUser(),
               oldValue: JSON.stringify(oldState),
               newValue: JSON.stringify(updates),
               createdAt: new Date(),
           });
           await tx.commit();
       } catch (error) {
           await tx.rollback();
           throw error;
       }
   }
   ```

2. **Short History (Default)**: On import from JSONL, reconstruct recent events by diffing
   - Compare incoming JSONL state vs existing SQLite state
   - Generate synthetic events for detected changes
   - Limited to changes since last sync (typically recent work)
   ```typescript
   function reconstructShortHistory(newEntries: Entity[], oldEntries: Entity[]): Event[] {
       const events: Event[] = [];
       for (const newEntity of newEntries) {
           const old = findInOld(oldEntries, newEntity.id);
           if (!old) {
               events.push({ type: 'created', .../* entity fields */ });
           } else if (hasChanges(old, newEntity)) {
               events.push({
                   type: 'updated',
                   oldValue: JSON.stringify(old),
                   newValue: JSON.stringify(newEntity),
                   actor: newEntity.updatedBy,
                   createdAt: newEntity.updatedAt,
               });
           }
       }
       return events;
   }
   ```

3. **Full History from Git (TODO - Future Enhancement)**: Parse git commit history of JSONL files
   - **Use case**: Multi-environment collaborative workflows need complete audit trail
   - **Approach**: Walk git log, diff JSONL files across commits, reconstruct full timeline
   - **Implementation considerations**:
     ```typescript
     // Future: sg history rebuild --from-git
     async function rebuildHistoryFromGit(): Promise<void> {
         // 1. Walk git log for .jsonl file changes
         const commits = await git.log(['--follow', '--', '.sudocode/specs/specs.jsonl']);

         // 2. For each commit, diff JSONL lines
         for (const commit of commits) {
             const oldLines = await git.show([`${commit.parent}:specs.jsonl`]);
             const newLines = await git.show([`${commit.sha}:specs.jsonl`]);
             const changes = diffJSONL(oldLines, newLines);

             // 3. Generate events from diff
             for (const change of changes) {
                 await db.insertEvent({
                     entityId: change.id,
                     entityType: change.entityType,
                     eventType: change.type,
                     actor: commit.author,
                     oldValue: change.before,
                     newValue: change.after,
                     createdAt: commit.timestamp,
                     gitCommitSha: commit.sha,
                     source: 'git-reconstructed',
                 });
             }
         }
     }
     ```
   - **Challenges to solve later**:
     - Performance: Large repos with thousands of commits
     - Attribution: Git author ≠ actual change actor (multiple devs, agents)
     - Merge commits: How to attribute changes in merge conflicts?
     - Squashed/rebased history: May lose granular timeline
     - Initial import: One-time operation vs incremental updates

**Trade-offs:**

- **Real-time events**: Precise, but only for local changes
- **Short history**: Fast, good enough for "what changed recently?"
- **Full git history**: Complete audit trail, but complex and potentially slow

**Recommended workflow:**

1. Start with real-time + short history reconstruction (phases 1-4)
2. Add git history reconstruction later when collaboration patterns emerge
3. Make it opt-in: `sg history rebuild --from-git --since 2025-01-01`

### Views for Common Queries

#### Ready Work Views

**Ready Specs** - Specs with no blocking dependencies:

```sql
CREATE VIEW ready_specs AS
SELECT s.*
FROM specs s
WHERE s.status IN ('draft', 'review')
  AND NOT EXISTS (
    SELECT 1 FROM relationships r
    JOIN specs blocker ON r.to_id = blocker.id AND r.to_type = 'spec'
    WHERE r.from_id = s.id
      AND r.from_type = 'spec'
      AND r.relationship_type = 'blocks'
      AND blocker.status IN ('draft', 'review')
  );
```

**Ready Issues** - Issues with no blocking dependencies:

```sql
CREATE VIEW ready_issues AS
SELECT i.*
FROM issues i
WHERE i.status = 'open'
  AND NOT EXISTS (
    SELECT 1 FROM relationships r
    JOIN issues blocker ON r.to_id = blocker.id AND r.to_type = 'issue'
    WHERE r.from_id = i.id
      AND r.from_type = 'issue'
      AND r.relationship_type = 'blocks'
      AND blocker.status IN ('open', 'in_progress', 'blocked')
  );
```

#### Blocked Issues View

```sql
CREATE VIEW blocked_issues AS
SELECT
    i.*,
    COUNT(r.to_id) as blocked_by_count,
    GROUP_CONCAT(r.to_id) as blocked_by_ids
FROM issues i
JOIN relationships r ON i.id = r.from_id AND r.from_type = 'issue'
JOIN issues blocker ON r.to_id = blocker.id AND r.to_type = 'issue'
WHERE i.status IN ('open', 'in_progress', 'blocked')
  AND r.relationship_type = 'blocks'
  AND blocker.status IN ('open', 'in_progress', 'blocked')
GROUP BY i.id;
```

### Database Configuration

```sql
-- Enable WAL mode for better concurrency
PRAGMA journal_mode=WAL;

-- Enforce foreign keys
PRAGMA foreign_keys=ON;

-- Optimize for performance
PRAGMA synchronous=NORMAL;
PRAGMA temp_store=MEMORY;
PRAGMA mmap_size=30000000000;
PRAGMA page_size=4096;
PRAGMA cache_size=10000;
```

---

## JSONL Format

### Specs JSONL (`.sudocode/specs/specs.jsonl`)

One spec per line, complete snapshot:

```json
{"id":"spec-001","title":"Auth System","file_path":".sudocode/specs/auth-system.md","content":"# Auth System\n\n...","type":"architecture","status":"draft","priority":1,"created_at":"2025-10-16T10:00:00Z","updated_at":"2025-10-16T15:00:00Z","created_by":"alice","updated_by":"alice","parent_id":"spec-000","relationships":[{"from":"spec-001","to":"spec-002","type":"blocks"}],"tags":["auth","security"]}
```

**Fields**:
- Core fields from `specs` table
- `relationships`: Array of outgoing relationships
- `tags`: Array of tag strings
- `parent_id`: Optional parent spec ID

### Issues JSONL (`.sudocode/issues/issues.jsonl`)

One issue per line:

```json
{"id":"issue-001","title":"Implement OAuth endpoint","description":"Create REST endpoint...","content":"# Details\n\n...","status":"open","priority":1,"issue_type":"task","assignee":"agent-backend","estimated_minutes":120,"created_at":"2025-10-16T10:00:00Z","updated_at":"2025-10-16T15:00:00Z","closed_at":null,"created_by":"agent-planner","parent_id":null,"relationships":[{"from":"issue-001","to":"spec-001","type":"implements"},{"from":"issue-001","to":"issue-002","type":"blocks"}],"tags":["auth","backend"]}
```

**Fields**:
- Core fields from `issues` table
- `relationships`: Array of outgoing relationships
- `tags`: Array of tag strings
- `spec_refs`: Extracted from content (computed, not stored)

---

## Sync Mechanisms

### Three-Way Sync Flow

```
Markdown File <──┐
                 │
                 ├──> JSONL File <──> SQLite DB
                 │
User Edit ───────┘
```

### Sync Operations

#### 1. Markdown → JSONL → SQLite (User edits markdown)

**Trigger**: File watcher detects `.md` file change

**Process**:
1. Parse markdown file (frontmatter + content)
2. Extract ID from frontmatter
3. Load existing JSONL entry (if exists)
4. Merge changes (preserve relationships if not in frontmatter)
5. Update JSONL line (replace existing or append)
6. Update SQLite row
7. Insert event record

**Implementation**:
```typescript
async function syncMarkdownToJSONL(mdPath: string): Promise<void> {
    // Parse markdown
    const spec = parseMarkdownFile(mdPath);

    // Load existing JSONL entry
    const existing = await loadFromJSONL(spec.id);

    // Merge relationships (preserve if not explicit in frontmatter)
    spec.relationships = mergeRelationships(existing, spec);

    // Update JSONL
    await updateJSONLLine(spec);

    // Update SQLite
    await db.updateSpec(spec);
    await db.insertEvent({
        entityType: 'spec',
        entityId: spec.id,
        eventType: 'updated',
        actor: getCurrentUser(),
    });
}
```

#### 2. SQLite → JSONL → Markdown (CLI updates)

**Trigger**: `sg` CLI command modifies database

**Process**:
1. Update SQLite row
2. Insert event record
3. Queue export operation (debounced, 5 seconds)
4. On export: Read from SQLite, write to JSONL
5. Optionally update markdown frontmatter (user config)

**Implementation**:
```typescript
const exportQueue = newDebouncer(5000); // 5 seconds

async function updateIssue(id: string, updates: Record<string, any>): Promise<void> {
    // Update SQLite
    await db.updateIssue(id, updates);
    await db.insertEvent({
        entityType: 'issue',
        entityId: id,
        eventType: 'updated',
        actor: getCurrentUser(),
    });

    // Queue export (debounced)
    exportQueue.trigger(async () => {
        await exportToJSONL();
        if (config.syncMarkdownFrontmatter) {
            await syncFrontmatterFromDB(id);
        }
    });
}
```

#### 3. JSONL → SQLite (After git pull)

**Trigger**: User runs `sg sync` or automatic after git operations

**Process**:
1. Detect JSONL file changes (compare mtime or hash)
2. Load all JSONL entries
3. Compare with SQLite (detect additions, updates, deletions)
4. Apply changes with collision resolution
5. Optionally update markdown files

**Implementation**:
```typescript
async function importFromJSONL(path: string): Promise<void> {
    // Read JSONL
    const entries = await readJSONL(path);

    // Load existing SQLite state
    const existing = await db.loadAll();

    // Diff and resolve collisions
    let changes = detectChanges(entries, existing);
    const collisions = detectCollisions(changes);

    if (collisions.length > 0) {
        const resolved = resolveCollisions(collisions);
        changes = applyResolutions(changes, resolved);
    }

    // Apply changes
    const tx = await db.beginTransaction();
    try {
        for (const change of changes) {
            switch (change.type) {
                case 'add':
                    await db.insert(tx, change.entity);
                    break;
                case 'update':
                    await db.update(tx, change.entity);
                    break;
                case 'delete':
                    await db.delete(tx, change.entity);
                    break;
            }
        }
        await tx.commit();
    } catch (error) {
        await tx.rollback();
        throw error;
    }
}
```

### Collision Resolution Strategy

When importing JSONL after git merge, collisions may occur:

1. **ID Collision**: Same ID, different content
   - Score by reference count (count mentions in other entities)
   - Renumber entity with fewer references
   - Update all text references using regex `\b{old-id}\b`
   - Update relationship records
   - Log mapping: `{old-id} → {new-id}`

2. **Concurrent Updates**: Both sides updated same entity
   - Timestamp-based: newest wins
   - Or: Mark as conflict, require manual resolution

3. **Reference Breaks**: Referenced ID doesn't exist
   - Create placeholder entity (status: `missing`)
   - Or: Remove dangling reference

---

## File Watching

### Auto-Sync on File Changes

**Options**:
1. **chokidar library** (Node.js): Watch `.sudocode/` directory for changes
2. **Polling**: Check file mtimes every 5 seconds
3. **Git hooks**: Sync on pre-commit and post-merge

**Recommended**: chokidar + debouncing

```typescript
import chokidar from 'chokidar';

const watcher = chokidar.watch(['.sudocode/specs', '.sudocode/issues'], {
    persistent: true,
    ignoreInitial: true,
});

const debouncer = newDebouncer(2000); // 2 seconds

watcher.on('change', (path) => {
    debouncer.trigger(async () => {
        await syncFile(path);
    });
});

watcher.on('add', (path) => {
    debouncer.trigger(async () => {
        await syncFile(path);
    });
});
```

---

## Export/Import CLI Commands

### sg export

```bash
# Export SQLite → JSONL
sg export                  # Export specs + issues to respective JSONL files
sg export --specs          # Export only specs
sg export --issues         # Export only issues
sg export --output backup/ # Export to custom directory
```

### sg import

```bash
# Import JSONL → SQLite
sg import                        # Import from .sudocode/specs.jsonl & issues.jsonl
sg import --input backup/        # Import from custom directory
sg import --resolve-collisions   # Auto-resolve ID collisions
sg import --dry-run              # Show changes without applying
```

### sg sync

```bash
# Bi-directional sync
sg sync                    # Detect changes, sync all directions
sg sync --watch            # Start file watcher, continuous sync
sg sync --from-git         # Import after git pull
```

---

## Metadata File (`.sudocode/meta.json`)

Stores ID counters and configuration:

```json
{
  "version": "1.0",
  "next_spec_id": 43,
  "next_issue_id": 157,
  "id_prefix": {
    "spec": "spec-",
    "issue": "issue-"
  },
  "last_sync": "2025-10-16T15:30:00Z",
  "collision_log": [
    {"old_id": "issue-042", "new_id": "issue-158", "reason": "merge_conflict", "timestamp": "2025-10-16T15:00:00Z"}
  ]
}
```

---

## Performance Considerations

### Database Size

**Expected Scale**:
- 1000 specs → ~1MB JSONL, 5MB SQLite
- 10000 issues → ~10MB JSONL, 50MB SQLite
- 50000 relationships → ~5MB JSONL, 25MB SQLite

**Query Performance**:
- Ready work query: <10ms (indexed)
- Dependency tree (depth 5): <50ms
- Full-text search: <100ms (with FTS5)

### Sync Performance

**Markdown → JSONL**: <10ms per file (parse + write)
**JSONL → SQLite**: <1s for 10k entries (bulk insert)
**Collision Detection**: <100ms for 10k entries

### Debouncing

- File changes: 2-second debounce
- CLI exports: 5-second debounce
- Batch operations: No debounce (immediate export)

---

## Implementation Checklist

### Phase 1: Core Storage
- [ ] Define SQLite schema (specs, issues, relationships, tags, events)
- [ ] Create migration system (embed schema in binary)
- [ ] Implement CRUD operations for specs and issues
- [ ] Add indexes and views

### Phase 2: JSONL Sync
- [ ] JSONL reader/writer
- [ ] Export: SQLite → JSONL
- [ ] Import: JSONL → SQLite
- [ ] Collision detection and resolution

### Phase 3: Markdown Sync
- [ ] Markdown parser (frontmatter + content)
- [ ] Markdown writer (update frontmatter)
- [ ] Markdown → JSONL sync
- [ ] JSONL → Markdown sync

### Phase 4: Auto-Sync
- [ ] File watcher (fsnotify)
- [ ] Debouncing mechanism
- [ ] Git hooks (pre-commit, post-merge)
- [ ] `sg sync` command with watch mode

### Phase 5: Optimization

- [ ] Batch operations
- [ ] Transaction management
- [ ] Query optimization
- [ ] Full-text search (FTS5)

### Phase 6: Event History Reconstruction (Future)

- [ ] Implement short history reconstruction (JSONL diff on import)
- [ ] Design git history parser (walk commits, diff JSONL files)
- [ ] Handle attribution challenges (git author vs actual actor)
- [ ] Optimize for large repos (incremental parsing, caching)
- [ ] Add `sg history rebuild --from-git` command
- [ ] Support filtering by date range and entity type
- [ ] Document performance characteristics and limitations

---

## Next Steps

1. Validate this storage design with the team
2. Create proof-of-concept: SQLite schema + basic CRUD
3. Implement JSONL export/import
4. Add markdown sync
5. Build auto-sync with file watching
6. Add event reconstruction from JSONL diffs (short history)
7. Defer git history reconstruction until multi-environment collaboration patterns emerge
