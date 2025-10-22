/**
 * Core entity types for sudocode
 */
export interface Spec {
    id: string;
    uuid: string;
    title: string;
    file_path: string;
    content: string;
    priority: number;
    created_at: string;
    updated_at: string;
    parent_id: string | null;
}
export interface Issue {
    id: string;
    uuid: string;
    title: string;
    description: string;
    content: string;
    status: IssueStatus;
    priority: number;
    assignee: string | null;
    created_at: string;
    updated_at: string;
    closed_at: string | null;
    parent_id: string | null;
}
export type IssueStatus = "open" | "in_progress" | "blocked" | "closed";
export interface Relationship {
    from_id: string;
    from_type: EntityType;
    to_id: string;
    to_type: EntityType;
    relationship_type: RelationshipType;
    created_at: string;
    metadata: string | null;
}
export type EntityType = "spec" | "issue";
export type RelationshipType = "blocks" | "related" | "parent-child" | "discovered-from" | "implements" | "references" | "depends-on";
export interface Tag {
    entity_id: string;
    entity_type: EntityType;
    tag: string;
}
export interface Event {
    id: number;
    entity_id: string;
    entity_type: EntityType;
    event_type: EventType;
    actor: string;
    old_value: string | null;
    new_value: string | null;
    comment: string | null;
    created_at: string;
    git_commit_sha: string | null;
    source?: string;
}
export type EventType = "created" | "updated" | "status_changed" | "relationship_added" | "relationship_removed" | "tag_added" | "tag_removed";
/**
 * Issue-based spec feedback types
 */
export interface IssueFeedback {
    id: string;
    issue_id: string;
    spec_id: string;
    feedback_type: FeedbackType;
    content: string;
    agent: string;
    anchor: string;
    status: FeedbackStatus;
    created_at: string;
    updated_at: string;
    resolution: string | null;
}
/**
 * Base location anchor for tracking positions in markdown documents
 */
export interface LocationAnchor {
    section_heading?: string;
    section_level?: number;
    line_number?: number;
    line_offset?: number;
    text_snippet?: string;
    context_before?: string;
    context_after?: string;
    content_hash?: string;
}
/**
 * Feedback anchor with additional tracking for changes over time
 */
export interface FeedbackAnchor extends LocationAnchor {
    anchor_status: "valid" | "relocated" | "stale";
    last_verified_at?: string;
    original_location?: {
        line_number: number;
        section_heading?: string;
    };
}
export type FeedbackType = "comment" | "suggestion" | "request";
export type FeedbackStatus = "open" | "acknowledged" | "resolved" | "wont_fix";
/**
 * JSONL format types
 */
export interface SpecJSONL extends Spec {
    relationships: RelationshipJSONL[];
    tags: string[];
}
export interface IssueJSONL extends Issue {
    relationships: RelationshipJSONL[];
    tags: string[];
    feedback?: FeedbackJSONL[];
}
export interface FeedbackJSONL {
    id: string;
    spec_id: string;
    type: FeedbackType;
    content: string;
    anchor: FeedbackAnchor;
    status: FeedbackStatus;
    created_at: string;
}
export interface RelationshipJSONL {
    from: string;
    from_type: EntityType;
    to: string;
    to_type: EntityType;
    type: RelationshipType;
}
/**
 * Config metadata file structure
 */
export interface ConfigMetadata {
    version: string;
    next_spec_id: number;
    next_issue_id: number;
    id_prefix: {
        spec: string;
        issue: string;
    };
    last_sync: string;
    collision_log: CollisionLogEntry[];
}
export interface CollisionLogEntry {
    old_id: string;
    new_id: string;
    reason: string;
    timestamp: string;
}
//# sourceMappingURL=index.d.ts.map