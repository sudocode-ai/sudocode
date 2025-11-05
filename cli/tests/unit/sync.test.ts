/**
 * Unit tests for markdown ↔ JSONL sync
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { initDatabase } from "../../src/db.js";
import { createSpec, getSpec } from "../../src/operations/specs.js";
import { createIssue, getIssue } from "../../src/operations/issues.js";
import {
  addRelationship,
  getOutgoingRelationships,
} from "../../src/operations/relationships.js";
import { addTag, getTags } from "../../src/operations/tags.js";
import { syncMarkdownToJSONL, syncJSONLToMarkdown } from "../../src/sync.js";
import { parseMarkdownFile } from "../../src/markdown.js";
import { generateSpecId, generateIssueId } from "../../src/id-generator.js";
import type Database from "better-sqlite3";

const TEST_DIR = path.join(process.cwd(), "test-sync");

describe("Markdown ↔ JSONL Sync", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase({ path: ":memory:" });

    // Create test directory
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    db.close();

    // Clean up test directory
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe("syncMarkdownToJSONL", () => {
    it("should create new spec from markdown", async () => {
      const mdPath = path.join(TEST_DIR, "spec-001.md");
      const mdContent = `---
id: spec-001
title: New Spec
type: feature
status: draft
priority: 2
file_path: specs/spec-001.md
tags:
  - test
  - sync
---

# Content

This is the spec content.`;

      fs.writeFileSync(mdPath, mdContent, "utf8");

      const result = await syncMarkdownToJSONL(db, mdPath, {
        autoExport: false,
        user: "alice",
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe("created");
      expect(result.entityId).toBe("spec-001");
      expect(result.entityType).toBe("spec");

      // Verify in database
      const spec = getSpec(db, "spec-001");
      expect(spec).not.toBeNull();
      expect(spec?.title).toBe("New Spec");
      expect(spec?.content).toContain("# Content");

      // Verify tags
      const tags = getTags(db, "spec-001", "spec");
      expect(tags).toContain("test");
      expect(tags).toContain("sync");
    });

    it("should update existing spec from markdown", async () => {
      // Create existing spec
      createSpec(db, {
        id: "spec-001",
        title: "Original Title",
        file_path: "spec.md",
      });

      const mdPath = path.join(TEST_DIR, "spec-001.md");
      const mdContent = `---
id: spec-001
title: Updated Title
type: feature
status: approved
priority: 3
file_path: specs/spec-001.md
---

Updated content.`;

      fs.writeFileSync(mdPath, mdContent, "utf8");

      const result = await syncMarkdownToJSONL(db, mdPath, {
        autoExport: false,
        user: "alice",
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe("updated");

      // Verify update
      const spec = getSpec(db, "spec-001");
      expect(spec?.title).toBe("Updated Title");
      expect(spec?.priority).toBe(3);
      expect(spec?.content).toContain("Updated content");
    });

    it("should create new issue from markdown", async () => {
      const mdPath = path.join(TEST_DIR, "issue-001.md");
      const mdContent = `---
id: issue-001
title: New Issue
description: Issue description
issue_type: bug
status: open
priority: 1
assignee: alice
tags:
  - bug
  - urgent
---

# Issue Details

This is urgent.`;

      fs.writeFileSync(mdPath, mdContent, "utf8");

      const result = await syncMarkdownToJSONL(db, mdPath, {
        autoExport: false,
        user: "bob",
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe("created");
      expect(result.entityType).toBe("issue");

      // Verify in database
      const issue = getIssue(db, "issue-001");
      expect(issue).not.toBeNull();
      expect(issue?.title).toBe("New Issue");
      expect(issue?.assignee).toBe("alice");
      expect(issue?.content).toContain("# Issue Details");
    });

    it("should sync cross-references as relationships", async () => {
      // Create referenced entities first using hash IDs
      const { id: specId, uuid: specUuid } = generateSpecId(db, TEST_DIR);
      createSpec(db, {
        id: specId,
        uuid: specUuid,
        title: "Referenced Spec",
        file_path: "ref.md",
      });

      const { id: issueId, uuid: issueUuid } = generateIssueId(db, TEST_DIR);
      createIssue(db, {
        id: issueId,
        uuid: issueUuid,
        title: "Referenced Issue",
        content: "",
      });

      const { id: mainSpecId, uuid: mainSpecUuid } = generateSpecId(
        db,
        TEST_DIR
      );
      const mdPath = path.join(TEST_DIR, "spec-with-refs.md");
      const mdContent = `---
id: ${mainSpecId}
uuid: ${mainSpecUuid}
title: Spec with References
type: feature
status: draft
priority: 2
file_path: spec.md
---

See [[${specId}]] for details.
Related to [[@${issueId}]].`;

      fs.writeFileSync(mdPath, mdContent, "utf8");

      const result = await syncMarkdownToJSONL(db, mdPath, {
        autoExport: false,
      });

      expect(result.success).toBe(true);

      // Verify relationships were created (as references type by default)
      const deps = getOutgoingRelationships(db, mainSpecId, "spec");
      expect(deps.length).toBeGreaterThan(0);

      const hasSpecRef = deps.some(
        (d) => d.to_id === specId && d.relationship_type === "references"
      );
      const hasIssueRef = deps.some(
        (d) => d.to_id === issueId && d.relationship_type === "references"
      );

      expect(hasSpecRef).toBe(true);
      expect(hasIssueRef).toBe(true);
    });

    it("should store anchor information in relationship metadata", async () => {
      // Create referenced entity using hash ID
      const { id: refSpecId, uuid: refSpecUuid } = generateSpecId(db, TEST_DIR);
      createSpec(db, {
        id: refSpecId,
        uuid: refSpecUuid,
        title: "Referenced Spec",
        file_path: "ref.md",
      });

      const { id: mainSpecId, uuid: mainSpecUuid } = generateSpecId(
        db,
        TEST_DIR
      );
      const mdPath = path.join(TEST_DIR, "spec-with-anchor.md");
      const mdContent = `---
id: ${mainSpecId}
uuid: ${mainSpecUuid}
title: Spec with Anchored Reference
type: feature
status: draft
priority: 2
file_path: spec.md
---

# Implementation Details

This section describes the implementation.

See [[${refSpecId}]] for additional context.`;

      fs.writeFileSync(mdPath, mdContent, "utf8");

      const result = await syncMarkdownToJSONL(db, mdPath, {
        autoExport: false,
      });

      expect(result.success).toBe(true);

      // Get the relationship
      const deps = getOutgoingRelationships(db, mainSpecId, "spec");
      const specRel = deps.find(
        (d) => d.to_id === refSpecId && d.relationship_type === "references"
      );

      expect(specRel).toBeDefined();
      expect(specRel?.metadata).toBeDefined();

      // Parse and verify anchor metadata
      const metadata = JSON.parse(specRel!.metadata!);
      expect(metadata.anchor).toBeDefined();
      expect(metadata.anchor.section_heading).toBe("Implementation Details");
      expect(metadata.anchor.section_level).toBe(1);
      expect(metadata.anchor.line_number).toBeDefined();
      expect(metadata.anchor.text_snippet).toBeDefined();
      expect(metadata.anchor.content_hash).toBeDefined();
    });

    it("should store anchors for references with relationship types", async () => {
      // Create referenced entities using hash IDs
      const { id: depSpecId, uuid: depSpecUuid } = generateSpecId(db, TEST_DIR);
      createSpec(db, {
        id: depSpecId,
        uuid: depSpecUuid,
        title: "Dependency Spec",
        file_path: "dep.md",
      });

      const { id: mainSpecId, uuid: mainSpecUuid } = generateSpecId(
        db,
        TEST_DIR
      );
      const mdPath = path.join(TEST_DIR, "spec-with-typed-ref.md");
      const mdContent = `---
id: ${mainSpecId}
uuid: ${mainSpecUuid}
title: Spec with Typed Reference
type: feature
status: draft
priority: 2
file_path: spec.md
---

## Requirements

This implementation [[${depSpecId}|Dependency]]{ depends-on } must be completed first.`;

      fs.writeFileSync(mdPath, mdContent, "utf8");

      const result = await syncMarkdownToJSONL(db, mdPath, {
        autoExport: false,
      });

      expect(result.success).toBe(true);

      // Get the relationship
      const deps = getOutgoingRelationships(db, mainSpecId, "spec");
      const depRel = deps.find(
        (d) => d.to_id === depSpecId && d.relationship_type === "depends-on"
      );

      expect(depRel).toBeDefined();
      expect(depRel?.metadata).toBeDefined();

      // Verify anchor in metadata
      const metadata = JSON.parse(depRel!.metadata!);
      expect(metadata.anchor).toBeDefined();
      expect(metadata.anchor.section_heading).toBe("Requirements");
      expect(metadata.anchor.section_level).toBe(2);
      expect(metadata.anchor.text_snippet).toBeDefined();
      expect(metadata.anchor.text_snippet.length).toBeGreaterThan(0);
    });

    it("should handle missing id in frontmatter when autoInitialize is disabled", async () => {
      const mdPath = path.join(TEST_DIR, "no-id.md");
      const mdContent = `---
title: No ID
---

Content.`;

      fs.writeFileSync(mdPath, mdContent, "utf8");

      const result = await syncMarkdownToJSONL(db, mdPath, {
        autoExport: false,
        autoInitialize: false, // Explicitly disable auto-initialization
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Missing id");
    });

    it("should determine entity type from file path", async () => {
      const mdPath = path.join(TEST_DIR, "issues", "issue-001.md");
      fs.mkdirSync(path.dirname(mdPath), { recursive: true });

      const mdContent = `---
id: issue-001
title: Issue by Path
description: Detected from path
---

Content.`;

      fs.writeFileSync(mdPath, mdContent, "utf8");

      const result = await syncMarkdownToJSONL(db, mdPath, {
        autoExport: false,
      });

      expect(result.success).toBe(true);
      expect(result.entityType).toBe("issue");

      const issue = getIssue(db, "issue-001");
      expect(issue).not.toBeNull();
    });

    it("should handle ID conflict by preferring file path", async () => {
      // Create initial spec with file path
      const mdPath = path.join(TEST_DIR, "specs", "test-spec.md");
      fs.mkdirSync(path.dirname(mdPath), { recursive: true });

      const initialContent = `---
id: spec-001
title: Original Spec
type: feature
---

Original content.`;

      fs.writeFileSync(mdPath, initialContent, "utf8");

      // First sync - creates spec-001
      await syncMarkdownToJSONL(db, mdPath, {
        autoExport: false,
        outputDir: TEST_DIR,
      });

      const original = getSpec(db, "spec-001");
      expect(original).not.toBeNull();
      expect(original?.title).toBe("Original Spec");

      // User mistakenly changes the ID in frontmatter
      const conflictContent = `---
id: spec-999
title: Changed Title
type: feature
---

Modified content.`;

      fs.writeFileSync(mdPath, conflictContent, "utf8");

      // Second sync - should use existing ID (spec-001) based on file path
      const result = await syncMarkdownToJSONL(db, mdPath, {
        autoExport: false,
        outputDir: TEST_DIR,
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe("updated");
      expect(result.entityId).toBe("spec-001"); // Should use original ID

      // Verify spec-001 was updated (not spec-999 created)
      const updated = getSpec(db, "spec-001");
      expect(updated).not.toBeNull();
      expect(updated?.title).toBe("Changed Title");
      expect(updated?.content).toContain("Modified content");

      // Verify spec-999 was NOT created
      const wrongSpec = getSpec(db, "spec-999");
      expect(wrongSpec).toBeNull();
    });

    it("should prevent duplicate specs when ID changes", async () => {
      // Scenario: user creates spec, then changes ID thinking they're renaming it
      const mdPath = path.join(TEST_DIR, "specs", "feature-auth.md");
      fs.mkdirSync(path.dirname(mdPath), { recursive: true });

      // Initial creation
      const v1Content = `---
id: spec-100
title: Authentication Feature
type: feature
---

Initial auth spec.`;

      fs.writeFileSync(mdPath, v1Content, "utf8");
      await syncMarkdownToJSONL(db, mdPath, {
        autoExport: false,
        outputDir: TEST_DIR,
      });

      // User changes ID to "rename" it
      const v2Content = `---
id: spec-auth-v2
title: Authentication Feature v2
type: feature
---

Updated auth spec.`;

      fs.writeFileSync(mdPath, v2Content, "utf8");
      await syncMarkdownToJSONL(db, mdPath, {
        autoExport: false,
        outputDir: TEST_DIR,
      });

      // Should update spec-100, not create spec-auth-v2
      const original = getSpec(db, "spec-100");
      expect(original).not.toBeNull();
      expect(original?.title).toBe("Authentication Feature v2");

      const newId = getSpec(db, "spec-auth-v2");
      expect(newId).toBeNull();
    });

    it("should handle file rename by updating file_path", async () => {
      // User creates spec at original path
      const originalPath = path.join(TEST_DIR, "specs", "original-name.md");
      fs.mkdirSync(path.dirname(originalPath), { recursive: true });

      const originalContent = `---
id: spec-rename-001
title: Renameable Spec
type: feature
---

This spec will be renamed.`;

      fs.writeFileSync(originalPath, originalContent, "utf8");
      await syncMarkdownToJSONL(db, originalPath, {
        autoExport: false,
        outputDir: TEST_DIR,
      });

      // Verify spec created with original path
      let spec = getSpec(db, "spec-rename-001");
      expect(spec).not.toBeNull();
      expect(spec?.file_path).toBe("specs/original-name.md");

      // User renames file (keeping same ID in frontmatter)
      const newPath = path.join(TEST_DIR, "specs", "new-name.md");
      const renamedContent = `---
id: spec-rename-001
title: Renameable Spec
type: feature
---

This spec was renamed.`;

      fs.writeFileSync(newPath, renamedContent, "utf8");
      const result = await syncMarkdownToJSONL(db, newPath, {
        autoExport: false,
        outputDir: TEST_DIR,
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe("updated");
      expect(result.entityId).toBe("spec-rename-001");

      // Verify file_path was updated
      spec = getSpec(db, "spec-rename-001");
      expect(spec).not.toBeNull();
      expect(spec?.file_path).toBe("specs/new-name.md");
      expect(spec?.content).toContain("This spec was renamed");

      // Verify no duplicate was created
      const { listSpecs } = await import("../../src/operations/specs.js");
      const allSpecs = listSpecs(db, {});
      const renameSpecs = allSpecs.filter((s) => s.title === "Renameable Spec");
      expect(renameSpecs.length).toBe(1);
    });

    it("should warn about path conflict when renaming to occupied path", async () => {
      const specsDir = path.join(TEST_DIR, "specs");
      fs.mkdirSync(specsDir, { recursive: true });

      // Create first spec at path A
      const pathA = path.join(specsDir, "spec-a.md");
      fs.writeFileSync(
        pathA,
        `---
id: spec-a
title: Spec A
type: feature
---

Spec A content.`,
        "utf8"
      );
      await syncMarkdownToJSONL(db, pathA, {
        autoExport: false,
        outputDir: TEST_DIR,
      });

      // Create second spec at path B
      const pathB = path.join(specsDir, "spec-b.md");
      fs.writeFileSync(
        pathB,
        `---
id: spec-b
title: Spec B
type: feature
---

Spec B content.`,
        "utf8"
      );
      await syncMarkdownToJSONL(db, pathB, {
        autoExport: false,
        outputDir: TEST_DIR,
      });

      // User tries to rename spec-a to spec-b's path (with spec-a's ID)
      // This simulates: mv spec-a.md spec-b.md (which overwrites spec-b.md)
      const conflictContent = `---
id: spec-a
title: Spec A Renamed
type: feature
---

Spec A trying to take spec-b's path.`;

      fs.writeFileSync(pathB, conflictContent, "utf8");

      // Should still work but log warning
      const result = await syncMarkdownToJSONL(db, pathB, {
        autoExport: false,
        outputDir: TEST_DIR,
      });

      expect(result.success).toBe(true);
      expect(result.entityId).toBe("spec-a"); // Uses ID from frontmatter

      // Verify spec-a now has spec-b's path
      const specA = getSpec(db, "spec-a");
      expect(specA?.file_path).toBe("specs/spec-b.md");
      expect(specA?.title).toBe("Spec A Renamed");
    });
  });

  describe("syncJSONLToMarkdown", () => {
    it("should create markdown from spec", async () => {
      // Create spec in database
      createSpec(db, {
        id: "spec-001",
        title: "Test Spec",
        file_path: "spec.md",
        content: "# Spec content",
        priority: 2,
      });

      addTag(db, "spec-001", "spec", "test");
      addTag(db, "spec-001", "spec", "sync");

      const mdPath = path.join(TEST_DIR, "spec-001.md");

      const result = await syncJSONLToMarkdown(db, "spec-001", "spec", mdPath);

      if (!result.success) {
        console.log("Error:", result.error);
      }
      expect(result.success).toBe(true);
      expect(result.action).toBe("created");

      // Verify file exists
      expect(fs.existsSync(mdPath)).toBe(true);

      // Parse and verify
      const parsed = parseMarkdownFile(mdPath);
      expect(parsed.data.id).toBe("spec-001");
      expect(parsed.data.title).toBe("Test Spec");
      expect(parsed.data.tags).toContain("test");
      expect(parsed.content).toContain("# Spec content");
    });

    it("should update existing markdown frontmatter only", async () => {
      // Create spec in database
      createSpec(db, {
        id: "spec-001",
        title: "Updated Title",
        file_path: "spec.md",
        content: "Database content",
        priority: 3,
      });

      // Create existing markdown with different content
      const mdPath = path.join(TEST_DIR, "spec-001.md");
      const originalContent = `---
id: spec-001
title: Old Title
status: draft
priority: 2
---

# Original Content

This should be preserved.`;

      fs.writeFileSync(mdPath, originalContent, "utf8");

      const result = await syncJSONLToMarkdown(db, "spec-001", "spec", mdPath);

      expect(result.success).toBe(true);
      expect(result.action).toBe("updated");

      // Verify frontmatter updated but content preserved
      const parsed = parseMarkdownFile(mdPath);
      expect(parsed.data.title).toBe("Updated Title");
      expect(parsed.data.priority).toBe(3);
      expect(parsed.content).toContain("# Original Content");
      expect(parsed.content).toContain("This should be preserved");
      expect(parsed.content).not.toContain("Database content");
    });

    it("should exclude internal metadata fields from frontmatter", async () => {
      // Create spec with all fields including internal metadata
      createSpec(db, {
        id: "spec-001",
        title: "Test Spec",
        file_path: "specs/test.md",
        content: "# Content",
        priority: 2,
      });

      const mdPath = path.join(TEST_DIR, "spec-001.md");
      const result = await syncJSONLToMarkdown(db, "spec-001", "spec", mdPath);

      expect(result.success).toBe(true);

      // Read the generated markdown file
      const fileContent = fs.readFileSync(mdPath, "utf8");
      const parsed = parseMarkdownFile(mdPath);

      // These fields SHOULD be present (user-editable)
      expect(parsed.data.id).toBe("spec-001");
      expect(parsed.data.title).toBe("Test Spec");
      expect(parsed.data.priority).toBe(2);
      expect(parsed.data.created_at).toBeDefined();

      // These fields SHOULD NOT be present (internal metadata)
      expect(parsed.data.updated_by).toBeUndefined();
      expect(parsed.data.file_path).toBeUndefined();
      expect(parsed.data.entity_type).toBeUndefined();
      expect(parsed.data.created_by).toBeUndefined();
      expect(parsed.data.updated_at).toBeUndefined();

      // Double-check by searching raw file content
      expect(fileContent).not.toContain("updated_by");
      expect(fileContent).not.toContain("file_path");
      expect(fileContent).not.toContain("entity_type");
      expect(fileContent).not.toContain("created_by");
      // Note: created_at should be present, but updated_at should not
      expect(fileContent).toContain("created_at");
      expect(fileContent).not.toContain("updated_at");
    });

    it("should create markdown from issue", async () => {
      // Create issue in database
      createIssue(db, {
        id: "issue-001",
        title: "Test Issue",
        content: "# Issue details",
        status: "open",
        priority: 1,
        assignee: "bob",
      });

      const mdPath = path.join(TEST_DIR, "issue-001.md");

      const result = await syncJSONLToMarkdown(
        db,
        "issue-001",
        "issue",
        mdPath
      );

      expect(result.success).toBe(true);

      // Verify file
      const parsed = parseMarkdownFile(mdPath);
      expect(parsed.data.id).toBe("issue-001");
      expect(parsed.data.title).toBe("Test Issue");
      expect(parsed.data.assignee).toBe("bob");
      expect(parsed.content).toContain("# Issue details");
    });

    it("should include relationships in frontmatter", async () => {
      // Create entities
      createSpec(db, {
        id: "spec-001",
        title: "Main Spec",
        file_path: "main.md",
      });

      createSpec(db, {
        id: "spec-002",
        title: "Related Spec",
        file_path: "related.md",
      });

      // Add relationship
      addRelationship(db, {
        from_id: "spec-001",
        from_type: "spec",
        to_id: "spec-002",
        to_type: "spec",
        relationship_type: "depends-on",
      });

      const mdPath = path.join(TEST_DIR, "spec-001.md");

      await syncJSONLToMarkdown(db, "spec-001", "spec", mdPath);

      // Verify relationships in frontmatter
      const parsed = parseMarkdownFile(mdPath);
      expect(parsed.data.relationships).toBeDefined();
      expect(Array.isArray(parsed.data.relationships)).toBe(true);
      expect(parsed.data.relationships.length).toBeGreaterThan(0);
    });

    it("should handle non-existent entity", async () => {
      const mdPath = path.join(TEST_DIR, "missing.md");

      const result = await syncJSONLToMarkdown(db, "spec-999", "spec", mdPath);

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("bidirectional sync", () => {
    it("should preserve relationships added outside frontmatter", async () => {
      // Create entities
      createSpec(db, {
        id: "spec-001",
        title: "Main Spec",
        file_path: "main.md",
      });

      createSpec(db, {
        id: "spec-002",
        title: "Related Spec",
        file_path: "related.md",
      });

      // Add relationship via API (not in markdown)
      addRelationship(db, {
        from_id: "spec-001",
        from_type: "spec",
        to_id: "spec-002",
        to_type: "spec",
        relationship_type: "depends-on",
      });

      // Sync markdown that doesn't mention this relationship
      const mdPath = path.join(TEST_DIR, "spec-001.md");
      const mdContent = `---
id: spec-001
title: Updated Main Spec
type: feature
status: draft
priority: 2
file_path: main.md
---

Content without references.`;

      fs.writeFileSync(mdPath, mdContent, "utf8");

      await syncMarkdownToJSONL(db, mdPath, { autoExport: false });

      // Verify relationship still exists
      const deps = getOutgoingRelationships(db, "spec-001", "spec");
      const hasRel = deps.some(
        (d) => d.to_id === "spec-002" && d.relationship_type === "depends-on"
      );

      expect(hasRel).toBe(true);
    });

    it("should complete full round-trip sync without data loss", async () => {
      // 1. Start with markdown
      const mdPath = path.join(TEST_DIR, "spec-001.md");
      const originalContent = `---
id: spec-001
title: Round Trip Spec
type: feature
status: draft
priority: 2
file_path: spec.md
tags:
  - roundtrip
  - test
---

# Original Content

This content should survive the round trip.`;

      fs.writeFileSync(mdPath, originalContent, "utf8");

      // 2. Sync MD → JSONL → SQLite
      const result1 = await syncMarkdownToJSONL(db, mdPath, {
        autoExport: false,
      });
      expect(result1.success).toBe(true);

      // 3. Modify in database
      const spec = getSpec(db, "spec-001");
      expect(spec).not.toBeNull();

      // 4. Sync back SQLite → Markdown
      const result2 = await syncJSONLToMarkdown(db, "spec-001", "spec", mdPath);
      expect(result2.success).toBe(true);

      // 5. Verify content preserved, frontmatter intact
      const parsed = parseMarkdownFile(mdPath);
      expect(parsed.data.id).toBe("spec-001");
      expect(parsed.data.title).toBe("Round Trip Spec");
      expect(parsed.data.tags).toContain("roundtrip");
      expect(parsed.content).toContain("# Original Content");
      expect(parsed.content).toContain("This content should survive");
    });
  });
});
