import { describe, it, expect, beforeEach, vi } from "vitest";
import express, { Express } from "express";
import request from "supertest";
import { createUpdateRouter } from "../../../src/routes/update.js";

// Mock the CLI update-checker module
vi.mock("@sudocode-ai/cli/update-checker", () => ({
  checkForUpdates: vi.fn(),
  dismissUpdate: vi.fn(),
  isOlderVersion: vi.fn(),
}));

// Mock child_process for install and restart tests
vi.mock("child_process", () => ({
  execSync: vi.fn(),
  spawn: vi.fn(() => ({
    unref: vi.fn(),
  })),
}));

// Import mocked modules
import {
  checkForUpdates,
  dismissUpdate,
  isOlderVersion,
} from "@sudocode-ai/cli/update-checker";
import { execSync } from "child_process";

describe("Update API Routes", () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup Express app with update router
    app = express();
    app.use(express.json());
    app.use("/api/update", createUpdateRouter());
  });

  describe("GET /api/update/check", () => {
    it("should return update info when update is available", async () => {
      vi.mocked(checkForUpdates).mockResolvedValue({
        current: "0.1.15",
        latest: "0.1.16",
        updateAvailable: true,
      });
      vi.mocked(isOlderVersion).mockReturnValue(true);

      const response = await request(app).get("/api/update/check");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({
        current: "0.1.15",
        latest: "0.1.16",
        updateAvailable: true,
      });
    });

    it("should return updateAvailable: false when current version is newer", async () => {
      vi.mocked(checkForUpdates).mockResolvedValue({
        current: "0.2.0",
        latest: "0.1.16",
        updateAvailable: true, // CLI says different, but we check with isOlderVersion
      });
      vi.mocked(isOlderVersion).mockReturnValue(false); // 0.2.0 is not older than 0.1.16

      const response = await request(app).get("/api/update/check");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.updateAvailable).toBe(false);
    });

    it("should return updateAvailable: false when versions are the same", async () => {
      vi.mocked(checkForUpdates).mockResolvedValue({
        current: "0.1.15",
        latest: "0.1.15",
        updateAvailable: false,
      });
      vi.mocked(isOlderVersion).mockReturnValue(false);

      const response = await request(app).get("/api/update/check");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({
        current: "0.1.15",
        latest: "0.1.15",
        updateAvailable: false,
      });
    });

    it("should handle network errors gracefully", async () => {
      vi.mocked(checkForUpdates).mockResolvedValue(null);

      const response = await request(app).get("/api/update/check");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({
        current: "unknown",
        latest: "unknown",
        updateAvailable: false,
      });
    });

    it("should return 500 on unexpected errors", async () => {
      vi.mocked(checkForUpdates).mockRejectedValue(new Error("Unexpected error"));

      const response = await request(app).get("/api/update/check");

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("Failed to check for updates");
    });
  });

  describe("POST /api/update/install", () => {
    it("should successfully install update for sudocode metapackage", async () => {
      // First call to detect package - sudocode metapackage exists
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes("npm list -g sudocode")) {
          return Buffer.from("sudocode@1.1.15");
        }
        return Buffer.from("");
      });

      const response = await request(app).post("/api/update/install");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.requiresRestart).toBe(true);
      expect(response.body.data.message).toContain("sudocode");
    });

    it("should fall back to @sudocode-ai/cli when metapackage not installed", async () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes("npm list -g sudocode --depth=0")) {
          throw new Error("Not found");
        }
        return Buffer.from("");
      });

      const response = await request(app).post("/api/update/install");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it("should retry with --force on EEXIST error", async () => {
      let callCount = 0;
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes("npm list -g sudocode --depth=0")) {
          return Buffer.from("sudocode@1.1.15");
        }
        if (cmd.includes("npm install -g")) {
          callCount++;
          if (callCount === 1 && !cmd.includes("--force")) {
            const error = new Error("EEXIST: file already exists");
            throw error;
          }
          return Buffer.from("");
        }
        return Buffer.from("");
      });

      const response = await request(app).post("/api/update/install");

      expect(response.status).toBe(200);
      expect(callCount).toBe(2); // First attempt + retry with --force
    });

    it("should return 500 on installation failure", async () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes("npm list -g sudocode --depth=0")) {
          return Buffer.from("sudocode@1.1.15");
        }
        if (cmd.includes("npm install -g")) {
          throw new Error("Permission denied");
        }
        return Buffer.from("");
      });

      const response = await request(app).post("/api/update/install");

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain("Permission denied");
      expect(response.body.manualCommand).toBe("npm install -g sudocode@latest");
    });
  });

  describe("POST /api/update/dismiss", () => {
    it("should dismiss update notification for specified version", async () => {
      const response = await request(app)
        .post("/api/update/dismiss")
        .send({ version: "0.1.16" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.message).toContain("0.1.16");
      expect(dismissUpdate).toHaveBeenCalledWith("0.1.16");
    });

    it("should return 400 when version is missing", async () => {
      const response = await request(app)
        .post("/api/update/dismiss")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe("Version is required");
    });

    it("should handle dismiss errors", async () => {
      vi.mocked(dismissUpdate).mockImplementation(() => {
        throw new Error("Failed to write dismiss file");
      });

      const response = await request(app)
        .post("/api/update/dismiss")
        .send({ version: "0.1.16" });

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
    });
  });

  describe("POST /api/update/restart", () => {
    it("should respond with success before restarting", async () => {
      // Mock process.exit to not actually exit
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("EXIT");
      });

      // This test verifies the response is sent before restart logic
      // The actual restart spawns a new process and exits, which we can't fully test
      const response = await request(app).post("/api/update/restart");

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.message).toBe("Server is restarting...");

      exitSpy.mockRestore();
    });
  });
});
