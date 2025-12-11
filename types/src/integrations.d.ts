/**
 * Integration types for sudocode
 * Enables sync with external systems like Jira, Beads, SpecKit, and OpenSpec
 */

import type {
  SyncDirection,
  ConflictResolution,
  IntegrationProviderName,
} from "./index.js";

// =============================================================================
// Base Configuration Types
// =============================================================================

/**
 * Base configuration interface for all integration providers
 */
export interface IntegrationConfig {
  /** Whether this integration is enabled */
  enabled: boolean;
  /** Whether to automatically sync changes */
  auto_sync: boolean;
  /** Default sync direction for new links */
  default_sync_direction: SyncDirection;
  /** How to resolve sync conflicts */
  conflict_resolution: ConflictResolution;
}

// =============================================================================
// Provider-Specific Configurations
// =============================================================================

// TODO: Move these to their own package later
/**
 * Configuration for Jira integration
 */
export interface JiraConfig extends IntegrationConfig {
  /** Jira instance URL (e.g., "https://company.atlassian.net") */
  instance_url: string;
  /** Authentication type */
  auth_type: "basic" | "oauth2";
  /** Environment variable name containing credentials (optional) */
  credentials_env?: string;
  /** JQL filter for issues to sync (optional) */
  jql_filter?: string;
  /** Jira project key (optional, for scoping) */
  project_key?: string;
  /** Map Jira statuses to sudocode statuses (optional) */
  status_mapping?: Record<string, string>;
}

/**
 * Configuration for Beads integration
 * Beads is a local file-based issue tracker
 */
export interface BeadsConfig extends IntegrationConfig {
  /** Path to beads directory (relative to project root) */
  path: string;
  /** Prefix for issue IDs when importing (optional) */
  issue_prefix?: string;
}

/**
 * Configuration for SpecKit integration
 * SpecKit is a specification management tool
 */
export interface SpecKitConfig extends IntegrationConfig {
  /** Path to spec-kit directory */
  path: string;
  /** Whether to import specs from SpecKit */
  import_specs: boolean;
  /** Whether to import plans from SpecKit */
  import_plans: boolean;
  /** Whether to import tasks from SpecKit as issues */
  import_tasks: boolean;
}

/**
 * Configuration for OpenSpec integration
 * OpenSpec is an open specification format
 */
export interface OpenSpecConfig extends IntegrationConfig {
  /** Path to openspec directory */
  path: string;
  /** Whether to import specs from OpenSpec */
  import_specs: boolean;
  /** Whether to import changes/changelog from OpenSpec */
  import_changes: boolean;
}

/**
 * Top-level integrations configuration object
 * Maps provider names to their configurations
 */
export interface IntegrationsConfig {
  jira?: JiraConfig;
  beads?: BeadsConfig;
  "spec-kit"?: SpecKitConfig;
  openspec?: OpenSpecConfig;
}

// =============================================================================
// Sync Types
// =============================================================================

/**
 * Represents an entity from an external system
 * Normalized structure for cross-provider compatibility
 */
export interface ExternalEntity {
  /** Unique identifier in the external system */
  id: string;
  /** Entity type (maps to sudocode spec or issue) */
  type: "spec" | "issue";
  /** Entity title */
  title: string;
  /** Entity description/content (optional) */
  description?: string;
  /** Status in external system (optional) */
  status?: string;
  /** Priority level (optional, 0-4 scale like sudocode) */
  priority?: number;
  /** URL to view in external system (optional) */
  url?: string;
  /** When created in external system (optional, ISO 8601) */
  created_at?: string;
  /** When last updated in external system (optional, ISO 8601) */
  updated_at?: string;
  /** Raw data from external system (for provider-specific handling) */
  raw?: unknown;
}

/**
 * Represents a change detected in an external system
 * Used for incremental sync operations
 */
export interface ExternalChange {
  /** Entity ID that changed */
  entity_id: string;
  /** Type of entity that changed */
  entity_type: "spec" | "issue";
  /** Type of change */
  change_type: "created" | "updated" | "deleted";
  /** When the change occurred (ISO 8601) */
  timestamp: string;
  /** The entity data (present for created/updated, absent for deleted) */
  data?: ExternalEntity;
}

/**
 * Result of a sync operation for a single entity
 */
export interface SyncResult {
  /** Whether the sync operation succeeded */
  success: boolean;
  /** Sudocode entity ID */
  entity_id: string;
  /** External system entity ID */
  external_id: string;
  /** What action was taken */
  action: "created" | "updated" | "skipped" | "conflict";
  /** Error message if sync failed (optional) */
  error?: string;
}

/**
 * Represents a sync conflict between sudocode and external system
 * Requires resolution based on configured strategy
 */
export interface SyncConflict {
  /** Sudocode entity ID */
  sudocode_entity_id: string;
  /** External system entity ID */
  external_id: string;
  /** Integration provider name */
  provider: IntegrationProviderName;
  /** When sudocode entity was last updated (ISO 8601) */
  sudocode_updated_at: string;
  /** When external entity was last updated (ISO 8601) */
  external_updated_at: string;
}
