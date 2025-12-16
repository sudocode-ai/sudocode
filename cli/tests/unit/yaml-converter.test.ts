/**
 * Unit tests for YAML converter
 */

import { describe, it, expect } from "vitest";
import {
  toYaml,
  fromYaml,
  verifyRoundTrip,
  toYamlDocuments,
  fromYamlDocuments,
} from "../../src/yaml-converter.js";

describe("YAML Converter", () => {
  describe("toYaml", () => {
    it("should convert simple object to YAML", () => {
      const obj = {
        id: "test-123",
        title: "Test Issue",
        status: "open",
        priority: 1,
      };

      const yaml = toYaml(obj);

      expect(yaml).toContain("id: test-123");
      expect(yaml).toContain("title: Test Issue");
      expect(yaml).toContain("status: open");
      expect(yaml).toContain("priority: 1");
      expect(yaml).toMatch(/\n$/); // trailing newline
    });

    it("should use block style for multi-line strings", () => {
      const obj = {
        id: "test-123",
        description: "Line 1\nLine 2\nLine 3\nThis is a longer description that exceeds the minimum length for literal style formatting.",
      };

      const yaml = toYaml(obj);

      // js-yaml may use either |- (literal) or >- (folded) for multi-line strings
      // Both are valid block scalar styles that preserve line structure for git merging
      expect(yaml).toMatch(/description: [|>]-?/); // block style indicator
      expect(yaml).toContain("Line 1");
      expect(yaml).toContain("Line 2");
      expect(yaml).toContain("Line 3");
    });

    it("should use block style for all multi-line strings", () => {
      const obj = {
        id: "test-123",
        description: "Line 1\nLine 2",
      };

      const yaml = toYaml(obj);

      // All multi-line strings use block style (literal | or folded >) regardless of length
      expect(yaml).toMatch(/description: [|>]-?/);
    });

    it("should use block style for arrays", () => {
      const obj = {
        tags: ["backend", "api", "authentication"],
      };

      const yaml = toYaml(obj);

      expect(yaml).toContain("tags:");
      expect(yaml).toContain("- backend");
      expect(yaml).toContain("- api");
      expect(yaml).toContain("- authentication");
    });

    it("should handle empty arrays", () => {
      const obj = {
        tags: [],
      };

      const yaml = toYaml(obj);

      expect(yaml).toContain("tags: []");
    });

    it("should handle null values", () => {
      const obj = {
        id: "test-123",
        assignee: null,
      };

      const yaml = toYaml(obj);

      expect(yaml).toContain("assignee: null");
    });

    it("should handle empty strings", () => {
      const obj = {
        id: "test-123",
        description: "",
      };

      const yaml = toYaml(obj);

      expect(yaml).toContain("description:");
    });

    it("should quote strings with special characters", () => {
      const obj = {
        message: "Error: failed",
        path: "/home/user",
        command: "npm install",
      };

      const yaml = toYaml(obj);

      // js-yaml automatically quotes strings with special chars (uses single quotes by default)
      expect(yaml).toMatch(/(message: ['"]Error: failed['"]|message: 'Error: failed')/);
    });

    it("should quote boolean-like strings", () => {
      const obj = {
        status: "true",
        enabled: "false",
        value: "null",
      };

      const yaml = toYaml(obj);

      // js-yaml automatically quotes these to avoid interpretation as booleans
      // Can use either single or double quotes
      expect(yaml).toMatch(/status: ['"]true['"]/);
      expect(yaml).toMatch(/enabled: ['"]false['"]/);
      expect(yaml).toMatch(/value: ['"]null['"]/);
    });

    it("should quote number-like strings", () => {
      const obj = {
        version: "1.0",
        id: "123",
      };

      const yaml = toYaml(obj);

      // js-yaml automatically quotes these to avoid interpretation as numbers
      expect(yaml).toMatch(/version: ['"]1\.0['"]/);
      expect(yaml).toMatch(/id: ['"]123['"]/);
    });

    it("should handle nested objects", () => {
      const obj = {
        id: "test-123",
        metadata: {
          author: "Alice",
          created: "2025-01-01",
          tags: ["test", "demo"],
        },
      };

      const yaml = toYaml(obj);

      expect(yaml).toContain("metadata:");
      expect(yaml).toContain("author: Alice");
      // Date-like strings may be quoted
      expect(yaml).toMatch(/(created: 2025-01-01|created: ['"]2025-01-01['"])/);
      expect(yaml).toContain("- test");
      expect(yaml).toContain("- demo");
    });

    it("should handle unicode characters", () => {
      const obj = {
        title: "Test with émoji 🎉 and ñ",
        description: "Unicode: 中文, العربية, עברית",
      };

      const yaml = toYaml(obj);

      expect(yaml).toContain("🎉");
      expect(yaml).toContain("中文");
      expect(yaml).toContain("العربية");
      expect(yaml).toContain("עברית");
    });

    it("should use 2-space indent by default", () => {
      const obj = {
        parent: {
          child: {
            value: "test",
          },
        },
      };

      const yaml = toYaml(obj);

      expect(yaml).toMatch(/parent:\n  child:\n    value: test/);
    });

    it("should support custom indent", () => {
      const obj = {
        parent: {
          child: "test",
        },
      };

      const yaml = toYaml(obj, { indent: 4 });

      expect(yaml).toMatch(/parent:\n    child: test/);
    });

    it("should handle large text (10KB+)", () => {
      // Generate a large multi-line string
      const largeText = Array(1000)
        .fill("This is a line of text that will be repeated many times.\n")
        .join("");

      const obj = {
        id: "test-123",
        content: largeText,
      };

      const yaml = toYaml(obj);

      expect(yaml).toContain("content: |");
      expect(yaml.length).toBeGreaterThan(10000);
    });

    it("should preserve key order", () => {
      const obj = {
        z_field: "last",
        a_field: "first",
        m_field: "middle",
      };

      const yaml = toYaml(obj);

      const zIndex = yaml.indexOf("z_field");
      const aIndex = yaml.indexOf("a_field");
      const mIndex = yaml.indexOf("m_field");

      // Order should be preserved as inserted
      expect(zIndex).toBeLessThan(aIndex);
      expect(aIndex).toBeLessThan(mIndex);
    });
  });

  describe("fromYaml", () => {
    it("should parse simple YAML", () => {
      const yaml = `id: test-123
title: Test Issue
status: open
priority: 1
`;

      const obj = fromYaml(yaml);

      expect(obj.id).toBe("test-123");
      expect(obj.title).toBe("Test Issue");
      expect(obj.status).toBe("open");
      expect(obj.priority).toBe(1);
    });

    it("should parse literal style multi-line strings", () => {
      const yaml = `id: test-123
description: |
  Line 1
  Line 2
  Line 3
`;

      const obj = fromYaml(yaml);

      expect(obj.description).toBe("Line 1\nLine 2\nLine 3\n");
    });

    it("should parse block style arrays", () => {
      const yaml = `tags:
  - backend
  - api
  - authentication
`;

      const obj = fromYaml(yaml);

      expect(obj.tags).toEqual(["backend", "api", "authentication"]);
    });

    it("should parse empty arrays", () => {
      const yaml = `tags: []
`;

      const obj = fromYaml(yaml);

      expect(obj.tags).toEqual([]);
    });

    it("should parse null values", () => {
      const yaml = `id: test-123
assignee: null
`;

      const obj = fromYaml(yaml);

      expect(obj.assignee).toBeNull();
    });

    it("should parse empty strings", () => {
      const yaml = `id: test-123
description:
`;

      const obj = fromYaml(yaml);

      expect(obj.description).toBeNull(); // YAML treats empty as null
    });

    it("should parse nested objects", () => {
      const yaml = `id: test-123
metadata:
  author: Alice
  created: 2025-01-01
  tags:
    - test
    - demo
`;

      const obj = fromYaml(yaml);

      expect(obj.metadata.author).toBe("Alice");
      expect(obj.metadata.created).toBe("2025-01-01");
      expect(obj.metadata.tags).toEqual(["test", "demo"]);
    });

    it("should parse unicode characters", () => {
      const yaml = `title: Test with émoji 🎉 and ñ
description: "Unicode: 中文, العربية, עברית"
`;

      const obj = fromYaml(yaml);

      expect(obj.title).toContain("🎉");
      expect(obj.description).toContain("中文");
    });

    it("should return null for empty string", () => {
      const obj = fromYaml("");

      expect(obj).toBeNull();
    });

    it("should return null for whitespace-only string", () => {
      const obj = fromYaml("   \n  \n  ");

      expect(obj).toBeNull();
    });

    it("should throw error for invalid YAML", () => {
      const yaml = `id: test-123
invalid: [unclosed bracket
`;

      expect(() => fromYaml(yaml)).toThrow();
    });

    it("should parse quoted strings correctly", () => {
      const yaml = `status: "true"
enabled: "false"
value: "null"
`;

      const obj = fromYaml(yaml);

      // Quoted values should be strings, not booleans/null
      expect(obj.status).toBe("true");
      expect(obj.enabled).toBe("false");
      expect(obj.value).toBe("null");
    });
  });

  describe("verifyRoundTrip", () => {
    it("should verify round-trip for simple object", () => {
      const obj = {
        id: "test-123",
        title: "Test Issue",
        status: "open",
        priority: 1,
      };

      expect(verifyRoundTrip(obj)).toBe(true);
    });

    it("should verify round-trip for object with multi-line strings", () => {
      const obj = {
        id: "test-123",
        description: "Line 1\nLine 2\nLine 3\nThis is a longer description.",
      };

      expect(verifyRoundTrip(obj)).toBe(true);
    });

    it("should verify round-trip for object with arrays", () => {
      const obj = {
        tags: ["backend", "api", "authentication"],
      };

      expect(verifyRoundTrip(obj)).toBe(true);
    });

    it("should verify round-trip for nested objects", () => {
      const obj = {
        id: "test-123",
        metadata: {
          author: "Alice",
          tags: ["test", "demo"],
        },
      };

      expect(verifyRoundTrip(obj)).toBe(true);
    });

    it("should verify round-trip for object with null values", () => {
      const obj = {
        id: "test-123",
        assignee: null,
      };

      expect(verifyRoundTrip(obj)).toBe(true);
    });

    it("should verify round-trip for object with unicode", () => {
      const obj = {
        title: "Test with émoji 🎉",
        description: "Unicode: 中文",
      };

      expect(verifyRoundTrip(obj)).toBe(true);
    });

    it("should handle empty arrays", () => {
      const obj = {
        tags: [],
      };

      expect(verifyRoundTrip(obj)).toBe(true);
    });

    it("should verify round-trip for large text", () => {
      const largeText = Array(1000)
        .fill("This is a line of text.\n")
        .join("");

      const obj = {
        id: "test-123",
        content: largeText,
      };

      expect(verifyRoundTrip(obj)).toBe(true);
    });
  });

  describe("Entity Types", () => {
    describe("Issue", () => {
      it("should handle typical Issue structure", () => {
        const issue = {
          id: "i-abc123",
          uuid: "550e8400-e29b-41d4-a716-446655440000",
          title: "Implement user authentication",
          description: "Add OAuth support\nSupport Google and GitHub providers\n\nAcceptance criteria:\n- [ ] Google OAuth\n- [ ] GitHub OAuth",
          status: "in_progress",
          priority: 1,
          tags: ["backend", "authentication"],
          assignee: "alice@example.com",
          parent: null,
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-02T00:00:00Z",
          archived: false,
        };

        expect(verifyRoundTrip(issue)).toBe(true);

        const yaml = toYaml(issue);
        expect(yaml).toMatch(/description: [|>]-?/); // block style (literal or folded)
        expect(yaml).toContain("tags:");
        expect(yaml).toContain("- backend");
        expect(yaml).toContain("- authentication");
      });

      it("should handle Issue with empty fields", () => {
        const issue = {
          id: "i-abc123",
          uuid: "550e8400-e29b-41d4-a716-446655440000",
          title: "Test Issue",
          description: "",
          status: "open",
          priority: 2,
          tags: [],
          assignee: null,
          parent: null,
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-01T00:00:00Z",
          archived: false,
        };

        expect(verifyRoundTrip(issue)).toBe(true);
      });
    });

    describe("Spec", () => {
      it("should handle typical Spec structure", () => {
        const spec = {
          id: "s-xyz789",
          uuid: "650e8400-e29b-41d4-a716-446655440000",
          title: "User Authentication System",
          description: "# Overview\n\nImplement OAuth 2.0 authentication.\n\n## Requirements\n\n1. Support multiple providers\n2. Secure token storage\n3. Session management\n\n## Technical Details\n\n- Use passport.js\n- Store tokens in Redis\n- 30-day session expiry",
          priority: 0,
          tags: ["architecture", "security"],
          parent: null,
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-02T00:00:00Z",
        };

        expect(verifyRoundTrip(spec)).toBe(true);

        const yaml = toYaml(spec);
        expect(yaml).toMatch(/description: [|>]-?/); // block style (literal or folded)
        expect(yaml).toContain("# Overview");
        expect(yaml).toContain("## Requirements");
      });

      it("should handle Spec with very large description", () => {
        const largeDescription = Array(500)
          .fill("## Section\n\nThis is a paragraph with details.\n\n")
          .join("");

        const spec = {
          id: "s-xyz789",
          uuid: "650e8400-e29b-41d4-a716-446655440000",
          title: "Large Spec",
          description: largeDescription,
          priority: 1,
          tags: [],
          parent: null,
          created_at: "2025-01-01T00:00:00Z",
          updated_at: "2025-01-01T00:00:00Z",
        };

        expect(verifyRoundTrip(spec)).toBe(true);
        expect(spec.description.length).toBeGreaterThan(10000);
      });
    });
  });

  describe("toYamlDocuments", () => {
    it("should convert multiple objects to YAML documents", () => {
      const objects = [
        { id: "1", title: "First" },
        { id: "2", title: "Second" },
        { id: "3", title: "Third" },
      ];

      const yaml = toYamlDocuments(objects);

      expect(yaml).toContain("---");
      expect(yaml.split("---").length).toBe(3);
      expect(yaml).toContain("id: '1'");
      expect(yaml).toContain("id: '2'");
      expect(yaml).toContain("id: '3'");
    });

    it("should handle empty array", () => {
      const yaml = toYamlDocuments([]);

      expect(yaml).toBe("");
    });

    it("should handle single object", () => {
      const yaml = toYamlDocuments([{ id: "1", title: "Only" }]);

      expect(yaml).not.toContain("---");
      expect(yaml).toContain("id: '1'");
    });

    it("should preserve newlines between documents", () => {
      const objects = [
        { id: "1", description: "Line 1\nLine 2" },
        { id: "2", description: "Line 3\nLine 4" },
      ];

      const yaml = toYamlDocuments(objects);

      expect(yaml).toContain("---");
      expect(yaml).toMatch(/\n---\n/);
    });
  });

  describe("fromYamlDocuments", () => {
    it("should parse multiple YAML documents", () => {
      const yaml = `id: '1'
title: First
---
id: '2'
title: Second
---
id: '3'
title: Third
`;

      const objects = fromYamlDocuments(yaml);

      expect(objects).toHaveLength(3);
      expect(objects[0].id).toBe("1");
      expect(objects[1].id).toBe("2");
      expect(objects[2].id).toBe("3");
    });

    it("should handle empty string", () => {
      const objects = fromYamlDocuments("");

      expect(objects).toEqual([]);
    });

    it("should handle single document", () => {
      const yaml = `id: '1'
title: Only
`;

      const objects = fromYamlDocuments(yaml);

      expect(objects).toHaveLength(1);
      expect(objects[0].id).toBe("1");
    });

    it("should handle documents with multi-line strings", () => {
      const yaml = `id: '1'
description: |
  Line 1
  Line 2
---
id: '2'
description: |
  Line 3
  Line 4
`;

      const objects = fromYamlDocuments(yaml);

      expect(objects).toHaveLength(2);
      expect(objects[0].description).toContain("Line 1");
      expect(objects[1].description).toContain("Line 3");
    });
  });

  describe("Edge Cases", () => {
    it("should handle object with 100+ keys", () => {
      const obj: any = { id: "test" };
      for (let i = 0; i < 100; i++) {
        obj[`field_${i}`] = `value_${i}`;
      }

      expect(verifyRoundTrip(obj)).toBe(true);
    });

    it("should handle deeply nested objects", () => {
      const obj = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  value: "deep",
                },
              },
            },
          },
        },
      };

      expect(verifyRoundTrip(obj)).toBe(true);
    });

    it("should handle array of objects", () => {
      const obj = {
        items: [
          { id: "1", name: "First" },
          { id: "2", name: "Second" },
          { id: "3", name: "Third" },
        ],
      };

      expect(verifyRoundTrip(obj)).toBe(true);
    });

    it("should handle mixed types in array", () => {
      const obj = {
        values: [1, "two", true, null, { key: "value" }],
      };

      expect(verifyRoundTrip(obj)).toBe(true);
    });

    it("should handle strings with quotes", () => {
      const obj = {
        message: 'He said "hello" to her',
        command: "echo 'test'",
      };

      expect(verifyRoundTrip(obj)).toBe(true);
    });

    it("should handle strings with backslashes", () => {
      const obj = {
        path: "C:\\Users\\Test\\file.txt",
        regex: "\\d+\\.\\d+",
      };

      expect(verifyRoundTrip(obj)).toBe(true);
    });

    it("should handle ISO dates", () => {
      const obj = {
        created_at: "2025-01-01T00:00:00.000Z",
        updated_at: "2025-12-31T23:59:59.999Z",
      };

      expect(verifyRoundTrip(obj)).toBe(true);
    });

    it("should handle numbers of different types", () => {
      const obj = {
        int: 42,
        float: 3.14159,
        negative: -100,
        zero: 0,
        large: 9007199254740991, // Number.MAX_SAFE_INTEGER
      };

      expect(verifyRoundTrip(obj)).toBe(true);
    });

    it("should handle boolean values", () => {
      const obj = {
        enabled: true,
        disabled: false,
      };

      expect(verifyRoundTrip(obj)).toBe(true);
    });

    it("should handle special YAML characters in strings", () => {
      const obj = {
        colon: "key: value",
        hash: "# comment",
        dash: "- item",
        bracket: "[array]",
        brace: "{object}",
        pipe: "a | b",
        gt: "a > b",
        at: "@mention",
        backtick: "`code`",
      };

      expect(verifyRoundTrip(obj)).toBe(true);
    });
  });
});
