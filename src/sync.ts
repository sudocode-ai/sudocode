/**
 * Bidirectional sync between Markdown files and JSONL/SQLite
 */

import * as fs from "fs";
import * as path from "path";
import type Database from "better-sqlite3";
import {
  parseMarkdownFile,
  updateFrontmatterFile,
  writeMarkdownFile,
} from "./markdown.js";
import {
  getSpec,
  getSpecByFilePath,
  createSpec,
  updateSpec,
} from "./operations/specs.js";
import { getIssue, createIssue, updateIssue } from "./operations/issues.js";
import { addRelationship } from "./operations/relationships.js";
import { getTags, setTags } from "./operations/tags.js";
import { listFeedback, updateFeedback } from "./operations/feedback.js";
import { relocateFeedbackAnchor } from "./operations/feedback-anchors.js";
import { exportToJSONL } from "./export.js";
import { generateSpecId, generateIssueId } from "./id-generator.js";
import type {
  Spec,
  Issue,
  SpecStatus,
  SpecType,
  IssueStatus,
  IssueType,
} from "./types.js";

export interface SyncResult {
  success: boolean;
  action: "created" | "updated" | "no-change";
  entityId: string;
  entityType: "spec" | "issue";
  error?: string;
}

export interface SyncOptions {
  /**
   * Directory for JSONL output (default: .sudocode)
   */
  outputDir?: string;
  /**
   * Whether to auto-export to JSONL after sync (default: true)
   */
  autoExport?: boolean;
  /**
   * User performing the sync
   */
  user?: string;
  /**
   * Auto-initialize missing frontmatter fields (default: true)
   * If true, generates missing IDs and provides default values
   * If false, rejects files with missing required fields
   */
  autoInitialize?: boolean;
  /**
   * Whether to write back initialized frontmatter to the file (default: true)
   * Only applies when autoInitialize is true
   */
  writeBackFrontmatter?: boolean;
}

/**
 * Initialize missing frontmatter fields
 */
