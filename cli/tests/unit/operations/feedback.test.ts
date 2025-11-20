/**
 * Unit tests for Feedback operations
 */

import { describe, it, expect, beforeEach } from "vitest";
import { initDatabase } from "../../../src/db.js";
import {
  createFeedback,
  getFeedback,
  updateFeedback,
  deleteFeedback,
  dismissFeedback,
  listFeedback,
  getFeedbackForIssue,
  getFeedbackForSpec,
  getActiveFeedbackForSpec,
  countFeedbackByDismissed,
  generateFeedbackId,
  getFeedbackForTarget,
  getFeedbackFromIssue,
} from "../../../src/operations/feedback.js";
import { createSpec, deleteSpec } from "../../../src/operations/specs.js";
import { createIssue, deleteIssue } from "../../../src/operations/issues.js";
import type Database from "better-sqlite3";
import type { FeedbackAnchor } from "../../../src/types.js";
import { getEntityTypeFromId } from "../../../src/id-generator.js";

describe("Feedback Operations", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase({ path: ":memory:" });

    // Create test spec and issues for foreign key constraints
    createSpec(db, {
      id: "s-001",
      title: "Test Spec",
      file_path: "specs/test.md",
      content: "Test content",
      priority: 2,
    });

    createIssue(db, {
      id: "i-001",
      title: "Test Issue 1",
    });

    createIssue(db, {
      id: "i-002",
      title: "Test Issue 2",
    });
  });

  describe("generateFeedbackId", () => {
    it("should generate UUID for feedback ID", () => {
      const id = generateFeedbackId(db);
      // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it("should generate unique IDs for each feedback", () => {
      const id1 = generateFeedbackId(db);
      const id2 = generateFeedbackId(db);

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
      expect(id2).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it("should allow custom IDs (for backward compatibility with legacy FB-XXX format)", () => {
      const anchor: FeedbackAnchor = {
        anchor_status: "valid",
      };

      const feedback = createFeedback(db, {
        id: "FB-005",
        from_id: "i-001",
        to_id: "s-001",
        feedback_type: "suggestion",
        content: "Legacy custom ID",
        agent: "claude-code",
        anchor,
      });

      expect(feedback.id).toBe("FB-005");
    });
  });

  describe("createFeedback", () => {
    it("should create feedback with all fields", () => {
      const anchor: FeedbackAnchor = {
        section_heading: "Authentication",
        section_level: 2,
        line_number: 45,
        line_offset: 3,
        text_snippet: "token refresh logic",
        context_before: "implement JWT",
        context_after: "with expiration",
        anchor_status: "valid",
      };

      const feedback = createFeedback(db, {
        from_id: "i-001",
        to_id: "s-001",
        feedback_type: "comment",
        content: "Token rotation policy not specified",
        agent: "claude-code",
        anchor,
      });

      expect(feedback.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
      expect(feedback.from_id).toBe("i-001");
      expect(feedback.to_id).toBe("s-001");
      expect(feedback.feedback_type).toBe("comment");
      expect(feedback.content).toBe("Token rotation policy not specified");
      expect(feedback.agent).toBe("claude-code");
      expect(feedback.dismissed).toBe(false);

      expect(feedback.anchor).toBeDefined();
      const parsedAnchor = JSON.parse(feedback.anchor!);
      expect(parsedAnchor.section_heading).toBe("Authentication");
      expect(parsedAnchor.line_number).toBe(45);
      expect(parsedAnchor.anchor_status).toBe("valid");
    });

    it("should create feedback with defaults", () => {
      const anchor: FeedbackAnchor = {
        anchor_status: "valid",
      };

      const feedback = createFeedback(db, {
        from_id: "i-001",
        to_id: "s-001",
        feedback_type: "request",
        content: "Simple question",
        agent: "claude-code",
        anchor,
      });

      expect(feedback.dismissed).toBe(false);
    });

    it("should throw error on invalid foreign key", () => {
      const anchor: FeedbackAnchor = {
        anchor_status: "valid",
      };

      expect(() => {
        createFeedback(db, {
          from_id: "invalid-issue",
          to_id: "s-001",
          feedback_type: "comment",
          content: "Test",
          agent: "claude-code",
          anchor,
        });
      }).toThrow("Issue not found");
    });

    it("should validate feedback_type", () => {
      const anchor: FeedbackAnchor = {
        anchor_status: "valid",
      };

      expect(() => {
        createFeedback(db, {
          from_id: "i-001",
          to_id: "s-001",
          feedback_type: "invalid" as any,
          content: "Test",
          agent: "claude-code",
          anchor,
        });
      }).toThrow();
    });
  });

  describe("getFeedback", () => {
    it("should retrieve feedback by ID", () => {
      const anchor: FeedbackAnchor = {
        anchor_status: "valid",
      };

      const created = createFeedback(db, {
        from_id: "i-001",
        to_id: "s-001",
        feedback_type: "suggestion",
        content: "Test feedback",
        agent: "claude-code",
        anchor,
      });

      const retrieved = getFeedback(db, created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.content).toBe("Test feedback");
    });

    it("should return null for non-existent ID", () => {
      const feedback = getFeedback(db, "00000000-0000-0000-0000-000000000999");
      expect(feedback).toBeNull();
    });
  });

  describe("updateFeedback", () => {
    it("should update content", () => {
      const anchor: FeedbackAnchor = {
        anchor_status: "valid",
      };

      const created = createFeedback(db, {
        from_id: "i-001",
        to_id: "s-001",
        feedback_type: "comment",
        content: "Original content",
        agent: "claude-code",
        anchor,
      });

      const updated = updateFeedback(db, created.id, {
        content: "Updated content",
      });

      expect(updated.content).toBe("Updated content");
    });

    it("should update dismissed and resolution", () => {
      const anchor: FeedbackAnchor = {
        anchor_status: "valid",
      };

      const created = createFeedback(db, {
        from_id: "i-001",
        to_id: "s-001",
        feedback_type: "comment",
        content: "Test",
        agent: "claude-code",
        anchor,
      });

      const updated = updateFeedback(db, created.id, {
        dismissed: true,
      });

      expect(updated.dismissed).toBe(true);
    });

    it("should update anchor", () => {
      const anchor: FeedbackAnchor = {
        line_number: 10,
        anchor_status: "valid",
      };

      const created = createFeedback(db, {
        from_id: "i-001",
        to_id: "s-001",
        feedback_type: "comment",
        content: "Test",
        agent: "claude-code",
        anchor,
      });

      const newAnchor: FeedbackAnchor = {
        line_number: 15,
        anchor_status: "relocated",
        original_location: {
          line_number: 10,
        },
      };

      const updated = updateFeedback(db, created.id, {
        anchor: newAnchor,
      });

      expect(updated.anchor).toBeDefined();
      const parsedAnchor = JSON.parse(updated.anchor!);
      expect(parsedAnchor.line_number).toBe(15);
      expect(parsedAnchor.anchor_status).toBe("relocated");
      expect(parsedAnchor.original_location.line_number).toBe(10);
    });

    it("should throw error for non-existent ID", () => {
      expect(() => {
        updateFeedback(db, "00000000-0000-0000-0000-000000000999", {
          content: "Test",
        });
      }).toThrow("Feedback not found");
    });
  });

  describe("dismissFeedback", () => {
    it("should dismiss feedback with resolution", () => {
      const anchor: FeedbackAnchor = {
        anchor_status: "valid",
      };

      const created = createFeedback(db, {
        from_id: "i-001",
        to_id: "s-001",
        feedback_type: "comment",
        content: "Test",
        agent: "claude-code",
        anchor,
      });

      const updated = dismissFeedback(db, created.id);

      expect(updated.dismissed).toBe(true);
    });
  });

  describe("deleteFeedback", () => {
    it("should delete feedback", () => {
      const anchor: FeedbackAnchor = {
        anchor_status: "valid",
      };

      const created = createFeedback(db, {
        from_id: "i-001",
        to_id: "s-001",
        feedback_type: "suggestion",
        content: "Test",
        agent: "claude-code",
        anchor,
      });

      const deleted = deleteFeedback(db, created.id);
      expect(deleted).toBe(true);

      const retrieved = getFeedback(db, created.id);
      expect(retrieved).toBeNull();
    });

    it("should return false for non-existent ID", () => {
      const deleted = deleteFeedback(
        db,
        "00000000-0000-0000-0000-000000000999"
      );
      expect(deleted).toBe(false);
    });
  });

  describe("listFeedback", () => {
    beforeEach(() => {
      createSpec(db, {
        id: "s-002",
        title: "Another Spec",
        file_path: "specs/another.md",
        content: "Content",
        priority: 2,
      });

      createIssue(db, {
        id: "i-002",
        title: "Another Issue",
      });

      const anchor: FeedbackAnchor = { anchor_status: "valid" };

      createFeedback(db, {
        from_id: "i-001",
        to_id: "s-001",
        feedback_type: "comment",
        content: "Feedback 1",
        agent: "claude-code",
        anchor,
        dismissed: false,
      });

      createFeedback(db, {
        from_id: "i-001",
        to_id: "s-002",
        feedback_type: "suggestion",
        content: "Feedback 2",
        agent: "claude-code",
        anchor,
        dismissed: true,
      });

      createFeedback(db, {
        from_id: "i-002",
        to_id: "s-001",
        feedback_type: "request",
        content: "Feedback 3",
        agent: "cursor",
        anchor,
        dismissed: false,
      });
    });

    it("should list all feedback", () => {
      const feedback = listFeedback(db);
      expect(feedback).toHaveLength(3);
    });

    it("should filter by from_id (issue)", () => {
      const feedback = listFeedback(db, { from_id: "i-001" });
      expect(feedback).toHaveLength(2);
      expect(feedback.every((f) => f.from_id === "i-001")).toBe(true);
    });

    it("should filter by to_id (spec)", () => {
      const feedback = listFeedback(db, { to_id: "s-001" });
      expect(feedback).toHaveLength(2);
      expect(feedback.every((f) => f.to_id === "s-001")).toBe(true);
    });

    it("should filter by dismissed status", () => {
      const feedback = listFeedback(db, { dismissed: false });
      expect(feedback).toHaveLength(2);
      expect(feedback.every((f) => !f.dismissed)).toBe(true);
    });

    it("should filter by feedback_type", () => {
      const feedback = listFeedback(db, { feedback_type: "comment" });
      expect(feedback).toHaveLength(1);
      expect(feedback[0].feedback_type).toBe("comment");
    });

    it("should combine filters", () => {
      const feedback = listFeedback(db, {
        from_id: "i-001",
        dismissed: false,
      });
      expect(feedback).toHaveLength(1);
      expect(feedback[0].content).toBe("Feedback 1");
    });

    it("should respect limit", () => {
      const feedback = listFeedback(db, { limit: 2 });
      expect(feedback).toHaveLength(2);
    });
  });

  describe("getFeedbackForIssue", () => {
    it("should get all feedback for an issue", () => {
      const anchor: FeedbackAnchor = { anchor_status: "valid" };

      createFeedback(db, {
        from_id: "i-001",
        to_id: "s-001",
        feedback_type: "comment",
        content: "Feedback 1",
        agent: "claude-code",
        anchor,
      });

      createFeedback(db, {
        from_id: "i-001",
        to_id: "s-001",
        feedback_type: "suggestion",
        content: "Feedback 2",
        agent: "claude-code",
        anchor,
      });

      const feedback = getFeedbackForIssue(db, "i-001");
      expect(feedback).toHaveLength(2);
    });
  });

  describe("getFeedbackForSpec", () => {
    it("should get all feedback for a spec", () => {
      const anchor: FeedbackAnchor = { anchor_status: "valid" };

      createFeedback(db, {
        from_id: "i-001",
        to_id: "s-001",
        feedback_type: "comment",
        content: "Feedback 1",
        agent: "claude-code",
        anchor,
      });

      createFeedback(db, {
        from_id: "i-001",
        to_id: "s-001",
        feedback_type: "suggestion",
        content: "Feedback 2",
        agent: "claude-code",
        anchor,
      });

      const feedback = getFeedbackForSpec(db, "s-001");
      expect(feedback).toHaveLength(2);
    });
  });

  describe("getActiveFeedbackForSpec", () => {
    it("should get only active feedback for a spec", () => {
      const anchor: FeedbackAnchor = { anchor_status: "valid" };

      createFeedback(db, {
        from_id: "i-001",
        to_id: "s-001",
        feedback_type: "comment",
        content: "Active feedback",
        agent: "claude-code",
        anchor,
        dismissed: false,
      });

      createFeedback(db, {
        from_id: "i-001",
        to_id: "s-001",
        feedback_type: "suggestion",
        content: "Dismissed feedback",
        agent: "claude-code",
        anchor,
        dismissed: true,
      });

      const feedback = getActiveFeedbackForSpec(db, "s-001");
      expect(feedback).toHaveLength(1);
      expect(feedback[0].dismissed).toBe(false);
    });
  });

  describe("countFeedbackByDismissed", () => {
    it("should count all feedback by dismissed status", () => {
      const anchor: FeedbackAnchor = { anchor_status: "valid" };

      createFeedback(db, {
        from_id: "i-001",
        to_id: "s-001",
        feedback_type: "comment",
        content: "Active 1",
        agent: "claude-code",
        anchor,
        dismissed: false,
      });

      createFeedback(db, {
        from_id: "i-001",
        to_id: "s-001",
        feedback_type: "suggestion",
        content: "Active 2",
        agent: "claude-code",
        anchor,
        dismissed: false,
      });

      createFeedback(db, {
        from_id: "i-001",
        to_id: "s-001",
        feedback_type: "request",
        content: "Dismissed",
        agent: "claude-code",
        anchor,
        dismissed: true,
      });

      const counts = countFeedbackByDismissed(db);
      expect(counts.active).toBe(2);
      expect(counts.dismissed).toBe(1);
    });

    it("should count feedback for specific spec", () => {
      createSpec(db, {
        id: "s-002",
        title: "Another Spec",
        file_path: "specs/another.md",
        content: "Content",
        priority: 2,
      });

      const anchor: FeedbackAnchor = { anchor_status: "valid" };

      createFeedback(db, {
        from_id: "i-001",
        to_id: "s-001",
        feedback_type: "comment",
        content: "Spec 1",
        agent: "claude-code",
        anchor,
        dismissed: false,
      });

      createFeedback(db, {
        from_id: "i-001",
        to_id: "s-002",
        feedback_type: "suggestion",
        content: "Spec 2",
        agent: "claude-code",
        anchor,
        dismissed: true,
      });

      const counts = countFeedbackByDismissed(db, "s-001");
      expect(counts.active).toBe(1);
      expect(counts.dismissed).toBe(0);
    });
  });

  describe("Foreign key constraints", () => {
    it("should cascade delete when issue is deleted", () => {
      const anchor: FeedbackAnchor = { anchor_status: "valid" };

      createFeedback(db, {
        from_id: "i-001",
        to_id: "s-001",
        feedback_type: "comment",
        content: "Test",
        agent: "claude-code",
        anchor,
      });

      deleteIssue(db, "i-001");

      const feedback = getFeedbackForIssue(db, "i-001");
      expect(feedback).toHaveLength(0);
    });

    it("should cascade delete when spec is deleted", () => {
      const anchor: FeedbackAnchor = { anchor_status: "valid" };

      createFeedback(db, {
        from_id: "i-001",
        to_id: "s-001",
        feedback_type: "comment",
        content: "Test",
        agent: "claude-code",
        anchor,
      });

      deleteSpec(db, "s-001");

      const feedback = getFeedbackForSpec(db, "s-001");
      expect(feedback).toHaveLength(0);
    });
  });

  describe("Anchor JSON serialization", () => {
    it("should correctly serialize and deserialize complex anchors", () => {
      const anchor: FeedbackAnchor = {
        section_heading: "Implementation Details",
        section_level: 3,
        line_number: 127,
        line_offset: 5,
        text_snippet: "async function handleAuth",
        context_before: "Authentication flow:",
        context_after: "return tokens;",
        content_hash: "abc123",
        anchor_status: "relocated",
        last_verified_at: "2025-01-15T10:30:00Z",
        original_location: {
          line_number: 120,
          section_heading: "Auth Implementation",
        },
      };

      const created = createFeedback(db, {
        from_id: "i-001",
        to_id: "s-001",
        feedback_type: "comment",
        content: "Performance concern",
        agent: "claude-code",
        anchor,
      });

      const retrieved = getFeedback(db, created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.anchor).toBeDefined();

      const parsedAnchor = JSON.parse(retrieved!.anchor!);
      expect(parsedAnchor).toEqual(anchor);
    });
  });
});

describe("Generalized Feedback Operations", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase({ path: ":memory:" });

    // Create test entities
    createSpec(db, {
      id: "s-abc",
      title: "Test Spec",
      file_path: "specs/test.md",
      content: "Test spec content",
      priority: 2,
    });

    createIssue(db, { id: "i-001", title: "Issue 1" });
    createIssue(db, { id: "i-002", title: "Issue 2" });
    createIssue(db, { id: "i-003", title: "Issue 3" });
  });

  describe("getEntityTypeFromId", () => {
    it("should infer spec from s- prefix", () => {
      expect(getEntityTypeFromId("s-abc")).toBe("spec");
      expect(getEntityTypeFromId("s-xyz123")).toBe("spec");
    });

    it("should infer issue from i- prefix", () => {
      expect(getEntityTypeFromId("i-001")).toBe("issue");
      expect(getEntityTypeFromId("i-xyz")).toBe("issue");
    });

    it("should infer from legacy IDs", () => {
      expect(getEntityTypeFromId("SPEC-001")).toBe("spec");
      expect(getEntityTypeFromId("ISSUE-042")).toBe("issue");
    });

    it("should throw on invalid ID", () => {
      expect(() => getEntityTypeFromId("invalid")).toThrow();
    });
  });

  describe("Issue→Spec feedback", () => {
    it("should create feedback from issue to spec", () => {
      const anchor: FeedbackAnchor = {
        section_heading: "API Design",
        line_number: 25,
        anchor_status: "valid",
      };

      const feedback = createFeedback(db, {
        from_id: "i-001",
        to_id: "s-abc",
        feedback_type: "comment",
        content: "Implementation complete, all tests passing",
        agent: "claude-code",
        anchor,
      });

      expect(feedback.from_id).toBe("i-001");
      expect(feedback.to_id).toBe("s-abc");
      expect(feedback.feedback_type).toBe("comment");
      expect(getEntityTypeFromId(feedback.to_id)).toBe("spec");
    });

    it("should list feedback for a spec", () => {
      createFeedback(db, {
        from_id: "i-001",
        to_id: "s-abc",
        feedback_type: "comment",
        content: "Feedback 1",
      });

      createFeedback(db, {
        from_id: "i-002",
        to_id: "s-abc",
        feedback_type: "suggestion",
        content: "Feedback 2",
      });

      const feedbackList = getFeedbackForSpec(db, "s-abc");
      expect(feedbackList).toHaveLength(2);
    });
  });

  describe("Issue→Issue feedback", () => {
    it("should create feedback from issue to issue", () => {
      const feedback = createFeedback(db, {
        from_id: "i-001",
        to_id: "i-002",
        feedback_type: "suggestion",
        content: "FYI: Discovered rate limiting affects this issue too",
        agent: "claude-code",
      });

      expect(feedback.from_id).toBe("i-001");
      expect(feedback.to_id).toBe("i-002");
      expect(getEntityTypeFromId(feedback.to_id)).toBe("issue");
    });

    it("should list feedback from an issue", () => {
      createFeedback(db, {
        from_id: "i-001",
        to_id: "s-abc",
        feedback_type: "comment",
        content: "To spec",
      });

      createFeedback(db, {
        from_id: "i-001",
        to_id: "i-002",
        feedback_type: "suggestion",
        content: "To issue",
      });

      const fromFeedback = getFeedbackFromIssue(db, "i-001");
      expect(fromFeedback).toHaveLength(2);
    });

    it("should list feedback for an issue (receiving)", () => {
      createFeedback(db, {
        from_id: "i-001",
        to_id: "i-003",
        feedback_type: "request",
        content: "Question about implementation",
      });

      createFeedback(db, {
        from_id: "i-002",
        to_id: "i-003",
        feedback_type: "comment",
        content: "Note for this issue",
      });

      // Use getFeedbackForTarget to get feedback TO an issue
      const forIssue = getFeedbackForTarget(db, "i-003");
      expect(forIssue).toHaveLength(2);
    });

    it("should support feedback without anchors (general)", () => {
      const feedback = createFeedback(db, {
        from_id: "i-001",
        to_id: "i-002",
        feedback_type: "comment",
        content: "General note without specific location",
      });

      // SQLite returns null for missing values
      expect(feedback.anchor).toBeNull();
    });
  });

  describe("Mixed feedback scenarios", () => {
    it("should handle multiple feedback paths", () => {
      // i-001 provides feedback to spec
      createFeedback(db, {
        from_id: "i-001",
        to_id: "s-abc",
        feedback_type: "comment",
        content: "Spec implemented",
      });

      // i-001 provides feedback to i-002
      createFeedback(db, {
        from_id: "i-001",
        to_id: "i-002",
        feedback_type: "suggestion",
        content: "Watch out for rate limits",
      });

      // i-002 provides feedback to i-003
      createFeedback(db, {
        from_id: "i-002",
        to_id: "i-003",
        feedback_type: "request",
        content: "Need clarification",
      });

      const i001Feedback = getFeedbackFromIssue(db, "i-001");
      const i002Receiving = getFeedbackForIssue(db, "i-002");
      const specFeedback = getFeedbackForSpec(db, "s-abc");

      expect(i001Feedback).toHaveLength(2);
      expect(i002Receiving).toHaveLength(1);
      expect(specFeedback).toHaveLength(1);
    });
  });

  describe("Filtering", () => {
    beforeEach(() => {
      createFeedback(db, {
        from_id: "i-001",
        to_id: "s-abc",
        feedback_type: "comment",
        content: "Comment 1",
      });

      createFeedback(db, {
        from_id: "i-001",
        to_id: "i-002",
        feedback_type: "suggestion",
        content: "Suggestion 1",
      });

      createFeedback(db, {
        from_id: "i-002",
        to_id: "i-003",
        feedback_type: "comment",
        content: "Comment 2",
      });
    });

    it("should filter by from_id", () => {
      const feedback = listFeedback(db, { from_id: "i-001" });
      expect(feedback).toHaveLength(2);
    });

    it("should filter by to_id", () => {
      const feedback = listFeedback(db, { to_id: "i-002" });
      expect(feedback).toHaveLength(1);
    });

    it("should filter by feedback_type", () => {
      const comments = listFeedback(db, { feedback_type: "comment" });
      expect(comments).toHaveLength(2);

      const suggestions = listFeedback(db, { feedback_type: "suggestion" });
      expect(suggestions).toHaveLength(1);
    });
  });
});
