import { describe, it, expect, beforeEach } from "vitest";
import express, { Express } from "express";
import request from "supertest";
import { createAgentsRouter } from "../../../src/routes/agents.js";

describe("Agents API Routes", () => {
  let app: Express;

  beforeEach(() => {
    // Setup Express app with agents router
    app = express();
    app.use(express.json());
    app.use("/api/agents", createAgentsRouter());
  });

  describe("GET /api/agents", () => {
    it("should return list of all registered agents", async () => {
      const response = await request(app).get("/api/agents");

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("agents");
      expect(Array.isArray(response.body.agents)).toBe(true);
      expect(response.body.agents.length).toBeGreaterThan(0);
    });

    it("should return all 6 agents (claude-code, codex, gemini, opencode, copilot, cursor)", async () => {
      const response = await request(app).get("/api/agents");

      expect(response.status).toBe(200);
      expect(response.body.agents).toHaveLength(6);

      const agentTypes = response.body.agents.map((a: any) => a.type);
      expect(agentTypes).toContain("claude-code");
      expect(agentTypes).toContain("codex");
      expect(agentTypes).toContain("gemini");
      expect(agentTypes).toContain("opencode");
      expect(agentTypes).toContain("copilot");
      expect(agentTypes).toContain("cursor");
    });

    it("should include complete metadata for each agent", async () => {
      const response = await request(app).get("/api/agents");

      expect(response.status).toBe(200);

      const agent = response.body.agents[0];
      expect(agent).toHaveProperty("type");
      expect(agent).toHaveProperty("displayName");
      expect(agent).toHaveProperty("supportedModes");
      expect(agent).toHaveProperty("supportsStreaming");
      expect(agent).toHaveProperty("supportsStructuredOutput");
      expect(agent).toHaveProperty("implemented");
    });

    it("should identify Claude Code as implemented", async () => {
      const response = await request(app).get("/api/agents");

      expect(response.status).toBe(200);

      const claudeAgent = response.body.agents.find(
        (a: any) => a.type === "claude-code"
      );
      expect(claudeAgent).toBeDefined();
      expect(claudeAgent.implemented).toBe(true);
    });

    it("should identify copilot as implemented", async () => {
      const response = await request(app).get("/api/agents");

      expect(response.status).toBe(200);
      const copilotAgent = response.body.agents.find(
        (a: any) => a.type === "copilot"
      );

      // Copilot is now implemented
      expect(copilotAgent.implemented).toBe(true);
    });

    it("should include supportedModes for each agent", async () => {
      const response = await request(app).get("/api/agents");

      expect(response.status).toBe(200);

      const claudeAgent = response.body.agents.find(
        (a: any) => a.type === "claude-code"
      );
      expect(claudeAgent.supportedModes).toBeDefined();
      expect(Array.isArray(claudeAgent.supportedModes)).toBe(true);
      expect(claudeAgent.supportedModes.length).toBeGreaterThan(0);
    });

    it("should return consistent data structure across requests", async () => {
      const response1 = await request(app).get("/api/agents");
      const response2 = await request(app).get("/api/agents");

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);
      expect(response1.body).toEqual(response2.body);
    });
  });
});
