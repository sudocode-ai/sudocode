/**
 * Integration test for JSONL file changes triggering WebSocket broadcasts
 * Tests that when issues.jsonl or specs.jsonl changes, proper broadcasts are sent
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type Database from "better-sqlite3";
import { initDatabase } from "@sudocode-ai/cli/dist/db.js";
import { createNewIssue, getIssueById } from "../../src/services/issues.js";
import { exportToJSONL } from "@sudocode-ai/cli/dist/export.js";
import * as websocketModule from "../../src/services/websocket.js";
import { startServerWatcher } from "../../src/services/watcher.js";

describe("JSONL File Changes - WebSocket Broadcasts", () => {
  let db: Database.Database;
  let testDir: string;
  let dbPath: string;
  let broadcastIssueUpdateSpy: ReturnType<typeof vi.spyOn>;
  let watcherControl: any;

  beforeEach(async () => {
    // Create temp directory
    testDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "sudocode-jsonl-broadcast-test-")
    );
    dbPath = path.join(testDir, "cache.db");

    // Create necessary subdirectories
    fs.mkdirSync(path.join(testDir, "issues"), { recursive: true });
    fs.mkdirSync(path.join(testDir, "specs"), { recursive: true });

    // Initialize database
    db = initDatabase({ path: dbPath });

    // Spy on broadcast functions
    broadcastIssueUpdateSpy = vi.spyOn(websocketModule, "broadcastIssueUpdate");
  });

  afterEach(async () => {
    // Stop watcher
    if (watcherControl) {
      await watcherControl.stop();
    }

    // Clean up
    if (db && db.open) {
      db.close();
    }
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    // Restore mocks
    vi.restoreAllMocks();
  });

  it("should broadcast issue updates via onEntitySync callback with entity data", async () => {
    const projectId = "test-project-jsonl";

    // Create an issue and export to JSONL
    const issue = createNewIssue(db, {
      id: "i-jsonl1",
      uuid: "uuid-jsonl-1",
      title: "JSONL Test Issue",
      content: "Original content",
      status: "open",
      priority: 2,
    });

    await exportToJSONL(db, { outputDir: testDir });

    let dbQueryCount = 0;

    // Start watcher with onEntitySync callback
    watcherControl = startServerWatcher({
      db,
      baseDir: testDir,
      syncJSONLToMarkdown: false,
      onFileChange: (info) => {
        // Simulate project-manager.ts onFileChange callback
        if (
          info.entityType === "issue" &&
          info.entityId &&
          info.entityId !== "*"
        ) {
          // Use entity from event if available (optimization)
          if (info.entity) {
            websocketModule.broadcastIssueUpdate(
              projectId,
              info.entityId,
              "updated",
              info.entity
            );
          } else {
            // Fallback to DB query (old path)
            dbQueryCount++;
            const updatedIssue = getIssueById(db, info.entityId);
            if (updatedIssue) {
              websocketModule.broadcastIssueUpdate(
                projectId,
                info.entityId,
                "updated",
                updatedIssue
              );
            }
          }
        }
      },
    });

    // Wait for watcher to initialize
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Modify the JSONL file directly
    const issuesJsonlPath = path.join(testDir, "issues.jsonl");
    const jsonlContent = fs.readFileSync(issuesJsonlPath, "utf8");
    const issueData = JSON.parse(jsonlContent.trim());
    issueData.title = "Updated Title via JSONL";
    issueData.content = "Updated content via JSONL";
    issueData.updated_at = new Date().toISOString(); // Update timestamp to trigger import
    fs.writeFileSync(issuesJsonlPath, JSON.stringify(issueData) + "\n");

    // Wait for file watcher to process the change
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Verify broadcast was called
    expect(broadcastIssueUpdateSpy).toHaveBeenCalled();
    expect(broadcastIssueUpdateSpy).toHaveBeenCalledWith(
      projectId,
      issue.id,
      "updated",
      expect.objectContaining({
        id: issue.id,
        title: "Updated Title via JSONL",
      })
    );

    // Verify entity data optimization works (no DB query)
    expect(dbQueryCount).toBe(0);
  });

  it("should handle multiple entities changed in JSONL", async () => {
    const projectId = "test-multi-jsonl";

    // Create multiple issues
    const issue1 = createNewIssue(db, {
      id: "i-multi-jsonl1",
      uuid: "uuid-multi-jsonl-1",
      title: "Multi JSONL 1",
      content: "Content 1",
      status: "open",
      priority: 2,
    });

    const issue2 = createNewIssue(db, {
      id: "i-multi-jsonl2",
      uuid: "uuid-multi-jsonl-2",
      title: "Multi JSONL 2",
      content: "Content 2",
      status: "open",
      priority: 2,
    });

    await exportToJSONL(db, { outputDir: testDir });

    // Start watcher
    watcherControl = startServerWatcher({
      db,
      baseDir: testDir,
      syncJSONLToMarkdown: false,
      onFileChange: (info) => {
        if (info.entityType && info.entityId && info.entityId !== "*") {
          const updatedIssue = getIssueById(db, info.entityId);
          if (updatedIssue) {
            websocketModule.broadcastIssueUpdate(
              projectId,
              info.entityId,
              "updated",
              updatedIssue
            );
          }
        }
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 300));

    // Modify both issues in JSONL
    const issuesJsonlPath = path.join(testDir, "issues.jsonl");
    const now = new Date().toISOString();
    const lines = [
      JSON.stringify({ ...issue1, title: "Updated Multi 1", updated_at: now }),
      JSON.stringify({ ...issue2, title: "Updated Multi 2", updated_at: now }),
    ];
    fs.writeFileSync(issuesJsonlPath, lines.join("\n") + "\n");

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Both broadcasts should have been called
    expect(broadcastIssueUpdateSpy).toHaveBeenCalledWith(
      projectId,
      issue1.id,
      "updated",
      expect.any(Object)
    );

    expect(broadcastIssueUpdateSpy).toHaveBeenCalledWith(
      projectId,
      issue2.id,
      "updated",
      expect.any(Object)
    );
  });

  it("should broadcast spec updates via onEntitySync callback", async () => {
    const projectId = "test-spec-jsonl";

    // Create a spec and export to JSONL
    const { createNewSpec } = await import("../../src/services/specs.js");
    const spec = createNewSpec(db, {
      id: "s-jsonl1",
      uuid: "uuid-spec-jsonl-1",
      title: "JSONL Test Spec",
      content: "Original spec content",
      priority: 2,
      file_path: "specs/s-jsonl1 - JSONL Test Spec.md",
    });

    await exportToJSONL(db, { outputDir: testDir });

    const specBroadcasts: any[] = [];
    const broadcastSpecUpdateSpy = vi.spyOn(
      websocketModule,
      "broadcastSpecUpdate"
    );

    // Start watcher with onFileChange callback
    watcherControl = startServerWatcher({
      db,
      baseDir: testDir,
      syncJSONLToMarkdown: false,
      onFileChange: (info) => {
        if (
          info.entityType === "spec" &&
          info.entityId &&
          info.entityId !== "*"
        ) {
          if (info.entity) {
            websocketModule.broadcastSpecUpdate(
              projectId,
              info.entityId,
              "updated",
              info.entity
            );
          } else {
            const { getSpecById } = require("../../src/services/specs.js");
            const updatedSpec = getSpecById(db, info.entityId);
            if (updatedSpec) {
              websocketModule.broadcastSpecUpdate(
                projectId,
                info.entityId,
                "updated",
                updatedSpec
              );
            }
          }
        }
      },
    });

    // Wait for watcher to initialize
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Modify the specs JSONL file directly
    const specsJsonlPath = path.join(testDir, "specs.jsonl");
    const jsonlContent = fs.readFileSync(specsJsonlPath, "utf8");
    const specData = JSON.parse(jsonlContent.trim());
    specData.title = "Updated Spec Title via JSONL";
    specData.content = "Updated spec content via JSONL";
    specData.updated_at = new Date().toISOString();
    fs.writeFileSync(specsJsonlPath, JSON.stringify(specData) + "\n");

    // Wait for file watcher to process the change
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Verify broadcast was called
    expect(broadcastSpecUpdateSpy).toHaveBeenCalled();
    expect(broadcastSpecUpdateSpy).toHaveBeenCalledWith(
      projectId,
      spec.id,
      "updated",
      expect.objectContaining({
        id: spec.id,
        title: "Updated Spec Title via JSONL",
      })
    );
  });

  it("should broadcast fresh content when JSONL changes without timestamp update", async () => {
    const projectId = "test-content-without-timestamp";

    // Create an issue and export to JSONL
    const issue = createNewIssue(db, {
      id: "i-fresh-content",
      uuid: "uuid-fresh-content",
      title: "Original Title",
      content: "Original content",
      status: "open",
      priority: 2,
    });

    await exportToJSONL(db, { outputDir: testDir });

    // Start watcher
    watcherControl = startServerWatcher({
      db,
      baseDir: testDir,
      syncJSONLToMarkdown: false,
      onFileChange: (info) => {
        if (
          info.entityType === "issue" &&
          info.entityId &&
          info.entityId !== "*"
        ) {
          if (info.entity) {
            websocketModule.broadcastIssueUpdate(
              projectId,
              info.entityId,
              "updated",
              info.entity
            );
          } else {
            const updatedIssue = getIssueById(db, info.entityId);
            if (updatedIssue) {
              websocketModule.broadcastIssueUpdate(
                projectId,
                info.entityId,
                "updated",
                updatedIssue
              );
            }
          }
        }
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 300));

    // Modify the JSONL file WITHOUT changing timestamp
    const issuesJsonlPath = path.join(testDir, "issues.jsonl");
    const jsonlContent = fs.readFileSync(issuesJsonlPath, "utf8");
    const issueData = JSON.parse(jsonlContent.trim());

    // Save original timestamp
    const originalTimestamp = issueData.updated_at;

    // Change content but DON'T update timestamp
    issueData.title = "Modified Title Without Timestamp Change";
    issueData.content = "Modified content without timestamp change";
    // Note: NOT updating issueData.updated_at

    fs.writeFileSync(issuesJsonlPath, JSON.stringify(issueData) + "\n");

    // Wait for file watcher to process the change
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Verify broadcast was called with FRESH content (not stale)
    expect(broadcastIssueUpdateSpy).toHaveBeenCalled();
    expect(broadcastIssueUpdateSpy).toHaveBeenCalledWith(
      projectId,
      issue.id,
      "updated",
      expect.objectContaining({
        id: issue.id,
        title: "Modified Title Without Timestamp Change",
        content: "Modified content without timestamp change",
        updated_at: originalTimestamp, // Timestamp should be preserved
      })
    );
  });
});
