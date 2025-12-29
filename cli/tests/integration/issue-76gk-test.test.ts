/**
 * Test case for issue i-76gk: Field-level three-way merge incorrectly applied to multi-line text fields
 *
 * This test reproduces the exact scenario reported by the user:
 * - Branch 1 modifies line 1 of content and changes status to 'in_progress'
 * - Branch 2 modifies line 3 of content
 * - Expected: Both line changes preserved, status='in_progress'
 * - Bug (before fix): content gets latest-wins (branch-2's change lost), status correct
 */

import { describe, it, expect } from "vitest";
import { mergeThreeWay } from "../../src/merge-resolver.js";
import type { IssueJSONL } from "../../src/types.js";

describe("Issue i-76gk: Multi-line field merge bug", () => {
  it("should preserve line changes from both branches AND scalar field changes", () => {
    const base: IssueJSONL = {
      id: "i-test",
      uuid: "uuid-test",
      title: "Test Issue",
      description: "Line 1\nLine 2\nLine 3",
      status: "open",
      priority: 1,
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-01T00:00:00Z",
      tags: [],
      relationships: [],
      feedback: [],
    };

    // Branch 1: Modified line 1 of description AND changed status
    const ours: IssueJSONL = {
      ...base,
      description: "Line 1 MODIFIED\nLine 2\nLine 3",
      status: "in_progress",
      updated_at: "2025-01-02T00:00:00Z",
    };

    // Branch 2: Modified line 3 of description only (newer timestamp)
    const theirs: IssueJSONL = {
      ...base,
      description: "Line 1\nLine 2\nLine 3 MODIFIED",
      updated_at: "2025-01-03T00:00:00Z",
    };

    const { entities } = mergeThreeWay([base], [ours], [theirs]);

    expect(entities).toHaveLength(1);
    const merged = entities[0];

    // CRITICAL: Both line changes should be preserved (git merge-file line-level merge)
    expect(merged.description).toBe("Line 1 MODIFIED\nLine 2\nLine 3 MODIFIED");

    // CRITICAL: Scalar field change should be preserved (only ours changed it)
    expect(merged.status).toBe("in_progress");

    // Priority should be unchanged (neither branch changed it)
    expect(merged.priority).toBe(1);
  });

  it("should handle the exact user scenario from issue i-76gk", () => {
    const base: IssueJSONL = {
      id: "i-4dds",
      uuid: "550e8400-e29b-41d4-a716-446655440000",
      title: "Example Issue",
      description: "## Problem\n\nExisting problem description.\n\n## Solution\n\nExisting solution.",
      status: "open",
      priority: 1,
      assignee: undefined,
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-01T00:00:00Z",
      tags: ["bug"],
      relationships: [],
      feedback: [],
    };

    // branch-1: Added new section to description AND changed status
    const branch1: IssueJSONL = {
      ...base,
      description:
        "## Problem\n\nExisting problem description.\n\n## Solution\n\nExisting solution.\n\n## Implementation\n\nNew section added in branch-1.",
      status: "in_progress",
      updated_at: "2025-01-02T10:00:00Z",
    };

    // branch-2: Modified problem section (newer timestamp)
    const branch2: IssueJSONL = {
      ...base,
      description:
        "## Problem\n\nExisting problem description.\n\nAdditional context added in branch-2.\n\n## Solution\n\nExisting solution.",
      updated_at: "2025-01-02T15:00:00Z",
    };

    const { entities, stats } = mergeThreeWay([base], [branch1], [branch2]);

    expect(entities).toHaveLength(1);
    const merged = entities[0];

    // Both description changes should be merged
    expect(merged.description).toContain("Additional context added in branch-2");
    expect(merged.description).toContain("New section added in branch-1");

    // Status change from branch-1 should be preserved (only branch-1 changed it)
    expect(merged.status).toBe("in_progress");

    // No scalar conflicts (status only changed in one branch)
    const scalarConflicts = stats.conflicts.filter((c) =>
      c.action.includes("scalar field")
    );
    expect(scalarConflicts).toHaveLength(0);
  });

  it("should apply latest-wins only when git merge-file has conflicts", () => {
    const base: IssueJSONL = {
      id: "i-test",
      uuid: "uuid-test",
      title: "Test",
      description: "Line 1\nLine 2\nLine 3",
      status: "open",
      priority: 1,
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-01T00:00:00Z",
      tags: [],
      relationships: [],
      feedback: [],
    };

    // Both branches modify the SAME line
    const ours: IssueJSONL = {
      ...base,
      description: "Line 1 MODIFIED BY OURS\nLine 2\nLine 3",
      updated_at: "2025-01-02T00:00:00Z",
    };

    const theirs: IssueJSONL = {
      ...base,
      description: "Line 1 MODIFIED BY THEIRS\nLine 2\nLine 3",
      updated_at: "2025-01-03T00:00:00Z",
    };

    const { entities, stats } = mergeThreeWay([base], [ours], [theirs]);

    expect(entities).toHaveLength(1);
    const merged = entities[0];

    // Git merge-file will have a conflict, so latest-wins should apply
    // Theirs has newer timestamp, so theirs should win
    expect(merged.description).toBe("Line 1 MODIFIED BY THEIRS\nLine 2\nLine 3");

    // Should report YAML conflict
    const yamlConflicts = stats.conflicts.filter((c) =>
      c.action.includes("YAML conflict")
    );
    expect(yamlConflicts.length).toBeGreaterThan(0);
  });
});
