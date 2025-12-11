/**
 * Comprehensive Round-Trip Tests
 *
 * These tests verify data consistency across all representations:
 * - Database (SQLite)
 * - JSONL files
 * - Markdown files
 *
 * Tests cover various flows:
 * - API → DB → JSONL → Markdown
 * - Markdown → DB → JSONL
 * - JSONL → DB → Markdown
 * - Relationship preservation across all operations
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Database operations (simulating API layer)
import { createSpec, getSpec, updateSpec, listSpecs } from "../../src/operations/specs.js";
import { createIssue, getIssue, updateIssue, listIssues } from "../../src/operations/issues.js";
import {
  addRelationship,
  getOutgoingRelationships,
  getIncomingRelationships,
} from "../../src/operations/relationships.js";
import { setTags, getTags } from "../../src/operations/tags.js";
import { initDatabase } from "../../src/db.js";

// JSONL operations
import { exportToJSONL } from "../../src/export.js";
import { importFromJSONL } from "../../src/import.js";
import { readJSONL } from "../../src/jsonl.js";

// Markdown/Sync operations
import { syncMarkdownToJSONL, syncJSONLToMarkdown } from "../../src/sync.js";
import { parseMarkdownFile, writeMarkdownFile } from "../../src/markdown.js";

// Types
import type { SpecJSONL, IssueJSONL } from "../../src/types.js";

describe("Round-Trip Data Consistency Tests", () => {
  let db: Database.Database;
  let testDir: string;
  let specsDir: string;
  let issuesDir: string;

  beforeEach(() => {
    // Create temp directory structure
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "roundtrip-test-"));
    specsDir = path.join(testDir, "specs");
    issuesDir = path.join(testDir, "issues");
    fs.mkdirSync(specsDir, { recursive: true });
    fs.mkdirSync(issuesDir, { recursive: true });

    // Initialize in-memory database
    db = initDatabase({ path: ":memory:" });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe("API → DB → JSONL → Markdown Flow", () => {
    it("should maintain spec consistency through full round trip", async () => {
      // Step 1: Create spec via "API" (direct DB operation)
      const spec = createSpec(db, {
        id: "s-test1",
        uuid: "uuid-test1",
        title: "Test Spec",
        file_path: "specs/test-spec.md",
        content: "# Test Spec\n\nThis is test content.",
        priority: 1,
      });

      // Add tags
      setTags(db, spec.id, "spec", ["api", "test", "documentation"]);

      // Verify DB state
      const dbSpec = getSpec(db, spec.id);
      expect(dbSpec).toBeTruthy();
      expect(dbSpec!.title).toBe("Test Spec");
      expect(dbSpec!.content).toBe("# Test Spec\n\nThis is test content.");
      expect(dbSpec!.priority).toBe(1);

      const dbTags = getTags(db, spec.id, "spec");
      expect(dbTags).toEqual(["api", "documentation", "test"]); // sorted

      // Step 2: Export to JSONL
      await exportToJSONL(db, { outputDir: testDir });

      // Verify JSONL content matches DB
      const jsonlSpecs = await readJSONL<SpecJSONL>(path.join(testDir, "specs.jsonl"));
      expect(jsonlSpecs).toHaveLength(1);
      expect(jsonlSpecs[0].id).toBe(spec.id);
      expect(jsonlSpecs[0].title).toBe(dbSpec!.title);
      expect(jsonlSpecs[0].content).toBe(dbSpec!.content);
      expect(jsonlSpecs[0].priority).toBe(dbSpec!.priority);
      expect(jsonlSpecs[0].tags).toEqual(dbTags);

      // Step 3: Sync to Markdown
      const mdPath = path.join(testDir, spec.file_path);
      await syncJSONLToMarkdown(db, spec.id, "spec", mdPath);

      // Verify Markdown content matches DB
      expect(fs.existsSync(mdPath)).toBe(true);
      const parsed = parseMarkdownFile(mdPath, db, testDir);
      expect(parsed.data.id).toBe(spec.id);
      expect(parsed.data.title).toBe(dbSpec!.title);
      expect(parsed.data.priority).toBe(dbSpec!.priority);
      expect(parsed.data.tags).toEqual(dbTags);
      expect(parsed.content.trim()).toBe(dbSpec!.content);
    });

    it("should maintain issue consistency through full round trip", async () => {
      // Step 1: Create issue via "API"
      const issue = createIssue(db, {
        id: "i-test1",
        uuid: "uuid-issue1",
        title: "Test Issue",
        content: "# Test Issue\n\nIssue description.",
        status: "open",
        priority: 2,
        assignee: "developer@example.com",
      });

      // Add tags
      setTags(db, issue.id, "issue", ["bug", "urgent"]);

      // Verify DB state
      const dbIssue = getIssue(db, issue.id);
      expect(dbIssue).toBeTruthy();
      expect(dbIssue!.title).toBe("Test Issue");
      expect(dbIssue!.status).toBe("open");
      expect(dbIssue!.assignee).toBe("developer@example.com");

      // Step 2: Export to JSONL
      await exportToJSONL(db, { outputDir: testDir });

      // Verify JSONL content matches DB
      const jsonlIssues = await readJSONL<IssueJSONL>(path.join(testDir, "issues.jsonl"));
      expect(jsonlIssues).toHaveLength(1);
      expect(jsonlIssues[0].id).toBe(issue.id);
      expect(jsonlIssues[0].title).toBe(dbIssue!.title);
      expect(jsonlIssues[0].status).toBe(dbIssue!.status);
      expect(jsonlIssues[0].assignee).toBe(dbIssue!.assignee);
      expect(jsonlIssues[0].tags).toEqual(["bug", "urgent"]);

      // Step 3: Sync to Markdown
      const mdPath = path.join(issuesDir, `${issue.id}.md`);
      await syncJSONLToMarkdown(db, issue.id, "issue", mdPath);

      // Verify Markdown content
      expect(fs.existsSync(mdPath)).toBe(true);
      const parsed = parseMarkdownFile(mdPath, db, testDir);
      expect(parsed.data.id).toBe(issue.id);
      expect(parsed.data.status).toBe("open");
    });

    it("should preserve spec updates through round trip", async () => {
      // Create initial spec
      createSpec(db, {
        id: "s-update1",
        uuid: "uuid-update1",
        title: "Original Title",
        file_path: "specs/update-test.md",
        content: "Original content",
        priority: 2,
      });

      // Export initial state
      await exportToJSONL(db, { outputDir: testDir });

      // Step 2: Update spec via "API"
      updateSpec(db, "s-update1", {
        title: "Updated Title",
        content: "Updated content with more details",
        priority: 1,
      });

      // Verify DB updated
      const dbSpec = getSpec(db, "s-update1");
      expect(dbSpec!.title).toBe("Updated Title");
      expect(dbSpec!.content).toBe("Updated content with more details");
      expect(dbSpec!.priority).toBe(1);

      // Step 3: Export updated state
      await exportToJSONL(db, { outputDir: testDir });

      // Verify JSONL reflects update
      const jsonlSpecs = await readJSONL<SpecJSONL>(path.join(testDir, "specs.jsonl"));
      const jsonlSpec = jsonlSpecs.find((s) => s.id === "s-update1");
      expect(jsonlSpec!.title).toBe("Updated Title");
      expect(jsonlSpec!.content).toBe("Updated content with more details");
      expect(jsonlSpec!.priority).toBe(1);

      // Step 4: Sync to Markdown
      const mdPath = path.join(testDir, "specs/update-test.md");
      await syncJSONLToMarkdown(db, "s-update1", "spec", mdPath);

      // Verify Markdown reflects update
      const parsed = parseMarkdownFile(mdPath, db, testDir);
      expect(parsed.data.title).toBe("Updated Title");
      expect(parsed.content.trim()).toBe("Updated content with more details");
    });
  });

  describe("Markdown → DB → JSONL Flow", () => {
    it("should sync new markdown spec to DB and JSONL", async () => {
      // Step 1: Create markdown file directly
      const mdPath = path.join(specsDir, "markdown-first.md");
      writeMarkdownFile(
        mdPath,
        {
          id: "s-md1",
          title: "Markdown First Spec",
          priority: 2,
          tags: ["markdown", "test"],
        },
        "# Markdown First\n\nContent from markdown file."
      );

      // Step 2: Sync markdown to DB
      const result = await syncMarkdownToJSONL(db, mdPath, {
        outputDir: testDir,
        autoExport: false, // Manual export for testing
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe("created");

      // Verify DB state
      const dbSpec = getSpec(db, "s-md1");
      expect(dbSpec).toBeTruthy();
      expect(dbSpec!.title).toBe("Markdown First Spec");
      expect(dbSpec!.content!.trim()).toBe("# Markdown First\n\nContent from markdown file.");

      // Step 3: Export to JSONL
      await exportToJSONL(db, { outputDir: testDir });

      // Verify JSONL matches
      const jsonlSpecs = await readJSONL<SpecJSONL>(path.join(testDir, "specs.jsonl"));
      const jsonlSpec = jsonlSpecs.find((s) => s.id === "s-md1");
      expect(jsonlSpec).toBeTruthy();
      expect(jsonlSpec!.title).toBe("Markdown First Spec");
      expect(jsonlSpec!.tags).toEqual(["markdown", "test"]);
    });

    it("should sync markdown updates to DB and JSONL", async () => {
      // Create initial spec in DB
      createSpec(db, {
        id: "s-mdupdate",
        uuid: "uuid-mdupdate",
        title: "Initial Title",
        file_path: "specs/md-update.md",
        content: "Initial content",
        priority: 2,
      });

      // Create markdown with updated content
      const mdPath = path.join(specsDir, "md-update.md");
      writeMarkdownFile(
        mdPath,
        {
          id: "s-mdupdate",
          title: "Updated From Markdown",
          priority: 1,
        },
        "# Updated Content\n\nThis was updated via markdown."
      );

      // Sync markdown → DB
      const result = await syncMarkdownToJSONL(db, mdPath, {
        outputDir: testDir,
        autoExport: false,
      });

      expect(result.success).toBe(true);
      expect(result.action).toBe("updated");

      // Verify DB updated
      const dbSpec = getSpec(db, "s-mdupdate");
      expect(dbSpec!.title).toBe("Updated From Markdown");
      expect(dbSpec!.content!.trim()).toBe("# Updated Content\n\nThis was updated via markdown.");
      expect(dbSpec!.priority).toBe(1);

      // Export and verify JSONL
      await exportToJSONL(db, { outputDir: testDir });
      const jsonlSpecs = await readJSONL<SpecJSONL>(path.join(testDir, "specs.jsonl"));
      const jsonlSpec = jsonlSpecs.find((s) => s.id === "s-mdupdate");
      expect(jsonlSpec!.title).toBe("Updated From Markdown");
    });
  });

  describe("JSONL → DB → Markdown Flow", () => {
    it("should import new entities from JSONL", async () => {
      // Step 1: Create JSONL files directly
      const specJsonl: SpecJSONL = {
        id: "s-jsonl1",
        uuid: "uuid-jsonl1",
        title: "JSONL First Spec",
        file_path: "specs/jsonl-first.md",
        content: "Content from JSONL",
        priority: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        archived: false,
        relationships: [],
        tags: ["jsonl", "import"],
      };

      fs.writeFileSync(
        path.join(testDir, "specs.jsonl"),
        JSON.stringify(specJsonl)
      );
      fs.writeFileSync(path.join(testDir, "issues.jsonl"), "");

      // Step 2: Import from JSONL
      await importFromJSONL(db, { inputDir: testDir });

      // Verify DB state
      const dbSpec = getSpec(db, "s-jsonl1");
      expect(dbSpec).toBeTruthy();
      expect(dbSpec!.title).toBe("JSONL First Spec");
      expect(dbSpec!.content).toBe("Content from JSONL");

      const tags = getTags(db, "s-jsonl1", "spec");
      expect(tags).toEqual(["import", "jsonl"]); // sorted

      // Step 3: Sync to Markdown
      const mdPath = path.join(testDir, specJsonl.file_path);
      await syncJSONLToMarkdown(db, "s-jsonl1", "spec", mdPath);

      // Verify Markdown
      const parsed = parseMarkdownFile(mdPath, db, testDir);
      expect(parsed.data.title).toBe("JSONL First Spec");
    });

    it("should update existing entities from JSONL", async () => {
      // Create initial spec in DB
      createSpec(db, {
        id: "s-jsonlup",
        uuid: "uuid-jsonlup",
        title: "Original",
        file_path: "specs/jsonl-update.md",
        content: "Original content",
        priority: 2,
      });

      // Create JSONL with updated data
      const updatedSpec: SpecJSONL = {
        id: "s-jsonlup",
        uuid: "uuid-jsonlup",
        title: "Updated From JSONL",
        file_path: "specs/jsonl-update.md",
        content: "Content updated via JSONL import",
        priority: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date(Date.now() + 1000).toISOString(), // Newer timestamp
        archived: false,
        relationships: [],
        tags: ["updated"],
      };

      fs.writeFileSync(
        path.join(testDir, "specs.jsonl"),
        JSON.stringify(updatedSpec)
      );
      fs.writeFileSync(path.join(testDir, "issues.jsonl"), "");

      // Import from JSONL
      await importFromJSONL(db, { inputDir: testDir });

      // Verify DB updated
      const dbSpec = getSpec(db, "s-jsonlup");
      expect(dbSpec!.title).toBe("Updated From JSONL");
      expect(dbSpec!.content).toBe("Content updated via JSONL import");
      expect(dbSpec!.priority).toBe(0);
    });
  });

  describe("Relationship Preservation Across Flows", () => {
    it("should preserve implements relationship when spec is updated via API", async () => {
      // Step 1: Create spec and issue
      createSpec(db, {
        id: "s-rel1",
        uuid: "uuid-srel1",
        title: "Spec with Relationship",
        file_path: "specs/rel-test.md",
        content: "Spec content",
        priority: 2,
      });

      createIssue(db, {
        id: "i-rel1",
        uuid: "uuid-irel1",
        title: "Issue Implementing Spec",
        content: "Issue content",
        status: "open",
        priority: 2,
      });

      // Step 2: Create "implements" relationship (issue → spec)
      addRelationship(db, {
        from_id: "i-rel1",
        from_type: "issue",
        to_id: "s-rel1",
        to_type: "spec",
        relationship_type: "implements",
      });

      // Verify relationship exists
      const issueOutgoing = getOutgoingRelationships(db, "i-rel1", "issue");
      expect(issueOutgoing).toHaveLength(1);
      expect(issueOutgoing[0].relationship_type).toBe("implements");
      expect(issueOutgoing[0].to_id).toBe("s-rel1");

      const specIncoming = getIncomingRelationships(db, "s-rel1", "spec");
      expect(specIncoming).toHaveLength(1);

      // Step 3: Export to JSONL
      await exportToJSONL(db, { outputDir: testDir });

      // Verify relationship is in JSONL (on the issue, since it's outgoing from issue)
      const jsonlIssues = await readJSONL<IssueJSONL>(path.join(testDir, "issues.jsonl"));
      const jsonlIssue = jsonlIssues.find((i) => i.id === "i-rel1");
      expect(jsonlIssue!.relationships).toHaveLength(1);
      expect(jsonlIssue!.relationships![0].type).toBe("implements");
      expect(jsonlIssue!.relationships![0].to).toBe("s-rel1");

      // Step 4: Update spec via "API" (simulating frontend update)
      updateSpec(db, "s-rel1", {
        title: "Updated Spec Title",
        content: "Updated spec content - this change should NOT affect relationships",
      });

      // Step 5: Export again
      await exportToJSONL(db, { outputDir: testDir });

      // Step 6: Re-import from JSONL (simulating watcher behavior)
      await importFromJSONL(db, {
        inputDir: testDir,
        forceUpdateIds: ["s-rel1"], // Force update the spec
      });

      // Step 7: Verify relationship is STILL preserved
      const issueOutgoingAfter = getOutgoingRelationships(db, "i-rel1", "issue");
      expect(issueOutgoingAfter).toHaveLength(1);
      expect(issueOutgoingAfter[0].relationship_type).toBe("implements");
      expect(issueOutgoingAfter[0].to_id).toBe("s-rel1");

      const specIncomingAfter = getIncomingRelationships(db, "s-rel1", "spec");
      expect(specIncomingAfter).toHaveLength(1);

      // Verify spec was actually updated
      const dbSpec = getSpec(db, "s-rel1");
      expect(dbSpec!.title).toBe("Updated Spec Title");
    });

    it("should preserve implements relationship when spec is updated via Markdown", async () => {
      // Setup: Create spec, issue, and relationship
      createSpec(db, {
        id: "s-mdrel",
        uuid: "uuid-smdrel",
        title: "Spec for MD Relationship Test",
        file_path: "specs/md-rel-test.md",
        content: "Original spec content",
        priority: 2,
      });

      createIssue(db, {
        id: "i-mdrel",
        uuid: "uuid-imdrel",
        title: "Issue for MD Relationship Test",
        content: "Issue content",
        status: "open",
        priority: 2,
      });

      addRelationship(db, {
        from_id: "i-mdrel",
        from_type: "issue",
        to_id: "s-mdrel",
        to_type: "spec",
        relationship_type: "implements",
      });

      // Export initial state
      await exportToJSONL(db, { outputDir: testDir });

      // Update spec via Markdown
      const mdPath = path.join(specsDir, "md-rel-test.md");
      writeMarkdownFile(
        mdPath,
        {
          id: "s-mdrel",
          title: "Updated Via Markdown",
          priority: 1,
        },
        "# Updated Content\n\nThis was updated via markdown editing."
      );

      // Sync markdown → DB → JSONL
      await syncMarkdownToJSONL(db, mdPath, {
        outputDir: testDir,
        autoExport: true,
      });

      // Re-import (simulating watcher detecting JSONL change)
      await importFromJSONL(db, {
        inputDir: testDir,
        forceUpdateIds: ["s-mdrel"],
      });

      // Verify relationship preserved
      const issueOutgoing = getOutgoingRelationships(db, "i-mdrel", "issue");
      expect(issueOutgoing).toHaveLength(1);
      expect(issueOutgoing[0].relationship_type).toBe("implements");

      // Verify spec updated
      const dbSpec = getSpec(db, "s-mdrel");
      expect(dbSpec!.title).toBe("Updated Via Markdown");
    });

    it("should preserve multiple relationships when issue is updated", async () => {
      // Create multiple specs
      createSpec(db, {
        id: "s-multi1",
        uuid: "uuid-multi1",
        title: "Spec 1",
        file_path: "specs/multi1.md",
        content: "Spec 1 content",
        priority: 2,
      });

      createSpec(db, {
        id: "s-multi2",
        uuid: "uuid-multi2",
        title: "Spec 2",
        file_path: "specs/multi2.md",
        content: "Spec 2 content",
        priority: 2,
      });

      // Create issue
      createIssue(db, {
        id: "i-multi",
        uuid: "uuid-imulti",
        title: "Issue with Multiple Relationships",
        content: "Issue implementing multiple specs",
        status: "open",
        priority: 2,
      });

      // Create multiple relationships
      addRelationship(db, {
        from_id: "i-multi",
        from_type: "issue",
        to_id: "s-multi1",
        to_type: "spec",
        relationship_type: "implements",
      });

      addRelationship(db, {
        from_id: "i-multi",
        from_type: "issue",
        to_id: "s-multi2",
        to_type: "spec",
        relationship_type: "implements",
      });

      // Export
      await exportToJSONL(db, { outputDir: testDir });

      // Update issue
      updateIssue(db, "i-multi", {
        title: "Updated Issue Title",
        status: "in_progress",
      });

      // Export and re-import
      await exportToJSONL(db, { outputDir: testDir });
      await importFromJSONL(db, {
        inputDir: testDir,
        forceUpdateIds: ["i-multi"],
      });

      // Verify both relationships preserved
      const issueOutgoing = getOutgoingRelationships(db, "i-multi", "issue");
      expect(issueOutgoing).toHaveLength(2);

      const implementsRels = issueOutgoing.filter((r) => r.relationship_type === "implements");
      expect(implementsRels).toHaveLength(2);

      const targetIds = implementsRels.map((r) => r.to_id).sort();
      expect(targetIds).toEqual(["s-multi1", "s-multi2"]);

      // Verify issue updated
      const dbIssue = getIssue(db, "i-multi");
      expect(dbIssue!.title).toBe("Updated Issue Title");
      expect(dbIssue!.status).toBe("in_progress");
    });

    it("should preserve bidirectional relationships (blocks/depends-on)", async () => {
      // Create two issues
      createIssue(db, {
        id: "i-blocker",
        uuid: "uuid-blocker",
        title: "Blocker Issue",
        content: "This blocks another issue",
        status: "open",
        priority: 1,
      });

      createIssue(db, {
        id: "i-blocked",
        uuid: "uuid-blocked",
        title: "Blocked Issue",
        content: "This is blocked by another issue",
        status: "open",
        priority: 2,
      });

      // Create "blocks" relationship
      addRelationship(db, {
        from_id: "i-blocker",
        from_type: "issue",
        to_id: "i-blocked",
        to_type: "issue",
        relationship_type: "blocks",
      });

      // Export
      await exportToJSONL(db, { outputDir: testDir });

      // Verify JSONL has relationship on blocker issue
      let jsonlIssues = await readJSONL<IssueJSONL>(path.join(testDir, "issues.jsonl"));
      const blockerJsonl = jsonlIssues.find((i) => i.id === "i-blocker");
      expect(blockerJsonl!.relationships).toHaveLength(1);
      expect(blockerJsonl!.relationships![0].type).toBe("blocks");

      // Update the blocked issue
      updateIssue(db, "i-blocked", {
        title: "Updated Blocked Issue",
        content: "Still blocked",
      });

      // Export and re-import
      await exportToJSONL(db, { outputDir: testDir });
      await importFromJSONL(db, {
        inputDir: testDir,
        forceUpdateIds: ["i-blocked"],
      });

      // Verify "blocks" relationship preserved
      const blockerOutgoing = getOutgoingRelationships(db, "i-blocker", "issue");
      expect(blockerOutgoing).toHaveLength(1);
      expect(blockerOutgoing[0].relationship_type).toBe("blocks");
      expect(blockerOutgoing[0].to_id).toBe("i-blocked");

      // Verify incoming on blocked issue
      const blockedIncoming = getIncomingRelationships(db, "i-blocked", "issue");
      expect(blockedIncoming).toHaveLength(1);
      expect(blockedIncoming[0].from_id).toBe("i-blocker");
    });
  });

  describe("Full Watcher Simulation", () => {
    it("should handle spec update → export → import cycle without losing data", async () => {
      // Setup: Create entities and relationships
      createSpec(db, {
        id: "s-watcher",
        uuid: "uuid-swatcher",
        title: "Watcher Test Spec",
        file_path: "specs/watcher.md",
        content: "Original content",
        priority: 2,
      });

      createIssue(db, {
        id: "i-watcher",
        uuid: "uuid-iwatcher",
        title: "Watcher Test Issue",
        content: "Issue content",
        status: "open",
        priority: 2,
      });

      addRelationship(db, {
        from_id: "i-watcher",
        from_type: "issue",
        to_id: "s-watcher",
        to_type: "spec",
        relationship_type: "implements",
      });

      setTags(db, "s-watcher", "spec", ["watcher", "test"]);
      setTags(db, "i-watcher", "issue", ["implementation"]);

      // Initial export
      await exportToJSONL(db, { outputDir: testDir });

      // Simulate spec update via API
      updateSpec(db, "s-watcher", {
        title: "Updated Watcher Spec",
        content: "Content updated via simulated API call",
      });

      // Export (triggered by API)
      await exportToJSONL(db, { outputDir: testDir });

      // Read JSONL to verify state before import
      const specsBeforeImport = await readJSONL<SpecJSONL>(path.join(testDir, "specs.jsonl"));
      const issuesBeforeImport = await readJSONL<IssueJSONL>(path.join(testDir, "issues.jsonl"));

      expect(specsBeforeImport[0].title).toBe("Updated Watcher Spec");
      expect(issuesBeforeImport[0].relationships).toHaveLength(1);

      // Simulate watcher: import with force update on spec
      await importFromJSONL(db, {
        inputDir: testDir,
        forceUpdateIds: ["s-watcher"],
      });

      // Verify all data preserved
      const finalSpec = getSpec(db, "s-watcher");
      expect(finalSpec!.title).toBe("Updated Watcher Spec");

      const finalIssue = getIssue(db, "i-watcher");
      expect(finalIssue!.title).toBe("Watcher Test Issue");

      const finalRelationships = getOutgoingRelationships(db, "i-watcher", "issue");
      expect(finalRelationships).toHaveLength(1);
      expect(finalRelationships[0].relationship_type).toBe("implements");

      const finalSpecTags = getTags(db, "s-watcher", "spec");
      expect(finalSpecTags).toEqual(["test", "watcher"]);

      const finalIssueTags = getTags(db, "i-watcher", "issue");
      expect(finalIssueTags).toEqual(["implementation"]);
    });

    it("should handle concurrent spec and issue updates", async () => {
      // Setup
      createSpec(db, {
        id: "s-concurrent",
        uuid: "uuid-sconcurrent",
        title: "Concurrent Test Spec",
        file_path: "specs/concurrent.md",
        content: "Spec content",
        priority: 2,
      });

      createIssue(db, {
        id: "i-concurrent",
        uuid: "uuid-iconcurrent",
        title: "Concurrent Test Issue",
        content: "Issue content",
        status: "open",
        priority: 2,
      });

      addRelationship(db, {
        from_id: "i-concurrent",
        from_type: "issue",
        to_id: "s-concurrent",
        to_type: "spec",
        relationship_type: "implements",
      });

      // Initial export
      await exportToJSONL(db, { outputDir: testDir });

      // Update both spec and issue
      updateSpec(db, "s-concurrent", { title: "Updated Spec" });
      updateIssue(db, "i-concurrent", { title: "Updated Issue", status: "in_progress" });

      // Export
      await exportToJSONL(db, { outputDir: testDir });

      // Import with both IDs forced (simulating concurrent watcher triggers)
      await importFromJSONL(db, {
        inputDir: testDir,
        forceUpdateIds: ["s-concurrent", "i-concurrent"],
      });

      // Verify all updates and relationships preserved
      const spec = getSpec(db, "s-concurrent");
      expect(spec!.title).toBe("Updated Spec");

      const issue = getIssue(db, "i-concurrent");
      expect(issue!.title).toBe("Updated Issue");
      expect(issue!.status).toBe("in_progress");

      const relationships = getOutgoingRelationships(db, "i-concurrent", "issue");
      expect(relationships).toHaveLength(1);
      expect(relationships[0].to_id).toBe("s-concurrent");
    });
  });

  describe("Edge Cases and Regression Prevention", () => {
    it("should handle spec with no relationships", async () => {
      createSpec(db, {
        id: "s-norel",
        uuid: "uuid-norel",
        title: "Spec Without Relationships",
        file_path: "specs/no-rel.md",
        content: "Standalone spec",
        priority: 2,
      });

      await exportToJSONL(db, { outputDir: testDir });

      updateSpec(db, "s-norel", { title: "Updated Standalone Spec" });

      await exportToJSONL(db, { outputDir: testDir });
      await importFromJSONL(db, {
        inputDir: testDir,
        forceUpdateIds: ["s-norel"],
      });

      const spec = getSpec(db, "s-norel");
      expect(spec!.title).toBe("Updated Standalone Spec");
    });

    it("should handle issue with outgoing relationship being updated", async () => {
      // When the issue itself is updated, its outgoing relationships
      // should be removed and re-added from JSONL
      createSpec(db, {
        id: "s-issueupdate",
        uuid: "uuid-sissueupdate",
        title: "Target Spec",
        file_path: "specs/issue-update.md",
        content: "Spec content",
        priority: 2,
      });

      createIssue(db, {
        id: "i-issueupdate",
        uuid: "uuid-iissueupdate",
        title: "Issue To Update",
        content: "Issue content",
        status: "open",
        priority: 2,
      });

      addRelationship(db, {
        from_id: "i-issueupdate",
        from_type: "issue",
        to_id: "s-issueupdate",
        to_type: "spec",
        relationship_type: "implements",
      });

      // Export
      await exportToJSONL(db, { outputDir: testDir });

      // Verify relationship in JSONL
      let jsonlIssues = await readJSONL<IssueJSONL>(path.join(testDir, "issues.jsonl"));
      expect(jsonlIssues[0].relationships).toHaveLength(1);

      // Update issue
      updateIssue(db, "i-issueupdate", {
        title: "Updated Issue",
        status: "in_progress",
      });

      // Export and import with issue forced
      await exportToJSONL(db, { outputDir: testDir });
      await importFromJSONL(db, {
        inputDir: testDir,
        forceUpdateIds: ["i-issueupdate"],
      });

      // Verify relationship preserved (re-added from JSONL)
      const relationships = getOutgoingRelationships(db, "i-issueupdate", "issue");
      expect(relationships).toHaveLength(1);
      expect(relationships[0].relationship_type).toBe("implements");
    });

    it("should preserve archived status through round trip", async () => {
      createSpec(db, {
        id: "s-archived",
        uuid: "uuid-archived",
        title: "Archived Spec",
        file_path: "specs/archived.md",
        content: "This spec is archived",
        priority: 2,
        archived: true,
        archived_at: new Date().toISOString(),
      });

      await exportToJSONL(db, { outputDir: testDir });

      const jsonlSpecs = await readJSONL<SpecJSONL>(path.join(testDir, "specs.jsonl"));
      // SQLite stores booleans as integers, but JSONL may represent as true/1
      expect(!!jsonlSpecs[0].archived).toBe(true);
      expect(jsonlSpecs[0].archived_at).toBeTruthy();

      await importFromJSONL(db, {
        inputDir: testDir,
        forceUpdateIds: ["s-archived"],
      });

      const spec = getSpec(db, "s-archived");
      // SQLite returns 0/1 for boolean fields
      expect(!!spec!.archived).toBe(true);
    });

    it("should handle empty tags array", async () => {
      createSpec(db, {
        id: "s-notags",
        uuid: "uuid-notags",
        title: "Spec Without Tags",
        file_path: "specs/no-tags.md",
        content: "No tags here",
        priority: 2,
      });

      await exportToJSONL(db, { outputDir: testDir });

      const jsonlSpecs = await readJSONL<SpecJSONL>(path.join(testDir, "specs.jsonl"));
      expect(jsonlSpecs[0].tags).toEqual([]);

      await importFromJSONL(db, {
        inputDir: testDir,
        forceUpdateIds: ["s-notags"],
      });

      const tags = getTags(db, "s-notags", "spec");
      expect(tags).toEqual([]);
    });

    it("should handle special characters in content", async () => {
      const specialContent = `# Special Characters Test

This has "quotes" and 'apostrophes'.
It also has <html> tags and & ampersands.
Unicode: 日本語 中文 한국어 🎉
Code: \`const x = 1;\`
Backticks: \`\`\`javascript
console.log("hello");
\`\`\``;

      createSpec(db, {
        id: "s-special",
        uuid: "uuid-special",
        title: 'Spec with "Special" Characters',
        file_path: "specs/special.md",
        content: specialContent,
        priority: 2,
      });

      await exportToJSONL(db, { outputDir: testDir });
      await importFromJSONL(db, {
        inputDir: testDir,
        forceUpdateIds: ["s-special"],
      });

      const spec = getSpec(db, "s-special");
      expect(spec!.title).toBe('Spec with "Special" Characters');
      expect(spec!.content).toBe(specialContent);
    });
  });
});
