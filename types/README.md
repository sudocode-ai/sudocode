# @sudocode/types

TypeScript type definitions for [sudocode](https://github.com/sudocode-ai/sudocode) - Git-native spec and issue management for AI-assisted software development.

## Overview

This package provides shared TypeScript types used across all sudocode packages. It includes type definitions for specs, issues, relationships, feedback, events, and JSONL interchange formats.

## Installation

```bash
npm install @sudocode/types
```

## Core Types

### Entities

#### `Spec`
Specification document type.

```typescript
interface Spec {
  id: string;                    // Human-readable ID (e.g., "SPEC-1")
  uuid: string;                  // Unique UUID
  title: string;                 // Spec title
  file_path: string;             // Path to markdown file
  content: string;               // Markdown content
  priority: number;              // Priority (0-4)
  created_at: string;            // ISO timestamp
  updated_at: string;            // ISO timestamp
  parent_id: string | null;      // Parent spec ID
}
```

#### `Issue`
Issue/task type.

```typescript
interface Issue {
  id: string;                    // Human-readable ID (e.g., "ISSUE-1")
  uuid: string;                  // Unique UUID
  title: string;                 // Issue title
  description: string;           // Short description
  content: string;               // Full markdown content
  status: IssueStatus;           // Current status
  priority: number;              // Priority (0-4)
  assignee: string | null;       // Assigned user
  created_at: string;            // ISO timestamp
  updated_at: string;            // ISO timestamp
  closed_at: string | null;      // Close timestamp
  parent_id: string | null;      // Parent issue ID
}

type IssueStatus =
  | "open"
  | "in_progress"
  | "blocked"
  | "needs_review"
  | "closed";
```

### Relationships

#### `Relationship`
Links between specs and issues.

```typescript
interface Relationship {
  from_id: string;               // Source entity ID
  from_type: EntityType;         // Source type
  to_id: string;                 // Target entity ID
  to_type: EntityType;           // Target type
  relationship_type: RelationshipType;
  created_at: string;            // ISO timestamp
  metadata: string | null;       // JSON metadata
}

type EntityType = "spec" | "issue";

type RelationshipType =
  | "blocks"                     // From blocks To
  | "related"                    // General relation
  | "discovered-from"            // Issue from spec feedback
  | "implements"                 // Issue implements spec
  | "references"                 // From references To
  | "depends-on";                // From depends on To
```

### Feedback System

#### `IssueFeedback`
Issue-based feedback on specs with line anchoring.

```typescript
interface IssueFeedback {
  id: string;                    // Feedback ID
  issue_id: string;              // Associated issue
  spec_id: string;               // Target spec
  feedback_type: FeedbackType;   // Type of feedback
  content: string;               // Feedback text
  agent: string;                 // Actor name
  anchor: string;                // JSON-serialized FeedbackAnchor
  dismissed: boolean;            // Whether dismissed
  created_at: string;            // ISO timestamp
  updated_at: string;            // ISO timestamp
}

type FeedbackType = "comment" | "suggestion" | "request";
```

#### `FeedbackAnchor`
Smart anchor for tracking locations in markdown documents.

```typescript
interface FeedbackAnchor extends LocationAnchor {
  anchor_status: "valid" | "relocated" | "stale";
  last_verified_at?: string;
  original_location?: {
    line_number: number;
    section_heading?: string;
  };
}

interface LocationAnchor {
  section_heading?: string;      // Markdown section heading
  section_level?: number;        // Heading level (1-6)
  line_number?: number;          // Line number
  line_offset?: number;          // Offset within section
  text_snippet?: string;         // Text for fuzzy matching
  context_before?: string;       // Lines before anchor
  context_after?: string;        // Lines after anchor
  content_hash?: string;         // Hash for change detection
}
```

### Events & History

#### `Event`
Audit trail for entity changes.

```typescript
interface Event {
  id: number;                    // Auto-increment ID
  entity_id: string;             // Entity affected
  entity_type: EntityType;       // Type of entity
  event_type: EventType;         // Type of event
  actor: string;                 // Who made the change
  old_value: string | null;      // Previous value (JSON)
  new_value: string | null;      // New value (JSON)
  comment: string | null;        // Optional comment
  created_at: string;            // ISO timestamp
  git_commit_sha: string | null; // Associated git commit
  source?: string;               // Event source
}

type EventType =
  | "created"
  | "updated"
  | "status_changed"
  | "relationship_added"
  | "relationship_removed"
  | "tag_added"
  | "tag_removed";
```

### Tags

#### `Tag`
Flexible tagging for specs and issues.

```typescript
interface Tag {
  entity_id: string;             // Tagged entity
  entity_type: EntityType;       // Entity type
  tag: string;                   // Tag name
}
```

## JSONL Interchange Formats

These types are used for git-native storage in `.sudocode/*.jsonl` files.

#### `SpecJSONL`
Spec with embedded relationships and tags.

```typescript
interface SpecJSONL extends Spec {
  relationships: RelationshipJSONL[];
  tags: string[];
}
```

#### `IssueJSONL`
Issue with embedded relationships, tags, and feedback.

```typescript
interface IssueJSONL extends Issue {
  relationships: RelationshipJSONL[];
  tags: string[];
  feedback?: FeedbackJSONL[];
}
```

#### `FeedbackJSONL`
Embedded feedback format.

```typescript
interface FeedbackJSONL {
  id: string;
  spec_id: string;
  type: FeedbackType;
  content: string;
  anchor: FeedbackAnchor;
  dismissed: boolean;
  created_at: string;
}
```

#### `RelationshipJSONL`
Embedded relationship format.

```typescript
interface RelationshipJSONL {
  from: string;
  from_type: EntityType;
  to: string;
  to_type: EntityType;
  type: RelationshipType;
}
```

### Configuration

#### `Config`

Metadata stored in `.sudocode/meta.json`.

```typescript
interface Config {
  version: string;               // Schema version
  id_prefix: {
    spec: string;                // Spec prefix (e.g., "SPEC")
    issue: string;               // Issue prefix (e.g., "ISSUE")
  };
}

```