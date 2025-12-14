/**
 * Unit tests for YAML converter with round-trip validation
 */

import { describe, it, expect } from "vitest";
import type { Issue, Spec } from "@sudocode-ai/types";
import {
  jsonToYaml,
  yamlToJson,
  validateRoundTrip,
  jsonArrayToYaml,
  yamlArrayToJson,
} from "../../src/yaml-converter.js";

describe("YAML Converter", () => {
  describe("jsonToYaml", () => {
    it("should convert simple Issue to YAML", () => {
      const issue: Issue = {
        id: "i-abc123",
        uuid: "550e8400-e29b-41d4-a716-446655440000",
        title: "Test Issue",
        status: "open",
        content: "This is a test issue",
        priority: 1,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
      };

      const yaml = jsonToYaml(issue);
      expect(yaml).toContain("id: i-abc123");
      expect(yaml).toContain("title: Test Issue");
      expect(yaml).toContain("status: open");
      expect(yaml).toContain("priority: 1");
    });

    it("should convert simple Spec to YAML", () => {
      const spec: Spec = {
        id: "s-xyz789",
        uuid: "550e8400-e29b-41d4-a716-446655440001",
        title: "Test Spec",
        file_path: "/path/to/spec.md",
        content: "This is a test spec",
        priority: 0,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
      };

      const yaml = jsonToYaml(spec);
      expect(yaml).toContain("id: s-xyz789");
      expect(yaml).toContain("title: Test Spec");
      expect(yaml).toContain("file_path: /path/to/spec.md");
    });

    it("should preserve multi-line strings with line breaks", () => {
      const issue: Issue = {
        id: "i-test",
        uuid: "550e8400-e29b-41d4-a716-446655440002",
        title: "Multi-line test",
        status: "open",
        content: "Line 1\nLine 2\nLine 3",
        priority: 1,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
      };

      const yaml = jsonToYaml(issue);
      // YAML should use literal block style (|) for multi-line strings
      expect(yaml).toContain("content:");
      expect(yaml).toContain("Line 1");
      expect(yaml).toContain("Line 2");
      expect(yaml).toContain("Line 3");
    });

    it("should handle optional fields", () => {
      const issue: Issue = {
        id: "i-test",
        uuid: "550e8400-e29b-41d4-a716-446655440003",
        title: "Optional fields test",
        status: "closed",
        content: "Test",
        priority: 2,
        assignee: "john@example.com",
        archived: true,
        archived_at: "2025-01-02T00:00:00Z",
        closed_at: "2025-01-02T00:00:00Z",
        parent_id: "i-parent",
        parent_uuid: "550e8400-e29b-41d4-a716-446655440004",
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-02T00:00:00Z",
      };

      const yaml = jsonToYaml(issue);
      expect(yaml).toContain("assignee:");
      expect(yaml).toContain("archived: true");
      expect(yaml).toContain("archived_at:");
      expect(yaml).toContain("closed_at:");
      expect(yaml).toContain("parent_id: i-parent");
    });

    it("should handle arrays in external_links", () => {
      const spec: Spec = {
        id: "s-test",
        uuid: "550e8400-e29b-41d4-a716-446655440005",
        title: "Spec with external links",
        file_path: "/path/to/spec.md",
        content: "Test",
        priority: 0,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
        external_links: [
          {
            provider: "jira",
            external_id: "PROJ-123",
            external_url: "https://jira.example.com/PROJ-123",
            sync_enabled: true,
            sync_direction: "bidirectional",
            last_synced_at: "2025-01-01T12:00:00Z",
          },
        ],
      };

      const yaml = jsonToYaml(spec);
      expect(yaml).toContain("external_links:");
      expect(yaml).toContain("provider: jira");
      expect(yaml).toContain("external_id: PROJ-123");
      expect(yaml).toContain("sync_enabled: true");
      expect(yaml).toContain("sync_direction: bidirectional");
    });

    it("should handle nested objects in metadata", () => {
      const spec: Spec = {
        id: "s-test",
        uuid: "550e8400-e29b-41d4-a716-446655440006",
        title: "Spec with metadata",
        file_path: "/path/to/spec.md",
        content: "Test",
        priority: 0,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
        external_links: [
          {
            provider: "custom",
            external_id: "ext-123",
            sync_enabled: false,
            sync_direction: "inbound",
            metadata: {
              custom_field: "value",
              nested: {
                deep: "data",
              },
            },
          },
        ],
      };

      const yaml = jsonToYaml(spec);
      expect(yaml).toContain("metadata:");
      expect(yaml).toContain("custom_field: value");
      expect(yaml).toContain("nested:");
      expect(yaml).toContain("deep: data");
    });
  });

  describe("yamlToJson", () => {
    it("should convert YAML to Issue", () => {
      const yaml = `id: i-abc123
uuid: 550e8400-e29b-41d4-a716-446655440000
title: Test Issue
status: open
content: This is a test issue
priority: 1
created_at: "2025-01-01T00:00:00Z"
updated_at: "2025-01-01T00:00:00Z"`;

      const issue = yamlToJson<Issue>(yaml);
      expect(issue.id).toBe("i-abc123");
      expect(issue.title).toBe("Test Issue");
      expect(issue.status).toBe("open");
      expect(issue.priority).toBe(1);
    });

    it("should convert YAML to Spec", () => {
      const yaml = `id: s-xyz789
uuid: 550e8400-e29b-41d4-a716-446655440001
title: Test Spec
file_path: /path/to/spec.md
content: This is a test spec
priority: 0
created_at: "2025-01-01T00:00:00Z"
updated_at: "2025-01-01T00:00:00Z"`;

      const spec = yamlToJson<Spec>(yaml);
      expect(spec.id).toBe("s-xyz789");
      expect(spec.title).toBe("Test Spec");
      expect(spec.file_path).toBe("/path/to/spec.md");
    });

    it("should restore multi-line strings with line breaks", () => {
      const yaml = `id: i-test
uuid: 550e8400-e29b-41d4-a716-446655440002
title: Multi-line test
status: open
content: |
  Line 1
  Line 2
  Line 3
priority: 1
created_at: "2025-01-01T00:00:00Z"
updated_at: "2025-01-01T00:00:00Z"`;

      const issue = yamlToJson<Issue>(yaml);
      expect(issue.content).toBe("Line 1\nLine 2\nLine 3\n");
    });

    it("should handle arrays", () => {
      const yaml = `id: s-test
uuid: 550e8400-e29b-41d4-a716-446655440005
title: Spec with external links
file_path: /path/to/spec.md
content: Test
priority: 0
created_at: "2025-01-01T00:00:00Z"
updated_at: "2025-01-01T00:00:00Z"
external_links:
  - provider: jira
    external_id: PROJ-123
    external_url: https://jira.example.com/PROJ-123
    sync_enabled: true
    sync_direction: bidirectional
    last_synced_at: "2025-01-01T12:00:00Z"`;

      const spec = yamlToJson<Spec>(yaml);
      expect(spec.external_links).toHaveLength(1);
      expect(spec.external_links![0].provider).toBe("jira");
      expect(spec.external_links![0].sync_enabled).toBe(true);
    });

    it("should handle nested objects", () => {
      const yaml = `id: s-test
uuid: 550e8400-e29b-41d4-a716-446655440006
title: Spec with metadata
file_path: /path/to/spec.md
content: Test
priority: 0
created_at: "2025-01-01T00:00:00Z"
updated_at: "2025-01-01T00:00:00Z"
external_links:
  - provider: custom
    external_id: ext-123
    sync_enabled: false
    sync_direction: inbound
    metadata:
      custom_field: value
      nested:
        deep: data`;

      const spec = yamlToJson<Spec>(yaml);
      expect(spec.external_links![0].metadata).toBeDefined();
      expect(spec.external_links![0].metadata!.custom_field).toBe("value");
      expect((spec.external_links![0].metadata!.nested as any).deep).toBe("data");
    });

    it("should throw error for malformed YAML", () => {
      const invalidYaml = `id: i-test
title: "Unclosed quote
status: open`;

      expect(() => yamlToJson(invalidYaml)).toThrow("Failed to convert YAML to JSON");
    });

    it("should throw error for non-object YAML", () => {
      const invalidYaml = `just a string`;

      expect(() => yamlToJson(invalidYaml)).toThrow("must parse to a non-null object");
    });
  });

  describe("Round-trip validation", () => {
    it("should validate lossless round-trip for simple Issue", () => {
      const issue: Issue = {
        id: "i-abc123",
        uuid: "550e8400-e29b-41d4-a716-446655440000",
        title: "Test Issue",
        status: "open",
        content: "This is a test issue",
        priority: 1,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
      };

      const yaml = jsonToYaml(issue);
      const restored = yamlToJson<Issue>(yaml);

      expect(restored).toEqual(issue);
    });

    it("should validate lossless round-trip for simple Spec", () => {
      const spec: Spec = {
        id: "s-xyz789",
        uuid: "550e8400-e29b-41d4-a716-446655440001",
        title: "Test Spec",
        file_path: "/path/to/spec.md",
        content: "This is a test spec",
        priority: 0,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
      };

      const yaml = jsonToYaml(spec);
      const restored = yamlToJson<Spec>(yaml);

      expect(restored).toEqual(spec);
    });

    it("should preserve multi-line content in round-trip", () => {
      const issue: Issue = {
        id: "i-test",
        uuid: "550e8400-e29b-41d4-a716-446655440002",
        title: "Multi-line test",
        status: "open",
        content: "Line 1\nLine 2\nLine 3\n",
        priority: 1,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
      };

      const yaml = jsonToYaml(issue);
      const restored = yamlToJson<Issue>(yaml);

      expect(restored.content).toBe(issue.content);
    });

    it("should preserve all optional fields in round-trip", () => {
      const issue: Issue = {
        id: "i-test",
        uuid: "550e8400-e29b-41d4-a716-446655440003",
        title: "Optional fields test",
        status: "closed",
        content: "Test",
        priority: 2,
        assignee: "john@example.com",
        archived: true,
        archived_at: "2025-01-02T00:00:00Z",
        closed_at: "2025-01-02T00:00:00Z",
        parent_id: "i-parent",
        parent_uuid: "550e8400-e29b-41d4-a716-446655440004",
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-02T00:00:00Z",
      };

      const yaml = jsonToYaml(issue);
      const restored = yamlToJson<Issue>(yaml);

      expect(restored).toEqual(issue);
    });

    it("should preserve arrays in round-trip", () => {
      const spec: Spec = {
        id: "s-test",
        uuid: "550e8400-e29b-41d4-a716-446655440005",
        title: "Spec with external links",
        file_path: "/path/to/spec.md",
        content: "Test",
        priority: 0,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
        external_links: [
          {
            provider: "jira",
            external_id: "PROJ-123",
            external_url: "https://jira.example.com/PROJ-123",
            sync_enabled: true,
            sync_direction: "bidirectional",
            last_synced_at: "2025-01-01T12:00:00Z",
          },
        ],
      };

      const yaml = jsonToYaml(spec);
      const restored = yamlToJson<Spec>(yaml);

      expect(restored).toEqual(spec);
    });

    it("should preserve nested objects in round-trip", () => {
      const spec: Spec = {
        id: "s-test",
        uuid: "550e8400-e29b-41d4-a716-446655440006",
        title: "Spec with metadata",
        file_path: "/path/to/spec.md",
        content: "Test",
        priority: 0,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
        external_links: [
          {
            provider: "custom",
            external_id: "ext-123",
            sync_enabled: false,
            sync_direction: "inbound",
            metadata: {
              custom_field: "value",
              nested: {
                deep: "data",
              },
            },
          },
        ],
      };

      const yaml = jsonToYaml(spec);
      const restored = yamlToJson<Spec>(yaml);

      expect(restored).toEqual(spec);
    });

    it("should use validateRoundTrip helper successfully", () => {
      const issue: Issue = {
        id: "i-test",
        uuid: "550e8400-e29b-41d4-a716-446655440007",
        title: "Validation test",
        status: "open",
        content: "Test content",
        priority: 1,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
      };

      const result = validateRoundTrip(issue);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("YAML format validation", () => {
    it("should use literal style (|-) for multi-line strings", () => {
      const issue: Issue = {
        id: "i-test",
        uuid: "550e8400-e29b-41d4-a716-446655440002",
        title: "Multi-line test",
        status: "open",
        content: "Line 1\nLine 2\nLine 3",
        priority: 1,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
      };

      const yaml = jsonToYaml(issue);

      // Should use literal block style for multi-line content
      expect(yaml).toMatch(/content: \|-?\n/);
      // Each line should be on its own line (not escaped)
      expect(yaml).toContain("  Line 1");
      expect(yaml).toContain("  Line 2");
      expect(yaml).toContain("  Line 3");
      // Should NOT use quoted/escaped format
      expect(yaml).not.toContain("Line 1\\nLine 2");
    });

    it("should use plain style for single-line strings", () => {
      const issue: Issue = {
        id: "i-test",
        uuid: "550e8400-e29b-41d4-a716-446655440000",
        title: "Short title",
        status: "open",
        content: "This is a single line without newlines",
        priority: 1,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
      };

      const yaml = jsonToYaml(issue);

      // Should use plain style (no quotes, no literal block)
      expect(yaml).toContain("content: This is a single line without newlines");
      // Should NOT use literal block style
      expect(yaml).not.toMatch(/content: \|-?\n/);
      // Should NOT be quoted (unless necessary)
      expect(yaml).not.toContain('content: "This is a single line without newlines"');
    });

    it("should use block style for arrays", () => {
      const spec: Spec = {
        id: "s-test",
        uuid: "550e8400-e29b-41d4-a716-446655440005",
        title: "Spec with external links",
        file_path: "/path/to/spec.md",
        content: "Test",
        priority: 0,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
        external_links: [
          {
            provider: "jira",
            external_id: "PROJ-123",
            external_url: "https://jira.example.com/PROJ-123",
            sync_enabled: true,
            sync_direction: "bidirectional",
          },
        ],
      };

      const yaml = jsonToYaml(spec);

      // Should use block style with dashes
      expect(yaml).toContain("external_links:");
      expect(yaml).toMatch(/external_links:\n  - /);
      // Should NOT use flow style [...]
      expect(yaml).not.toContain("external_links: [");
    });
  });

  describe("Edge cases", () => {
    it("should handle empty arrays", () => {
      const spec: Spec = {
        id: "s-test",
        uuid: "550e8400-e29b-41d4-a716-446655440008",
        title: "Empty array test",
        file_path: "/path/to/spec.md",
        content: "Test",
        priority: 0,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
        external_links: [],
      };

      const yaml = jsonToYaml(spec);
      const restored = yamlToJson<Spec>(yaml);

      expect(restored.external_links).toEqual([]);
    });

    it("should handle null values", () => {
      const issue: Issue = {
        id: "i-test",
        uuid: "550e8400-e29b-41d4-a716-446655440009",
        title: "Null test",
        status: "open",
        content: "Test",
        priority: 1,
        assignee: undefined,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
      };

      const yaml = jsonToYaml(issue);
      const restored = yamlToJson<Issue>(yaml);

      expect(restored.assignee).toBeUndefined();
    });

    it("should handle special characters in strings", () => {
      const issue: Issue = {
        id: "i-test",
        uuid: "550e8400-e29b-41d4-a716-446655440010",
        title: "Special chars: @#$%^&*()",
        status: "open",
        content: "Content with 'quotes' and \"double quotes\"",
        priority: 1,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
      };

      const yaml = jsonToYaml(issue);
      const restored = yamlToJson<Issue>(yaml);

      expect(restored).toEqual(issue);
    });

    it("should handle unicode characters", () => {
      const issue: Issue = {
        id: "i-test",
        uuid: "550e8400-e29b-41d4-a716-446655440011",
        title: "Unicode: 你好世界 🌍",
        status: "open",
        content: "Content with émojis 🎉 and åccénts",
        priority: 1,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
      };

      const yaml = jsonToYaml(issue);
      const restored = yamlToJson<Issue>(yaml);

      expect(restored).toEqual(issue);
    });

    it("should handle markdown in multi-line strings", () => {
      const spec: Spec = {
        id: "s-test",
        uuid: "550e8400-e29b-41d4-a716-446655440012",
        title: "Markdown test",
        file_path: "/path/to/spec.md",
        content: `# Heading

## Subheading

- List item 1
- List item 2

\`\`\`javascript
const x = 42;
\`\`\`

[Link](https://example.com)`,
        priority: 0,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
      };

      const yaml = jsonToYaml(spec);
      const restored = yamlToJson<Spec>(yaml);

      expect(restored.content).toBe(spec.content);
    });

    it("should handle long text (10KB+)", () => {
      const longContent = "A".repeat(15000);
      const spec: Spec = {
        id: "s-test",
        uuid: "550e8400-e29b-41d4-a716-446655440013",
        title: "Long content test",
        file_path: "/path/to/spec.md",
        content: longContent,
        priority: 0,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
      };

      const yaml = jsonToYaml(spec, { lineWidth: -1 }); // Disable line wrapping
      const restored = yamlToJson<Spec>(yaml);

      expect(restored.content).toBe(longContent);
      expect(restored.content.length).toBe(15000);
    });

    it("should handle boolean values", () => {
      const issue: Issue = {
        id: "i-test",
        uuid: "550e8400-e29b-41d4-a716-446655440014",
        title: "Boolean test",
        status: "open",
        content: "Test",
        priority: 1,
        archived: false,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
      };

      const yaml = jsonToYaml(issue);
      const restored = yamlToJson<Issue>(yaml);

      expect(restored.archived).toBe(false);
    });

    it("should handle number values (integers and floats)", () => {
      const data = {
        integer: 42,
        float: 3.14159,
        negative: -10,
        zero: 0,
      };

      const yaml = jsonToYaml(data);
      const restored = yamlToJson(yaml);

      expect(restored).toEqual(data);
    });
  });

  describe("Batch operations", () => {
    it("should convert array of entities to YAML", () => {
      const entities: Issue[] = [
        {
          id: "i-1",
          uuid: "550e8400-e29b-41d4-a716-446655440015",
          title: "Issue 1",
          status: "open",
          content: "Content 1",
          priority: 1,
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-01T00:00:00Z",
        },
        {
          id: "i-2",
          uuid: "550e8400-e29b-41d4-a716-446655440016",
          title: "Issue 2",
          status: "closed",
          content: "Content 2",
          priority: 2,
          created_at: "2025-01-02T00:00:00Z",
          updated_at: "2025-01-02T00:00:00Z",
        },
      ];

      const yamlStrings = jsonArrayToYaml(entities);
      expect(yamlStrings).toHaveLength(2);
      expect(yamlStrings[0]).toContain("id: i-1");
      expect(yamlStrings[1]).toContain("id: i-2");
    });

    it("should convert array of YAML to entities", () => {
      const yamlStrings = [
        `id: i-1
uuid: 550e8400-e29b-41d4-a716-446655440015
title: Issue 1
status: open
content: Content 1
priority: 1
created_at: "2025-01-01T00:00:00Z"
updated_at: "2025-01-01T00:00:00Z"`,
        `id: i-2
uuid: 550e8400-e29b-41d4-a716-446655440016
title: Issue 2
status: closed
content: Content 2
priority: 2
created_at: "2025-01-02T00:00:00Z"
updated_at: "2025-01-02T00:00:00Z"`,
      ];

      const entities = yamlArrayToJson<Issue>(yamlStrings);
      expect(entities).toHaveLength(2);
      expect(entities[0].id).toBe("i-1");
      expect(entities[1].id).toBe("i-2");
    });

    it("should validate batch round-trip", () => {
      const entities: Issue[] = [
        {
          id: "i-1",
          uuid: "550e8400-e29b-41d4-a716-446655440017",
          title: "Issue 1",
          status: "open",
          content: "Content 1",
          priority: 1,
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-01T00:00:00Z",
        },
        {
          id: "i-2",
          uuid: "550e8400-e29b-41d4-a716-446655440018",
          title: "Issue 2",
          status: "closed",
          content: "Content 2",
          priority: 2,
          created_at: "2025-01-02T00:00:00Z",
          updated_at: "2025-01-02T00:00:00Z",
        },
      ];

      const yamlStrings = jsonArrayToYaml(entities);
      const restored = yamlArrayToJson<Issue>(yamlStrings);

      expect(restored).toEqual(entities);
    });
  });
});