function initializeFrontmatter(
  data: Record<string, any>,
  entityType: "spec" | "issue",
  mdPath: string,
  outputDir: string,
  user: string
): Record<string, any> {
  const now = new Date().toISOString();
  const initialized = { ...data };

  // Generate ID if missing
  if (!initialized.id) {
    initialized.id =
      entityType === "spec"
        ? generateSpecId(outputDir)
        : generateIssueId(outputDir);
  }

  // Extract title from content if missing
  if (!initialized.title) {
    const content = fs.readFileSync(mdPath, "utf8");
    const titleMatch = content.match(/^#\s+(.+)$/m);
    initialized.title = titleMatch
      ? titleMatch[1]
      : path.basename(mdPath, ".md");
  }

  // Set timestamps
  if (!initialized.created_at) {
    initialized.created_at = now;
  }
  if (!initialized.updated_at) {
    initialized.updated_at = now;
  }

  // Set user
  if (!initialized.created_by) {
    initialized.created_by = user;
  }
  if (!initialized.updated_by && entityType === "spec") {
    initialized.updated_by = user;
  }

  // Set entity type
  initialized.entity_type = entityType;

  // Set type-specific defaults
  if (entityType === "spec") {
    if (!initialized.type) initialized.type = "feature";
    if (!initialized.status) initialized.status = "draft";
    if (!initialized.priority && initialized.priority !== 0)
      initialized.priority = 2;
    if (!initialized.file_path) {
      // Try to make path relative to outputDir
      const relPath = path.relative(outputDir, mdPath);
      initialized.file_path = relPath.startsWith("..")
        ? path.relative(process.cwd(), mdPath)
        : relPath;
    }
  } else {
    // issue
    if (!initialized.issue_type) initialized.issue_type = "task";
    if (!initialized.status) initialized.status = "open";
    if (!initialized.priority && initialized.priority !== 0)
      initialized.priority = 2;
    if (!initialized.description) initialized.description = "";
  }

  return initialized;
}

/**
 * Sync a markdown file to JSONL and SQLite
 * Parses markdown, updates database, optionally exports to JSONL
 */
export async function syncMarkdownToJSONL(
  db: Database.Database,
  mdPath: string,
  options: SyncOptions = {}
): Promise<SyncResult> {
  const {
    outputDir = ".sudocode",
    autoExport = true,
    user = "system",
    autoInitialize = true,
    writeBackFrontmatter = true,
  } = options;

  try {
    // Parse markdown file
    const parsed = parseMarkdownFile(mdPath);
    let { data, content, references } = parsed;

    // Determine entity type from frontmatter or file path
    const entityType = determineEntityType(data, mdPath);
    let entityId = data.id as string | undefined;
    const frontmatterId = entityId; // Keep track of ID from frontmatter for validation

    // Calculate relative file path from outputDir
    const relPath = path.relative(outputDir, mdPath);
    const filePath = relPath.startsWith("..")
      ? path.relative(process.cwd(), mdPath)
      : relPath;

    // For specs, ALWAYS check if a spec already exists with this file path
    // File path is the authoritative unique identifier for specs
    // This prevents duplicates and handles ID conflicts gracefully
    let existingByPath: any = null;
    if (entityType === "spec") {
      // Always set the calculated file path in data (for create/update)
      data.file_path = filePath;

      existingByPath = getSpecByFilePath(db, filePath);
      if (existingByPath) {
        // Use the existing spec's ID, ignoring any ID in frontmatter
        const correctId = existingByPath.id;

        // Warn if user changed the ID in frontmatter
        if (frontmatterId && frontmatterId !== correctId) {
          console.warn(
            `[sync] Warning: ID in frontmatter (${frontmatterId}) differs from existing spec ID (${correctId}) for ${filePath}. Using existing ID.`
          );
        }

        entityId = correctId;
        data.id = entityId;
      }
    }

    // Handle missing frontmatter
    if (!entityId) {
      if (autoInitialize) {
        // Auto-initialize missing fields
        data = initializeFrontmatter(data, entityType, mdPath, outputDir, user);
        entityId = data.id as string;

        // Write back frontmatter if requested
        if (writeBackFrontmatter) {
          updateFrontmatterFile(mdPath, data);
        }
      } else {
        return {
          success: false,
          action: "no-change",
          entityId: "",
          entityType,
          error: "Missing id in frontmatter (auto-initialization disabled)",
        };
      }
    }

    // Check if entity exists by ID
    const existing =
      entityType === "spec" ? getSpec(db, entityId) : getIssue(db, entityId);

    const isNew = !existing;

    if (entityType === "spec") {
      await syncSpec(db, entityId, data, content, references, isNew, user);
    } else {
      await syncIssue(db, entityId, data, content, references, isNew, user);
    }

    // Auto-export to JSONL if enabled
    if (autoExport) {
      await exportToJSONL(db, {
        outputDir,
      });
    }

    return {
      success: true,
      action: isNew ? "created" : "updated",
      entityId,
      entityType,
    };
  } catch (error) {
    return {
      success: false,
      action: "no-change",
      entityId: "",
      entityType: "spec",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Sync from JSONL/SQLite to markdown file
 * Updates markdown frontmatter while preserving content
 */
export async function syncJSONLToMarkdown(
  db: Database.Database,
  entityId: string,
  entityType: "spec" | "issue",
  mdPath: string
): Promise<SyncResult> {
  try {
    // Get entity from database
    const entity =
      entityType === "spec" ? getSpec(db, entityId) : getIssue(db, entityId);

    if (!entity) {
      return {
        success: false,
        action: "no-change",
        entityId,
        entityType,
        error: `${entityType} not found: ${entityId}`,
      };
    }

    // Get relationships and tags
    const { getOutgoingRelationships } = await import(
      "./operations/relationships.js"
    );
    const relationships = getOutgoingRelationships(db, entityId, entityType);
    const tags = getTags(db, entityId, entityType);

    // Build frontmatter
    const frontmatter = entityToFrontmatter(
      entity,
      entityType,
      relationships,
      tags
    );

    // Check if file exists
    const fileExists = fs.existsSync(mdPath);

    if (fileExists) {
      // Update existing file's frontmatter only
      updateFrontmatterFile(mdPath, frontmatter);
    } else {
      // Create new file with content from database
      const content = entity.content || "";
      writeMarkdownFile(mdPath, frontmatter, content);
    }

    return {
      success: true,
      action: fileExists ? "updated" : "created",
      entityId,
      entityType,
    };
  } catch (error) {
    return {
      success: false,
      action: "no-change",
      entityId,
      entityType,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Determine entity type from frontmatter or file path
 */
function determineEntityType(
  frontmatter: Record<string, any>,
  filePath: string
): "spec" | "issue" {
  // Check frontmatter type field
  if (frontmatter.entity_type === "issue" || frontmatter.issue_type) {
    return "issue";
  }
  if (frontmatter.entity_type === "spec" || frontmatter.type) {
    return "spec";
  }

  // Check file path
  if (filePath.includes("/issues/") || filePath.includes("/issue-")) {
    return "issue";
  }
  if (filePath.includes("/specs/") || filePath.includes("/spec-")) {
    return "spec";
  }

  // Default to spec
  return "spec";
}

/**
 * Sync spec data to database
 */
async function syncSpec(
  db: Database.Database,
  id: string,
  frontmatter: Record<string, any>,
  content: string,
  references: Array<{ id: string; type: "spec" | "issue" }>,
  isNew: boolean,
  user: string
): Promise<void> {
  // Get old content before updating (for anchor relocation)
  const oldSpec = isNew ? null : getSpec(db, id);
  const oldContent = oldSpec?.content || "";

  const specData: Partial<Spec> = {
    id,
    title: frontmatter.title || "Untitled",
    file_path: frontmatter.file_path || "",
    content,
    type: (frontmatter.type as SpecType) || "feature",
    status: (frontmatter.status as SpecStatus) || "draft",
    priority: frontmatter.priority ?? 2,
    parent_id: frontmatter.parent_id || null,
  };

  if (isNew) {
    createSpec(db, {
      ...specData,
      created_by: user,
    } as any);
  } else {
    updateSpec(db, id, {
      ...specData,
      updated_by: user,
    });

    // Relocate feedback anchors if content changed
    if (oldContent !== content) {
      const feedbackList = listFeedback(db, { spec_id: id });

      if (feedbackList.length > 0) {
        // Relocate each feedback anchor
        for (const feedback of feedbackList) {
          const oldAnchor =
            typeof feedback.anchor === "string"
              ? JSON.parse(feedback.anchor)
              : feedback.anchor;

          // Relocate the anchor
          const newAnchor = relocateFeedbackAnchor(
            oldContent,
            content,
            oldAnchor
          );

          // Update feedback with new anchor
          updateFeedback(db, feedback.id, {
            anchor: newAnchor,
          });
        }
      }
    }
  }

  // Sync tags
  if (frontmatter.tags && Array.isArray(frontmatter.tags)) {
    setTags(db, id, "spec", frontmatter.tags);
  }

  // Sync relationships from cross-references
  await syncRelationships(
    db,
    id,
    "spec",
    references,
    frontmatter.relationships,
    user
  );
}

/**
 * Sync issue data to database
 */
async function syncIssue(
  db: Database.Database,
  id: string,
  frontmatter: Record<string, any>,
  content: string,
  references: Array<{ id: string; type: "spec" | "issue" }>,
  isNew: boolean,
  user: string
): Promise<void> {
  const issueData: Partial<Issue> = {
    id,
    title: frontmatter.title || "Untitled",
    description: frontmatter.description || "",
    content,
    status: (frontmatter.status as IssueStatus) || "open",
    priority: frontmatter.priority ?? 2,
    issue_type: (frontmatter.issue_type as IssueType) || "task",
    assignee: frontmatter.assignee || null,
    estimated_minutes: frontmatter.estimated_minutes || null,
    parent_id: frontmatter.parent_id || null,
  };

  if (isNew) {
    createIssue(db, {
      ...issueData,
      created_by: user,
    } as any);
  } else {
    updateIssue(db, id, {
      ...issueData,
    });
  }

  // Sync tags
  if (frontmatter.tags && Array.isArray(frontmatter.tags)) {
    setTags(db, id, "issue", frontmatter.tags);
  }

  // Sync relationships from cross-references
  await syncRelationships(
    db,
    id,
    "issue",
    references,
    frontmatter.relationships,
    user
  );
}

/**
 * Sync relationships from cross-references and frontmatter
 * Preserves existing relationships not in frontmatter
 */
async function syncRelationships(
  db: Database.Database,
  entityId: string,
  entityType: "spec" | "issue",
  references: Array<{ id: string; type: "spec" | "issue" }>,
  frontmatterRels?: Array<{
    target_id: string;
    target_type: string;
    relationship_type: string;
  }>,
  user: string = "system"
): Promise<void> {
  // Get existing relationships (all outgoing)
  const { getOutgoingRelationships } = await import(
    "./operations/relationships.js"
  );
  const existing = getOutgoingRelationships(db, entityId, entityType);
  const existingSet = new Set(
    existing.map((r) => `${r.relationship_type}:${r.to_type}:${r.to_id}`)
  );

  // Add relationships from cross-references (as 'references' type)
  for (const ref of references) {
    const key = `references:${ref.type}:${ref.id}`;
    if (!existingSet.has(key)) {
      try {
        addRelationship(db, {
          from_id: entityId,
          from_type: entityType,
          to_id: ref.id,
          to_type: ref.type,
          relationship_type: "references",
          created_by: user,
        });
      } catch (error) {
        // Ignore errors (e.g., target not found, duplicate)
      }
    }
  }

  // Add relationships from frontmatter
  if (frontmatterRels && Array.isArray(frontmatterRels)) {
    for (const rel of frontmatterRels) {
      const key = `${rel.relationship_type}:${rel.target_type}:${rel.target_id}`;
      if (!existingSet.has(key)) {
        try {
          addRelationship(db, {
            from_id: entityId,
            from_type: entityType,
            to_id: rel.target_id,
            to_type: rel.target_type as "spec" | "issue",
            relationship_type: rel.relationship_type as any,
            created_by: user,
          });
        } catch (error) {
          // Ignore errors
        }
      }
    }
  }

  // Note: We preserve existing relationships not in frontmatter
  // This allows relationships added via CLI/UI to persist
}

/**
 * Convert entity to frontmatter object
 */
function entityToFrontmatter(
  entity: Spec | Issue,
  entityType: "spec" | "issue",
  relationships: Array<any>,
  tags: string[]
): Record<string, any> {
  const base: Record<string, any> = {
    id: entity.id,
    title: entity.title,
    status: entity.status,
    priority: entity.priority,
    created_at: entity.created_at,
  };

  // Only add optional fields if they have values
  if (entity.parent_id) base.parent_id = entity.parent_id;
  if (tags.length > 0) base.tags = tags;
  if (relationships.length > 0) base.relationships = relationships;

  if (entityType === "spec") {
    const spec = entity as Spec;
    const result: Record<string, any> = {
      ...base,
      type: spec.type,
    };
    return result;
  } else {
    const issue = entity as Issue;
    const result: Record<string, any> = {
      ...base,
      description: issue.description,
      issue_type: issue.issue_type,
    };

    // Only add optional issue fields if they have values
    if (issue.assignee) result.assignee = issue.assignee;
    if (issue.estimated_minutes !== null)
      result.estimated_minutes = issue.estimated_minutes;
    if (issue.closed_at) result.closed_at = issue.closed_at;

    return result;
  }
}
