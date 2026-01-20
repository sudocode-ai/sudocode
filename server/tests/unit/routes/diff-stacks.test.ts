/**
 * Unit tests for diff-stacks routes
 *
 * Tests the Phase 3 diff stack API routes including CRUD operations,
 * checkpoint grouping, review workflow, queue management, and merge execution.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express, { Express, Request, Response, NextFunction } from "express";
import request from "supertest";

// Create mock using vi.hoisted to ensure it's available before mock factory runs
const mockGetDataplaneAdapterSync = vi.hoisted(() => vi.fn());

// Mock the dataplane adapter module
vi.mock("../../../src/services/dataplane-adapter.js", () => ({
  getDataplaneAdapterSync: mockGetDataplaneAdapterSync,
}));

// Import after mock is set up
import { createDiffStacksRouter } from "../../../src/routes/diff-stacks.js";

// Extend Express Request type for tests
declare global {
  namespace Express {
    interface Request {
      project?: { path: string };
    }
  }
}

describe("diff-stacks routes", () => {
  let app: Express;
  let mockAdapter: any;
  let mockDiffStacksModule: any;
  let mockDb: any;

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());

    // Create mock DB
    mockDb = {
      prepare: vi.fn().mockReturnValue({
        run: vi.fn(),
        get: vi.fn(),
        all: vi.fn(),
      }),
    };

    // Create mock diff stacks module
    mockDiffStacksModule = {
      getDiffStack: vi.fn(),
      getDiffStackWithCheckpoints: vi.fn(),
      createDiffStack: vi.fn(),
      deleteDiffStack: vi.fn(),
      listDiffStacks: vi.fn(),
      getQueuedStacks: vi.fn(),
      getCheckpointsInStack: vi.fn(),
      addCheckpointToStack: vi.fn(),
      removeCheckpointFromStack: vi.fn(),
      reorderStackCheckpoints: vi.fn(),
      setStackReviewStatus: vi.fn(),
      enqueueStack: vi.fn(),
      dequeueStack: vi.fn(),
      isValidStatusTransition: vi.fn(),
    };

    // Create mock adapter
    mockAdapter = {
      isInitialized: true,
      diffStacksModule: mockDiffStacksModule,
      db: mockDb,
      tracker: {
        getStream: vi.fn(),
      },
    };

    // Set default mock return value
    mockGetDataplaneAdapterSync.mockReturnValue(mockAdapter);

    // Mock middleware to set project
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.project = { path: "/test/project" };
      next();
    });

    app.use("/api/diff-stacks", createDiffStacksRouter());
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("GET /api/diff-stacks", () => {
    it("lists all diff stacks with checkpoints by default", async () => {
      const mockStacks = [
        { id: "stack-1", name: "Stack 1", reviewStatus: "pending" },
        { id: "stack-2", name: "Stack 2", reviewStatus: "approved" },
      ];

      mockDiffStacksModule.listDiffStacks.mockReturnValue(mockStacks);
      mockDiffStacksModule.getCheckpointsInStack
        .mockReturnValueOnce([{ id: "cp-1", commitSha: "abc123" }])
        .mockReturnValueOnce([{ id: "cp-2", commitSha: "def456" }]);

      const res = await request(app)
        .get("/api/diff-stacks")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.stacks).toHaveLength(2);
      expect(res.body.data.stacks[0].checkpoints).toBeDefined();
      expect(res.body.data.total).toBe(2);
    });

    it("filters by review_status", async () => {
      mockDiffStacksModule.listDiffStacks.mockReturnValue([
        { id: "stack-1", reviewStatus: "approved" },
      ]);
      mockDiffStacksModule.getCheckpointsInStack.mockReturnValue([]);

      const res = await request(app)
        .get("/api/diff-stacks?review_status=approved")
        .expect(200);

      expect(mockDiffStacksModule.listDiffStacks).toHaveBeenCalledWith(
        mockDb,
        { reviewStatus: "approved", targetBranch: undefined }
      );
    });

    it("filters by target_branch", async () => {
      mockDiffStacksModule.listDiffStacks.mockReturnValue([]);

      await request(app)
        .get("/api/diff-stacks?target_branch=develop")
        .expect(200);

      expect(mockDiffStacksModule.listDiffStacks).toHaveBeenCalledWith(
        mockDb,
        { reviewStatus: undefined, targetBranch: "develop" }
      );
    });

    it("excludes checkpoints when include_checkpoints=false", async () => {
      mockDiffStacksModule.listDiffStacks.mockReturnValue([
        { id: "stack-1", name: "Stack 1" },
      ]);

      const res = await request(app)
        .get("/api/diff-stacks?include_checkpoints=false")
        .expect(200);

      expect(mockDiffStacksModule.getCheckpointsInStack).not.toHaveBeenCalled();
      expect(res.body.data.stacks[0].checkpoints).toBeUndefined();
    });

    it("returns queued stacks only when queued_only=true", async () => {
      mockDiffStacksModule.getQueuedStacks.mockReturnValue([
        { id: "stack-1", queuePosition: 1 },
      ]);
      mockDiffStacksModule.getCheckpointsInStack.mockReturnValue([]);

      const res = await request(app)
        .get("/api/diff-stacks?queued_only=true")
        .expect(200);

      expect(mockDiffStacksModule.getQueuedStacks).toHaveBeenCalledWith(
        mockDb,
        "main"
      );
      expect(mockDiffStacksModule.listDiffStacks).not.toHaveBeenCalled();
    });

    it("returns 503 when dataplane not initialized", async () => {
      mockGetDataplaneAdapterSync.mockReturnValue(null);

      const res = await request(app)
        .get("/api/diff-stacks")
        .expect(503);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("Dataplane not initialized");
    });
  });

  describe("GET /api/diff-stacks/:id", () => {
    it("returns diff stack with checkpoints", async () => {
      const mockStack = {
        id: "stack-1",
        name: "My Stack",
        reviewStatus: "pending",
        checkpoints: [{ id: "cp-1" }],
      };
      mockDiffStacksModule.getDiffStackWithCheckpoints.mockReturnValue(mockStack);

      const res = await request(app)
        .get("/api/diff-stacks/stack-1")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockStack);
    });

    it("returns 404 when stack not found", async () => {
      mockDiffStacksModule.getDiffStackWithCheckpoints.mockReturnValue(null);

      const res = await request(app)
        .get("/api/diff-stacks/nonexistent")
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("not found");
    });
  });

  describe("POST /api/diff-stacks", () => {
    it("creates new diff stack", async () => {
      const newStack = {
        id: "stack-new",
        name: "New Stack",
        description: "A new stack",
        reviewStatus: "pending",
      };
      mockDiffStacksModule.createDiffStack.mockReturnValue(newStack);

      const res = await request(app)
        .post("/api/diff-stacks")
        .send({
          name: "New Stack",
          description: "A new stack",
          target_branch: "main",
          checkpoint_ids: ["cp-1", "cp-2"],
          created_by: "user-1",
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(newStack);
      expect(mockDiffStacksModule.createDiffStack).toHaveBeenCalledWith(
        mockDb,
        {
          name: "New Stack",
          description: "A new stack",
          targetBranch: "main",
          checkpointIds: ["cp-1", "cp-2"],
          createdBy: "user-1",
        }
      );
    });

    it("creates stack with minimal options", async () => {
      mockDiffStacksModule.createDiffStack.mockReturnValue({ id: "stack-min" });

      const res = await request(app)
        .post("/api/diff-stacks")
        .send({})
        .expect(201);

      expect(res.body.success).toBe(true);
    });
  });

  describe("PUT /api/diff-stacks/:id", () => {
    it("updates stack name and description", async () => {
      mockDiffStacksModule.getDiffStack
        .mockReturnValueOnce({ id: "stack-1", name: "Old Name" })
        .mockReturnValueOnce({ id: "stack-1", name: "New Name" });

      const res = await request(app)
        .put("/api/diff-stacks/stack-1")
        .send({ name: "New Name", description: "New description" })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(mockDb.prepare).toHaveBeenCalled();
    });

    it("returns 404 when stack not found", async () => {
      mockDiffStacksModule.getDiffStack.mockReturnValue(null);

      const res = await request(app)
        .put("/api/diff-stacks/nonexistent")
        .send({ name: "Test" })
        .expect(404);

      expect(res.body.success).toBe(false);
    });
  });

  describe("DELETE /api/diff-stacks/:id", () => {
    it("deletes diff stack", async () => {
      mockDiffStacksModule.deleteDiffStack.mockReturnValue(true);

      const res = await request(app)
        .delete("/api/diff-stacks/stack-1")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(mockDiffStacksModule.deleteDiffStack).toHaveBeenCalledWith(
        mockDb,
        "stack-1"
      );
    });

    it("returns 404 when stack not found", async () => {
      mockDiffStacksModule.deleteDiffStack.mockReturnValue(false);

      const res = await request(app)
        .delete("/api/diff-stacks/nonexistent")
        .expect(404);

      expect(res.body.success).toBe(false);
    });
  });

  describe("POST /api/diff-stacks/:id/checkpoints", () => {
    it("adds single checkpoint to stack", async () => {
      mockDiffStacksModule.getDiffStack.mockReturnValue({ id: "stack-1" });
      mockDiffStacksModule.addCheckpointToStack.mockReturnValue({
        stackId: "stack-1",
        checkpointId: "cp-1",
        position: 0,
      });

      const res = await request(app)
        .post("/api/diff-stacks/stack-1/checkpoints")
        .send({ checkpoint_id: "cp-1" })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.checkpointId).toBe("cp-1");
    });

    it("adds multiple checkpoints to stack", async () => {
      mockDiffStacksModule.getDiffStack.mockReturnValue({ id: "stack-1" });
      mockDiffStacksModule.addCheckpointToStack
        .mockReturnValueOnce({ checkpointId: "cp-1", position: 0 })
        .mockReturnValueOnce({ checkpointId: "cp-2", position: 1 });

      const res = await request(app)
        .post("/api/diff-stacks/stack-1/checkpoints")
        .send({ checkpoint_ids: ["cp-1", "cp-2"] })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(2);
    });

    it("adds checkpoints at specific position", async () => {
      mockDiffStacksModule.getDiffStack.mockReturnValue({ id: "stack-1" });
      mockDiffStacksModule.addCheckpointToStack.mockReturnValue({
        checkpointId: "cp-1",
        position: 5,
      });

      await request(app)
        .post("/api/diff-stacks/stack-1/checkpoints")
        .send({ checkpoint_id: "cp-1", position: 5 })
        .expect(201);

      expect(mockDiffStacksModule.addCheckpointToStack).toHaveBeenCalledWith(
        mockDb,
        { stackId: "stack-1", checkpointId: "cp-1", position: 5 }
      );
    });

    it("returns 400 when no checkpoint_id provided", async () => {
      mockDiffStacksModule.getDiffStack.mockReturnValue({ id: "stack-1" });

      const res = await request(app)
        .post("/api/diff-stacks/stack-1/checkpoints")
        .send({})
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("checkpoint_id");
    });

    it("returns 404 when stack not found", async () => {
      mockDiffStacksModule.getDiffStack.mockReturnValue(null);

      const res = await request(app)
        .post("/api/diff-stacks/nonexistent/checkpoints")
        .send({ checkpoint_id: "cp-1" })
        .expect(404);

      expect(res.body.success).toBe(false);
    });
  });

  describe("DELETE /api/diff-stacks/:id/checkpoints/:cpId", () => {
    it("removes checkpoint from stack", async () => {
      mockDiffStacksModule.removeCheckpointFromStack.mockReturnValue(true);

      const res = await request(app)
        .delete("/api/diff-stacks/stack-1/checkpoints/cp-1")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(mockDiffStacksModule.removeCheckpointFromStack).toHaveBeenCalledWith(
        mockDb,
        "stack-1",
        "cp-1"
      );
    });

    it("returns 404 when checkpoint not in stack", async () => {
      mockDiffStacksModule.removeCheckpointFromStack.mockReturnValue(false);

      const res = await request(app)
        .delete("/api/diff-stacks/stack-1/checkpoints/cp-999")
        .expect(404);

      expect(res.body.success).toBe(false);
    });
  });

  describe("PUT /api/diff-stacks/:id/checkpoints/reorder", () => {
    it("reorders checkpoints in stack", async () => {
      mockDiffStacksModule.reorderStackCheckpoints.mockReturnValue(undefined);

      const res = await request(app)
        .put("/api/diff-stacks/stack-1/checkpoints/reorder")
        .send({ checkpoint_ids: ["cp-3", "cp-1", "cp-2"] })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(mockDiffStacksModule.reorderStackCheckpoints).toHaveBeenCalledWith(
        mockDb,
        "stack-1",
        ["cp-3", "cp-1", "cp-2"]
      );
    });

    it("returns 400 when checkpoint_ids not provided", async () => {
      const res = await request(app)
        .put("/api/diff-stacks/stack-1/checkpoints/reorder")
        .send({})
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("checkpoint_ids");
    });
  });

  describe("POST /api/diff-stacks/:id/review", () => {
    it("sets review status to approved", async () => {
      mockDiffStacksModule.getDiffStack.mockReturnValue({
        id: "stack-1",
        reviewStatus: "pending",
      });
      mockDiffStacksModule.isValidStatusTransition.mockReturnValue(true);
      mockDiffStacksModule.setStackReviewStatus.mockReturnValue({
        id: "stack-1",
        reviewStatus: "approved",
      });

      const res = await request(app)
        .post("/api/diff-stacks/stack-1/review")
        .send({
          status: "approved",
          reviewed_by: "reviewer-1",
          notes: "LGTM",
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.reviewStatus).toBe("approved");
      expect(mockDiffStacksModule.setStackReviewStatus).toHaveBeenCalledWith(
        mockDb,
        {
          stackId: "stack-1",
          status: "approved",
          reviewedBy: "reviewer-1",
          notes: "LGTM",
        }
      );
    });

    it("rejects invalid status transition", async () => {
      mockDiffStacksModule.getDiffStack.mockReturnValue({
        id: "stack-1",
        reviewStatus: "merged",
      });
      mockDiffStacksModule.isValidStatusTransition.mockReturnValue(false);

      const res = await request(app)
        .post("/api/diff-stacks/stack-1/review")
        .send({ status: "pending" })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("Invalid status transition");
    });

    it("returns 400 when status not provided", async () => {
      const res = await request(app)
        .post("/api/diff-stacks/stack-1/review")
        .send({})
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("status is required");
    });

    it("returns 404 when stack not found", async () => {
      mockDiffStacksModule.getDiffStack.mockReturnValue(null);

      const res = await request(app)
        .post("/api/diff-stacks/nonexistent/review")
        .send({ status: "approved" })
        .expect(404);

      expect(res.body.success).toBe(false);
    });
  });

  describe("POST /api/diff-stacks/:id/enqueue", () => {
    it("adds approved stack to merge queue", async () => {
      mockDiffStacksModule.enqueueStack.mockReturnValue({
        id: "stack-1",
        queuePosition: 1,
      });

      const res = await request(app)
        .post("/api/diff-stacks/stack-1/enqueue")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.queuePosition).toBe(1);
    });

    it("returns 400 when stack cannot be queued", async () => {
      mockDiffStacksModule.enqueueStack.mockReturnValue(null);

      const res = await request(app)
        .post("/api/diff-stacks/stack-1/enqueue")
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("must be approved");
    });
  });

  describe("DELETE /api/diff-stacks/:id/enqueue", () => {
    it("removes stack from merge queue", async () => {
      mockDiffStacksModule.dequeueStack.mockReturnValue({
        id: "stack-1",
        queuePosition: null,
      });

      const res = await request(app)
        .delete("/api/diff-stacks/stack-1/enqueue")
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(mockDiffStacksModule.dequeueStack).toHaveBeenCalledWith(
        mockDb,
        "stack-1"
      );
    });

    it("returns 404 when stack not in queue", async () => {
      mockDiffStacksModule.dequeueStack.mockReturnValue(null);

      const res = await request(app)
        .delete("/api/diff-stacks/stack-1/enqueue")
        .expect(404);

      expect(res.body.success).toBe(false);
    });
  });

  describe("POST /api/diff-stacks/:id/merge", () => {
    it("returns 404 when stack not found", async () => {
      mockDiffStacksModule.getDiffStackWithCheckpoints.mockReturnValue(null);

      const res = await request(app)
        .post("/api/diff-stacks/nonexistent/merge")
        .expect(404);

      expect(res.body.success).toBe(false);
    });

    it("returns 400 when stack not approved", async () => {
      mockDiffStacksModule.getDiffStackWithCheckpoints.mockReturnValue({
        id: "stack-1",
        reviewStatus: "pending",
        checkpoints: [],
      });

      const res = await request(app)
        .post("/api/diff-stacks/stack-1/merge")
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("must be approved");
    });

    it("returns 400 when stack has no checkpoints", async () => {
      mockDiffStacksModule.getDiffStackWithCheckpoints.mockReturnValue({
        id: "stack-1",
        reviewStatus: "approved",
        targetBranch: "main",
        checkpoints: [],
      });

      const res = await request(app)
        .post("/api/diff-stacks/stack-1/merge")
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("no checkpoints");
    });
  });
});
