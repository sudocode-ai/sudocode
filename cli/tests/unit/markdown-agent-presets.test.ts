/**
 * Tests for markdown agent preset parsing
 */

import { describe, it, expect } from "vitest";
import { parseMarkdown, validateAgentPreset } from "../../src/markdown.js";
import type { AgentPreset } from "@sudocode-ai/types";

describe("Markdown Agent Preset Parsing", () => {
  describe("parseAgentPreset frontmatter", () => {
    it("should parse minimal valid preset", () => {
      const content = `---
id: test
name: Test Agent
description: A test agent
version: 1.0.0
agent_type: claude-code
---

# System Prompt

Test system prompt.
`;

      const parsed = parseMarkdown<{
        id: string;
        name: string;
        description: string;
        version: string;
        agent_type: string;
      }>(content);

      expect(parsed.data.id).toBe("test");
      expect(parsed.data.name).toBe("Test Agent");
      expect(parsed.data.description).toBe("A test agent");
      expect(parsed.data.version).toBe("1.0.0");
      expect(parsed.data.agent_type).toBe("claude-code");
      expect(parsed.content.trim()).toBe("# System Prompt\n\nTest system prompt.");
    });

    it("should parse preset with tools", () => {
      const content = `---
id: test
name: Test
description: Test
version: 1.0.0
agent_type: claude-code
tools:
  - Read
  - Write
  - Grep
---

System prompt.
`;

      const parsed = parseMarkdown<{ tools: string[] }>(content);
      expect(parsed.data.tools).toEqual(["Read", "Write", "Grep"]);
    });

    it("should parse preset with MCP servers", () => {
      const content = `---
id: test
name: Test
description: Test
version: 1.0.0
agent_type: claude-code
mcp_servers:
  - github
  - linear
---

System prompt.
`;

      const parsed = parseMarkdown<{ mcp_servers: string[] }>(content);
      expect(parsed.data.mcp_servers).toEqual(["github", "linear"]);
    });

    it("should parse preset with hooks", () => {
      const content = `---
id: test
name: Test
description: Test
version: 1.0.0
agent_type: claude-code
hooks:
  before_execution:
    - validate
  after_execution:
    - cleanup
---

System prompt.
`;

      const parsed = parseMarkdown<{
        hooks: {
          before_execution: string[];
          after_execution: string[];
        };
      }>(content);

      expect(parsed.data.hooks.before_execution).toEqual(["validate"]);
      expect(parsed.data.hooks.after_execution).toEqual(["cleanup"]);
    });

    it("should parse preset with platform configs", () => {
      const content = `---
id: test
name: Test
description: Test
version: 1.0.0
agent_type: claude-code
platform_configs:
  claude-code:
    compact: true
  cursor:
    auto_attach: true
---

System prompt.
`;

      const parsed = parseMarkdown<{
        platform_configs: Record<string, any>;
      }>(content);

      expect(parsed.data.platform_configs["claude-code"].compact).toBe(
        true
      );
      expect(parsed.data.platform_configs["cursor"].auto_attach).toBe(true);
    });

    it("should parse preset with capabilities and tags", () => {
      const content = `---
id: test
name: Test
description: Test
version: 1.0.0
agent_type: claude-code
capabilities:
  - code-review
  - static-analysis
protocols:
  - mcp
  - a2a
tags:
  - reviewer
  - quality
---

System prompt.
`;

      const parsed = parseMarkdown<{
        capabilities: string[];
        protocols: string[];
        tags: string[];
      }>(content);

      expect(parsed.data.capabilities).toEqual([
        "code-review",
        "static-analysis",
      ]);
      expect(parsed.data.protocols).toEqual(["mcp", "a2a"]);
      expect(parsed.data.tags).toEqual(["reviewer", "quality"]);
    });
  });

  describe("validateAgentPreset", () => {
    it("should validate preset with all required fields", () => {
      const preset: AgentPreset = {
        id: "test",
        name: "Test",
        description: "Test agent",
        version: "1.0.0",
        file_path: "/test/test.agent.md",
        config: {
          agent_type: "claude-code",
        },
        system_prompt: "Test system prompt",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const errors = validateAgentPreset(preset);
      expect(errors.length).toBe(0);
    });

    it("should detect missing required fields", () => {
      const presetNoId: any = {
        name: "Test",
        description: "Test",
        version: "1.0.0",
        config: { agent_type: "claude-code" },
        system_prompt: "Test",
      };

      const errors = validateAgentPreset(presetNoId);
      expect(errors).toContain("Missing required field: id");
    });

    it("should validate version format", () => {
      const preset: AgentPreset = {
        id: "test",
        name: "Test",
        description: "Test",
        version: "invalid",
        file_path: "/test",
        config: { agent_type: "claude-code" },
        system_prompt: "Test",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const errors = validateAgentPreset(preset);
      expect(errors.some((e) => e.includes("Invalid version format"))).toBe(
        true
      );
    });

    it("should validate agent_type", () => {
      const preset: AgentPreset = {
        id: "test",
        name: "Test",
        description: "Test",
        version: "1.0.0",
        file_path: "/test",
        config: { agent_type: "invalid-type" as any },
        system_prompt: "Test",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const errors = validateAgentPreset(preset);
      expect(errors.some((e) => e.includes("Invalid agent_type"))).toBe(true);
    });

    it("should validate isolation_mode", () => {
      const preset: AgentPreset = {
        id: "test",
        name: "Test",
        description: "Test",
        version: "1.0.0",
        file_path: "/test",
        config: {
          agent_type: "claude-code",
          isolation_mode: "invalid" as any,
        },
        system_prompt: "Test",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const errors = validateAgentPreset(preset);
      expect(
        errors.some((e) => e.includes("Invalid isolation_mode"))
      ).toBe(true);
    });

    it("should detect missing system prompt", () => {
      const preset: AgentPreset = {
        id: "test",
        name: "Test",
        description: "Test",
        version: "1.0.0",
        file_path: "/test",
        config: { agent_type: "claude-code" },
        system_prompt: "",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const errors = validateAgentPreset(preset);
      expect(
        errors.some((e) => e.includes("Missing or empty system prompt"))
      ).toBe(true);
    });

    it("should collect multiple errors", () => {
      const preset: any = {
        // Missing id
        name: "Test",
        description: "Test",
        version: "bad-version",
        file_path: "/test",
        config: { agent_type: "invalid-type" },
        system_prompt: "",
      };

      const errors = validateAgentPreset(preset);
      expect(errors.length).toBeGreaterThan(1);
      expect(errors).toContain("Missing required field: id");
      expect(errors.some((e) => e.includes("Invalid version format"))).toBe(
        true
      );
    });
  });

  describe("real-world preset examples", () => {
    it("should parse code-reviewer preset", () => {
      const content = `---
id: code-reviewer
name: Code Reviewer
description: Reviews code for quality and security
version: 1.0.0
agent_type: claude-code
model: claude-sonnet-4-5
tools:
  - Read
  - Grep
  - Glob
isolation_mode: subagent
max_context_tokens: 200000
capabilities:
  - code-review
  - static-analysis
protocols:
  - mcp
tags:
  - reviewer
---

# System Prompt

You are a code reviewer...
`;

      const parsed = parseMarkdown<any>(content);

      expect(parsed.data.id).toBe("code-reviewer");
      expect(parsed.data.tools).toEqual(["Read", "Grep", "Glob"]);
      expect(parsed.data.model).toBe("claude-sonnet-4-5");
      expect(parsed.data.max_context_tokens).toBe(200000);
      expect(parsed.data.capabilities).toContain("code-review");
    });

    it("should parse test-writer preset", () => {
      const content = `---
id: test-writer
name: Test Writer
description: Writes comprehensive tests
version: 1.0.0
agent_type: claude-code
tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Bash
---

# System Prompt

You are a test writer...
`;

      const parsed = parseMarkdown<any>(content);

      expect(parsed.data.id).toBe("test-writer");
      expect(parsed.data.tools).toContain("Bash");
      expect(parsed.data.tools).toContain("Write");
    });
  });
});
