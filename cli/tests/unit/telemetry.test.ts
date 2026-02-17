import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  recordEvent,
  maybeFlush,
  buildOtlpPayload,
  extractAttributes,
  ensureProjectId,
  ensureInstallationId,
  getInstallationConfigDir,
  getTelemetryConfig,
} from "../../src/telemetry.js";

describe("Telemetry", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-telemetry-test-"));
    // Create minimal config files
    fs.writeFileSync(
      path.join(tmpDir, "config.json"),
      JSON.stringify({}),
      "utf8"
    );
    fs.writeFileSync(
      path.join(tmpDir, "config.local.json"),
      JSON.stringify({}),
      "utf8"
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("recordEvent", () => {
    it("should append event to buffer file", () => {
      recordEvent(tmpDir, {
        cmd: "upsert_issue",
        success: true,
        dur: 142,
        attrs: { "entity.id": "i-7k9x", "entity.type": "issue" },
      });

      const bufferPath = path.join(tmpDir, "telemetry-buffer.jsonl");
      expect(fs.existsSync(bufferPath)).toBe(true);

      const content = fs.readFileSync(bufferPath, "utf8").trim();
      const parsed = JSON.parse(content);
      expect(parsed.cmd).toBe("upsert_issue");
      expect(parsed.success).toBe(true);
      expect(parsed.dur).toBe(142);
      expect(parsed.attrs["entity.id"]).toBe("i-7k9x");
      expect(parsed.ts).toBeGreaterThan(0);
    });

    it("should append multiple events as separate lines", () => {
      recordEvent(tmpDir, { cmd: "show_issue", success: true, dur: 45 });
      recordEvent(tmpDir, { cmd: "link", success: true, dur: 87 });

      const bufferPath = path.join(tmpDir, "telemetry-buffer.jsonl");
      const lines = fs.readFileSync(bufferPath, "utf8").trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).cmd).toBe("show_issue");
      expect(JSON.parse(lines[1]).cmd).toBe("link");
    });

    it("should include session ID when provided", () => {
      recordEvent(tmpDir, {
        cmd: "ready",
        success: true,
        dur: 30,
        sid: "sess-abc123",
      });

      const bufferPath = path.join(tmpDir, "telemetry-buffer.jsonl");
      const parsed = JSON.parse(
        fs.readFileSync(bufferPath, "utf8").trim()
      );
      expect(parsed.sid).toBe("sess-abc123");
    });

    it("should omit session ID when not provided", () => {
      recordEvent(tmpDir, { cmd: "ready", success: true, dur: 30 });

      const bufferPath = path.join(tmpDir, "telemetry-buffer.jsonl");
      const parsed = JSON.parse(
        fs.readFileSync(bufferPath, "utf8").trim()
      );
      expect(parsed.sid).toBeUndefined();
    });

    it("should strip undefined values from attrs", () => {
      recordEvent(tmpDir, {
        cmd: "issue_update",
        success: true,
        dur: 100,
        attrs: {
          "entity.id": "i-7k9x",
          "entity.status": undefined,
          "entity.archived": undefined,
        },
      });

      const bufferPath = path.join(tmpDir, "telemetry-buffer.jsonl");
      const parsed = JSON.parse(
        fs.readFileSync(bufferPath, "utf8").trim()
      );
      expect(parsed.attrs["entity.id"]).toBe("i-7k9x");
      expect(parsed.attrs).not.toHaveProperty("entity.status");
      expect(parsed.attrs).not.toHaveProperty("entity.archived");
    });

    it("should not throw on file system errors", () => {
      // Use a path that doesn't exist
      expect(() => {
        recordEvent("/nonexistent/path", {
          cmd: "ready",
          success: true,
          dur: 10,
        });
      }).not.toThrow();
    });
  });

  describe("buildOtlpPayload", () => {
    const config = {
      endpoint: "https://example.com/v1/logs",
      authHeader: "Basic dGVzdA==",
      projectId: "proj-test1234",
      installationId: "inst-abcd5678",
      serviceVersion: "0.1.21",
    };

    it("should produce valid OTLP envelope structure", () => {
      const events = [
        { ts: 1707840000000, cmd: "upsert_issue", success: true, dur: 142 },
      ];

      const payload = buildOtlpPayload(events, config) as any;

      expect(payload.resourceLogs).toHaveLength(1);
      expect(payload.resourceLogs[0].resource.attributes).toEqual(
        expect.arrayContaining([
          { key: "service.name", value: { stringValue: "sudocode-cli" } },
          { key: "service.version", value: { stringValue: "0.1.21" } },
          {
            key: "project.id",
            value: { stringValue: "proj-test1234" },
          },
          {
            key: "installation.id",
            value: { stringValue: "inst-abcd5678" },
          },
        ])
      );

      const scopeLogs = payload.resourceLogs[0].scopeLogs;
      expect(scopeLogs).toHaveLength(1);
      expect(scopeLogs[0].scope).toEqual({
        name: "sudocode.usage",
        version: "1",
      });
    });

    it("should convert events to log records with correct attributes", () => {
      const events = [
        {
          ts: 1707840000000,
          cmd: "upsert_issue",
          success: true,
          dur: 142,
          sid: "sess-abc",
          attrs: {
            "entity.id": "i-7k9x",
            "entity.type": "issue",
            "entity.operation": "update",
          },
        },
      ];

      const payload = buildOtlpPayload(events, config) as any;
      const record = payload.resourceLogs[0].scopeLogs[0].logRecords[0];

      expect(record.severityNumber).toBe(9);
      expect(record.body).toEqual({ stringValue: "tool_call" });
      expect(record.timeUnixNano).toBe("1707840000000000000");

      const attrMap = Object.fromEntries(
        record.attributes.map((a: any) => [a.key, a.value])
      );
      expect(attrMap["tool.name"]).toEqual({ stringValue: "upsert_issue" });
      expect(attrMap["tool.success"]).toEqual({ boolValue: true });
      expect(attrMap["tool.duration_ms"]).toEqual({ intValue: "142" });
      expect(attrMap["session.id"]).toEqual({ stringValue: "sess-abc" });
      expect(attrMap["entity.id"]).toEqual({ stringValue: "i-7k9x" });
    });

    it("should handle boolean and number attribute values", () => {
      const events = [
        {
          ts: 1707840000000,
          cmd: "issue_update",
          success: false,
          dur: 50,
          attrs: { "entity.archived": true, "some.count": 42 },
        },
      ];

      const payload = buildOtlpPayload(events, config) as any;
      const record = payload.resourceLogs[0].scopeLogs[0].logRecords[0];
      const attrMap = Object.fromEntries(
        record.attributes.map((a: any) => [a.key, a.value])
      );

      expect(attrMap["tool.success"]).toEqual({ boolValue: false });
      expect(attrMap["entity.archived"]).toEqual({ boolValue: true });
      expect(attrMap["some.count"]).toEqual({ intValue: "42" });
    });

    it("should batch multiple events into one payload", () => {
      const events = [
        { ts: 1707840000000, cmd: "ready", success: true, dur: 30 },
        { ts: 1707840001000, cmd: "show_issue", success: true, dur: 45 },
        { ts: 1707840002000, cmd: "link", success: true, dur: 87 },
      ];

      const payload = buildOtlpPayload(events, config) as any;
      const records = payload.resourceLogs[0].scopeLogs[0].logRecords;
      expect(records).toHaveLength(3);
      expect(records[0].timeUnixNano).toBe("1707840000000000000");
      expect(records[2].timeUnixNano).toBe("1707840002000000000");
    });
  });

  describe("extractAttributes", () => {
    it("should extract issue create attributes", () => {
      const attrs = extractAttributes("issue_create", {});
      expect(attrs["entity.type"]).toBe("issue");
      expect(attrs["entity.operation"]).toBe("create");
    });

    it("should extract issue update attributes", () => {
      const attrs = extractAttributes("issue_update", {
        id: "i-7k9x",
        status: "in_progress",
        archived: false,
      });
      expect(attrs["entity.id"]).toBe("i-7k9x");
      expect(attrs["entity.type"]).toBe("issue");
      expect(attrs["entity.operation"]).toBe("update");
      expect(attrs["entity.status"]).toBe("in_progress");
      expect(attrs["entity.archived"]).toBe(false);
    });

    it("should extract show issue attributes", () => {
      const attrs = extractAttributes("issue_show", { id: "i-7k9x" });
      expect(attrs["entity.id"]).toBe("i-7k9x");
      expect(attrs["entity.type"]).toBe("issue");
    });

    it("should extract link attributes", () => {
      const attrs = extractAttributes("link", {
        from_id: "i-7k9x",
        to_id: "s-183k",
        type: "implements",
      });
      expect(attrs["link.from_id"]).toBe("i-7k9x");
      expect(attrs["link.to_id"]).toBe("s-183k");
      expect(attrs["link.type"]).toBe("implements");
    });

    it("should extract feedback attributes", () => {
      const attrs = extractAttributes("add_feedback", {
        to_id: "s-183k",
        from_id: "i-7k9x",
        feedback_type: "comment",
      });
      expect(attrs["feedback.to_id"]).toBe("s-183k");
      expect(attrs["feedback.from_id"]).toBe("i-7k9x");
      expect(attrs["feedback.type"]).toBe("comment");
    });

    it("should extract spec attributes", () => {
      const attrs = extractAttributes("spec_show", { id: "s-183k" });
      expect(attrs["entity.id"]).toBe("s-183k");
      expect(attrs["entity.type"]).toBe("spec");
    });

    it("should return empty object for unknown commands", () => {
      const attrs = extractAttributes("unknown_cmd", {});
      expect(Object.keys(attrs)).toHaveLength(0);
    });

    it("should return empty object for ready command", () => {
      const attrs = extractAttributes("ready", {});
      expect(Object.keys(attrs)).toHaveLength(0);
    });
  });

  describe("ensureProjectId", () => {
    it("should generate and persist project ID", () => {
      const id = ensureProjectId(tmpDir);
      expect(id).toMatch(/^proj-[a-f0-9]{8}$/);

      // Verify it was persisted
      const config = JSON.parse(
        fs.readFileSync(path.join(tmpDir, "config.json"), "utf8")
      );
      expect(config.telemetry.projectId).toBe(id);
    });

    it("should return existing ID on subsequent calls", () => {
      const id1 = ensureProjectId(tmpDir);
      const id2 = ensureProjectId(tmpDir);
      expect(id1).toBe(id2);
    });

    it("should return existing projectId from config", () => {
      fs.writeFileSync(
        path.join(tmpDir, "config.json"),
        JSON.stringify({ telemetry: { projectId: "proj-existing" } }),
        "utf8"
      );

      const id = ensureProjectId(tmpDir);
      expect(id).toBe("proj-existing");
    });

    it("should migrate from old anonymousId", () => {
      fs.writeFileSync(
        path.join(tmpDir, "config.json"),
        JSON.stringify({ telemetry: { anonymousId: "anon-oldvalue" } }),
        "utf8"
      );

      const id = ensureProjectId(tmpDir);
      expect(id).toBe("anon-oldvalue");

      // Verify it was migrated to projectId
      const config = JSON.parse(
        fs.readFileSync(path.join(tmpDir, "config.json"), "utf8")
      );
      expect(config.telemetry.projectId).toBe("anon-oldvalue");
    });
  });

  describe("ensureInstallationId", () => {
    let originalXdg: string | undefined;
    let installTmpDir: string;

    beforeEach(() => {
      // Use a temp directory for XDG_CONFIG_HOME so we don't pollute real config
      installTmpDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "sudocode-install-test-")
      );
      originalXdg = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = installTmpDir;
    });

    afterEach(() => {
      if (originalXdg !== undefined) {
        process.env.XDG_CONFIG_HOME = originalXdg;
      } else {
        delete process.env.XDG_CONFIG_HOME;
      }
      fs.rmSync(installTmpDir, { recursive: true, force: true });
    });

    it("should generate and persist installation ID", () => {
      const id = ensureInstallationId();
      expect(id).toMatch(/^inst-[a-f0-9]{8}$/);

      // Verify it was persisted
      const configPath = path.join(installTmpDir, "sudocode", "config.json");
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(config.telemetry.installationId).toBe(id);
    });

    it("should return existing ID on subsequent calls", () => {
      const id1 = ensureInstallationId();
      const id2 = ensureInstallationId();
      expect(id1).toBe(id2);
    });

    it("should return existing ID from config", () => {
      const configDir = path.join(installTmpDir, "sudocode");
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, "config.json"),
        JSON.stringify({ telemetry: { installationId: "inst-existing" } }),
        "utf8"
      );

      const id = ensureInstallationId();
      expect(id).toBe("inst-existing");
    });

    it("should preserve other config fields when writing", () => {
      const configDir = path.join(installTmpDir, "sudocode");
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, "config.json"),
        JSON.stringify({ someOtherField: "keep-me" }),
        "utf8"
      );

      ensureInstallationId();

      const config = JSON.parse(
        fs.readFileSync(path.join(configDir, "config.json"), "utf8")
      );
      expect(config.someOtherField).toBe("keep-me");
      expect(config.telemetry.installationId).toMatch(/^inst-[a-f0-9]{8}$/);
    });

    it("should respect XDG_CONFIG_HOME", () => {
      const id = ensureInstallationId();
      const configPath = path.join(installTmpDir, "sudocode", "config.json");
      expect(fs.existsSync(configPath)).toBe(true);

      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      expect(config.telemetry.installationId).toBe(id);
    });
  });

  describe("maybeFlush", () => {
    const config = {
      endpoint: "https://example.com/v1/logs",
      authHeader: "Basic dGVzdA==",
      projectId: "proj-test1234",
      installationId: "inst-abcd5678",
      serviceVersion: "0.1.21",
    };

    it("should not flush when buffer is empty", async () => {
      const fetchSpy = vi.spyOn(global, "fetch");
      await maybeFlush(tmpDir, config);
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it("should not flush when interval has not elapsed", async () => {
      // Write a recent flush timestamp
      fs.writeFileSync(
        path.join(tmpDir, "telemetry-flush.json"),
        JSON.stringify({ lastFlushAt: Date.now() }),
        "utf8"
      );

      // Add a single event
      recordEvent(tmpDir, { cmd: "ready", success: true, dur: 30 });

      const fetchSpy = vi.spyOn(global, "fetch");
      await maybeFlush(tmpDir, config);
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it("should flush when interval has elapsed", async () => {
      // Write an old flush timestamp
      fs.writeFileSync(
        path.join(tmpDir, "telemetry-flush.json"),
        JSON.stringify({ lastFlushAt: Date.now() - 120_000 }),
        "utf8"
      );

      recordEvent(tmpDir, { cmd: "ready", success: true, dur: 30 });

      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
        new Response(null, { status: 204 })
      );

      await maybeFlush(tmpDir, config);

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://example.com/v1/logs");
      expect((options as any).headers["Content-Type"]).toBe("application/json");
      expect((options as any).headers["Authorization"]).toBe("Basic dGVzdA==");

      // Buffer should be truncated
      const bufferContent = fs.readFileSync(
        path.join(tmpDir, "telemetry-buffer.jsonl"),
        "utf8"
      );
      expect(bufferContent).toBe("");

      fetchSpy.mockRestore();
    });

    it("should flush when buffer exceeds max size", async () => {
      // Write a recent flush timestamp (interval not elapsed)
      fs.writeFileSync(
        path.join(tmpDir, "telemetry-flush.json"),
        JSON.stringify({ lastFlushAt: Date.now() }),
        "utf8"
      );

      // Add 100+ events
      for (let i = 0; i < 101; i++) {
        recordEvent(tmpDir, { cmd: "ready", success: true, dur: 10 });
      }

      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
        new Response(null, { status: 204 })
      );

      await maybeFlush(tmpDir, config);
      expect(fetchSpy).toHaveBeenCalledOnce();

      fetchSpy.mockRestore();
    });

    it("should leave buffer intact on fetch failure", async () => {
      fs.writeFileSync(
        path.join(tmpDir, "telemetry-flush.json"),
        JSON.stringify({ lastFlushAt: 0 }),
        "utf8"
      );

      recordEvent(tmpDir, { cmd: "ready", success: true, dur: 30 });

      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockRejectedValue(new Error("Network error"));

      await maybeFlush(tmpDir, config);

      // Buffer should still have the event
      const bufferContent = fs
        .readFileSync(path.join(tmpDir, "telemetry-buffer.jsonl"), "utf8")
        .trim();
      expect(bufferContent).not.toBe("");

      fetchSpy.mockRestore();
    });

    it("should never throw", async () => {
      const fetchSpy = vi
        .spyOn(global, "fetch")
        .mockRejectedValue(new Error("boom"));

      // Even with corrupted state, should not throw
      fs.writeFileSync(
        path.join(tmpDir, "telemetry-flush.json"),
        "invalid json",
        "utf8"
      );
      recordEvent(tmpDir, { cmd: "ready", success: true, dur: 30 });

      await expect(maybeFlush(tmpDir, config)).resolves.not.toThrow();
      fetchSpy.mockRestore();
    });
  });
});
