# Sudograph Database Schema

This directory contains the SQLite schema implementation for sudograph.

## Files

- **`types.ts`** - TypeScript interfaces for all entities (Spec, Issue, Relationship, Tag, Event)
- **`schema.ts`** - SQL schema definitions for tables, indexes, and views
- **`db.ts`** - Database initialization and connection management
- **`index.ts`** - Main entry point that exports all public APIs
- **`test-schema.ts`** - Test script to verify schema initialization

## Schema Overview

### Core Tables

1. **`specs`** - Specification documents
   - Fields: id, title, file_path, content, type, status, priority, timestamps, created_by, updated_by, parent_id
   - Types: architecture, api, database, feature, research
   - Statuses: draft, review, approved, deprecated

2. **`issues`** - Work items (bugs, features, tasks, epics, chores)
   - Fields: id, title, description, content, status, priority, issue_type, assignee, estimated_minutes, timestamps, parent_id
   - Statuses: open, in_progress, blocked, closed

3. **`relationships`** - Polymorphic relationships between entities
   - Links specs and issues with typed relationships
   - Types: blocks, related, parent-child, discovered-from, implements

4. **`tags`** - Labels for specs and issues
   - Polymorphic tagging system

5. **`events`** - Audit trail of all changes
   - Tracks: created, updated, status_changed, relationship changes, tag changes
   - Supports git commit attribution

### Views

1. **`ready_specs`** - Specs with no blocking dependencies
2. **`ready_issues`** - Issues with no blocking dependencies
3. **`blocked_issues`** - Issues blocked by other issues (with blocker counts)

### Database Configuration

- **WAL mode** enabled for better concurrency
- **Foreign keys** enforced
- **Optimized** for read/write performance

## Usage

### Initialize Database

```typescript
import { initDatabase } from './db.js';

const db = initDatabase({
  path: '.sudocode/cache.db',
  verbose: false
});
```

### Run Tests

```bash
npm run test:schema
```

This will:
- Build TypeScript files
- Create an in-memory database
- Verify all tables, indexes, and views are created
- Check database configuration
