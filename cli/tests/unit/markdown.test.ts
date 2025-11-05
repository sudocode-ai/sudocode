/**
 * Unit tests for markdown parser
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  parseMarkdown,
  parseMarkdownFile,
  extractCrossReferences,
  stringifyMarkdown,
  createMarkdown,
  updateFrontmatter,
  updateFrontmatterFile,
  hasFrontmatter,
  removeFrontmatter,
  getFrontmatter,
  writeMarkdownFile,
} from "../../src/markdown.js";

const TEST_DIR = path.join(process.cwd(), "test-markdown");

describe("Markdown Parser", () => {
  beforeEach(() => {
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe("parseMarkdown", () => {
    it("should parse markdown with YAML frontmatter", () => {
      const content = `---
title: Test Document
status: draft
priority: 2
---

# Content

This is the main content.`;

      const result = parseMarkdown(content);

      expect(result.data.title).toBe("Test Document");
      expect(result.data.status).toBe("draft");
      expect(result.data.priority).toBe(2);
      expect(result.content).toContain("# Content");
      expect(result.content).toContain("This is the main content.");
      expect(result.raw).toBe(content);
    });

    it("should parse markdown without frontmatter", () => {
      const content = `# Just Content

No frontmatter here.`;

      const result = parseMarkdown(content);

      expect(result.data).toEqual({});
      expect(result.content).toBe(content);
      expect(result.raw).toBe(content);
    });

    it("should parse empty frontmatter", () => {
      const content = `---
---

# Content`;

      const result = parseMarkdown(content);

      expect(result.data).toEqual({});
      expect(result.content).toContain("# Content");
    });

    it("should parse complex nested frontmatter", () => {
      const content = `---
title: Complex Document
metadata:
  author: Alice
  tags:
    - typescript
    - testing
  nested:
    level: 3
---

Content here.`;

      const result = parseMarkdown(content);

      expect(result.data.title).toBe("Complex Document");
      expect(result.data.metadata.author).toBe("Alice");
      expect(result.data.metadata.tags).toEqual(["typescript", "testing"]);
      expect(result.data.metadata.nested.level).toBe(3);
    });

    it("should preserve content with code blocks", () => {
      const content = `---
title: Code Example
---

\`\`\`typescript
const x = 1;
\`\`\``;

      const result = parseMarkdown(content);

      expect(result.data.title).toBe("Code Example");
      expect(result.content).toContain("```typescript");
      expect(result.content).toContain("const x = 1;");
    });
  });

  describe("parseMarkdownFile", () => {
    it("should read and parse markdown from file", () => {
      const filePath = path.join(TEST_DIR, "test.md");
      const content = `---
title: File Test
---

Content from file.`;

      fs.writeFileSync(filePath, content, "utf8");

      const result = parseMarkdownFile(filePath);

      expect(result.data.title).toBe("File Test");
      expect(result.content).toContain("Content from file.");
    });
  });

  describe("extractCrossReferences", () => {
    it("should extract spec references", () => {
      const content = `
See [[s-001a]] and [[s-042b]] for details.
Also check [[s-999c]].
`;

      const refs = extractCrossReferences(content);

      expect(refs).toHaveLength(3);
      expect(refs[0].id).toBe("s-001a");
      expect(refs[0].type).toBe("spec");
      expect(refs[0].match).toBe("[[s-001a]]");
      expect(refs[1].id).toBe("s-042b");
      expect(refs[2].id).toBe("s-999c");
    });

    it("should extract issue references with @ prefix", () => {
      const content = `
Fixes [[@i-001a]] and resolves [[@i-042a]].
`;

      const refs = extractCrossReferences(content);

      expect(refs).toHaveLength(2);
      expect(refs[0].id).toBe("i-001a");
      expect(refs[0].type).toBe("issue");
      expect(refs[0].match).toBe("[[@i-001a]]");
      expect(refs[1].id).toBe("i-042a");
      expect(refs[1].type).toBe("issue");
    });

    it("should extract issue references without @ prefix", () => {
      const content = `
Related to [[i-001a]] and [[i-042a]].
`;

      const refs = extractCrossReferences(content);

      expect(refs).toHaveLength(2);
      expect(refs[0].id).toBe("i-001a");
      expect(refs[0].type).toBe("issue");
      expect(refs[0].match).toBe("[[i-001a]]");
    });

    it("should extract mixed spec and issue references", () => {
      const content = `
Implements [[s-001a]] via [[@i-042a]].
See also [[s-003a]] and [[i-005a]].
`;

      const refs = extractCrossReferences(content);

      expect(refs).toHaveLength(4);

      const spec1 = refs.find((r) => r.id === "s-001a");
      expect(spec1?.type).toBe("spec");

      const issue42 = refs.find((r) => r.id === "i-042a");
      expect(issue42?.type).toBe("issue");

      const spec3 = refs.find((r) => r.id === "s-003a");
      expect(spec3?.type).toBe("spec");

      const issue5 = refs.find((r) => r.id === "i-005a");
      expect(issue5?.type).toBe("issue");
    });

    it("should return empty array when no references", () => {
      const content = "No references here.";
      const refs = extractCrossReferences(content);
      expect(refs).toHaveLength(0);
    });

    it("should handle references in code blocks", () => {
      const content = `
Regular [[s-001a]]

\`\`\`
Code [[s-002a]]
\`\`\`

More [[s-003a]]
`;

      const refs = extractCrossReferences(content);

      // Should find all 3, including the one in code block
      expect(refs).toHaveLength(3);
    });

    it("should track reference positions", () => {
      const content = "Start [[s-001a]] middle [[s-002a]] end";
      const refs = extractCrossReferences(content);

      expect(refs[0].index).toBe(6); // "Start "
      expect(refs[1].index).toBe(24); // "Start [[s-001a]] middle "
    });

    it("should extract references with display text", () => {
      const content = `
See [[s-001a|Authentication Flow]] for details.
Also [[i-042a|Bug Fix]].
`;

      const refs = extractCrossReferences(content);

      expect(refs).toHaveLength(2);
      expect(refs[0].id).toBe("s-001a");
      expect(refs[0].type).toBe("spec");
      expect(refs[0].displayText).toBe("Authentication Flow");
      expect(refs[0].relationshipType).toBeUndefined();

      expect(refs[1].id).toBe("i-042a");
      expect(refs[1].type).toBe("issue");
      expect(refs[1].displayText).toBe("Bug Fix");
    });

    it("should extract references with relationship type (shorthand)", () => {
      const content = `
This spec [[s-001a]]{ blocks } the implementation.
Requires [[s-002a]]{ depends-on } to be completed.
`;

      const refs = extractCrossReferences(content);

      expect(refs).toHaveLength(2);
      expect(refs[0].id).toBe("s-001a");
      expect(refs[0].type).toBe("spec");
      expect(refs[0].relationshipType).toBe("blocks");
      expect(refs[0].displayText).toBeUndefined();

      expect(refs[1].id).toBe("s-002a");
      expect(refs[1].relationshipType).toBe("depends-on");
    });

    it("should extract references with relationship type (explicit)", () => {
      const content = `
Implementation [[s-001a]]{ type: implements } the requirements.
Related to [[i-042a]]{ type: related }.
`;

      const refs = extractCrossReferences(content);

      expect(refs).toHaveLength(2);
      expect(refs[0].id).toBe("s-001a");
      expect(refs[0].relationshipType).toBe("implements");

      expect(refs[1].id).toBe("i-042a");
      expect(refs[1].relationshipType).toBe("related");
    });

    it("should extract references with both display text and relationship type", () => {
      const content = `
See [[s-001a|Auth Flow]]{ implements } for the implementation.
Also [[i-042a|Bug Fix]]{ blocks } this work.
`;

      const refs = extractCrossReferences(content);

      expect(refs).toHaveLength(2);
      expect(refs[0].id).toBe("s-001a");
      expect(refs[0].type).toBe("spec");
      expect(refs[0].displayText).toBe("Auth Flow");
      expect(refs[0].relationshipType).toBe("implements");

      expect(refs[1].id).toBe("i-042a");
      expect(refs[1].type).toBe("issue");
      expect(refs[1].displayText).toBe("Bug Fix");
      expect(refs[1].relationshipType).toBe("blocks");
    });

    it("should handle relationship type metadata with extra whitespace", () => {
      const content = `
[[s-001a]]{  blocks  }
[[s-002a]]{ type:  depends-on  }
`;

      const refs = extractCrossReferences(content);

      expect(refs).toHaveLength(2);
      expect(refs[0].relationshipType).toBe("blocks");
      expect(refs[1].relationshipType).toBe("depends-on");
    });

    it("should extract mixed references with and without metadata", () => {
      const content = `
Regular [[s-001a]] reference.
With display [[s-002a|Display Text]].
With type [[s-003a]]{ blocks }.
With both [[s-004a|Both]]{ implements }.
`;

      const refs = extractCrossReferences(content);

      expect(refs).toHaveLength(4);

      expect(refs[0].id).toBe("s-001a");
      expect(refs[0].displayText).toBeUndefined();
      expect(refs[0].relationshipType).toBeUndefined();

      expect(refs[1].id).toBe("s-002a");
      expect(refs[1].displayText).toBe("Display Text");
      expect(refs[1].relationshipType).toBeUndefined();

      expect(refs[2].id).toBe("s-003a");
      expect(refs[2].displayText).toBeUndefined();
      expect(refs[2].relationshipType).toBe("blocks");

      expect(refs[3].id).toBe("s-004a");
      expect(refs[3].displayText).toBe("Both");
      expect(refs[3].relationshipType).toBe("implements");
    });
  });

  describe("stringifyMarkdown", () => {
    it("should create markdown with frontmatter", () => {
      const data = {
        title: "Test",
        status: "draft",
      };
      const content = "# Content here";

      const result = stringifyMarkdown(data, content);

      expect(result).toContain("---");
      expect(result).toContain("title: Test");
      expect(result).toContain("status: draft");
      expect(result).toContain("# Content here");
    });

    it("should handle empty data", () => {
      const result = stringifyMarkdown({}, "# Content");
      expect(result).toContain("# Content");
    });
  });

  describe("createMarkdown", () => {
    it("should create markdown document", () => {
      const data = { title: "New Doc" };
      const content = "Body";

      const result = createMarkdown(data, content);

      expect(result).toContain("title: New Doc");
      expect(result).toContain("Body");
    });
  });

  describe("updateFrontmatter", () => {
    it("should update existing frontmatter fields", () => {
      const original = `---
title: Original
status: draft
---

Content`;

      const updated = updateFrontmatter(original, {
        status: "approved",
        priority: 3,
      });

      expect(updated).toContain("title: Original");
      expect(updated).toContain("status: approved");
      expect(updated).toContain("priority: 3");
      expect(updated).toContain("Content");
    });

    it("should add new frontmatter fields", () => {
      const original = `---
title: Original
---

Content`;

      const updated = updateFrontmatter(original, {
        status: "draft",
      });

      expect(updated).toContain("title: Original");
      expect(updated).toContain("status: draft");
    });

    it("should preserve content unchanged", () => {
      const original = `---
title: Test
---

# Important Content

With **formatting** and \`code\`.

- List items
- More items`;

      const updated = updateFrontmatter(original, {
        status: "updated",
      });

      const originalContent = original.split("---\n")[2];
      const updatedContent = updated.split("---\n")[2];

      // gray-matter may add a trailing newline, so trim for comparison
      expect(updatedContent.trim()).toBe(originalContent.trim());
    });

    it("should create frontmatter if none exists", () => {
      const original = `# Just Content

No frontmatter.`;

      const updated = updateFrontmatter(original, {
        title: "Added Title",
      });

      expect(updated).toContain("title: Added Title");
      expect(updated).toContain("# Just Content");
    });
  });

  describe("updateFrontmatterFile", () => {
    it("should update frontmatter in file", () => {
      const filePath = path.join(TEST_DIR, "update.md");
      const original = `---
title: Original
---

Content`;

      fs.writeFileSync(filePath, original, "utf8");

      updateFrontmatterFile(filePath, {
        title: "Updated",
        status: "new",
      });

      const updated = fs.readFileSync(filePath, "utf8");

      expect(updated).toContain("title: Updated");
      expect(updated).toContain("status: new");
      expect(updated).toContain("Content");
    });
  });

  describe("hasFrontmatter", () => {
    it("should return true for content with frontmatter", () => {
      const content = `---
title: Test
---

Content`;

      expect(hasFrontmatter(content)).toBe(true);
    });

    it("should return false for content without frontmatter", () => {
      const content = "# Just content";
      expect(hasFrontmatter(content)).toBe(false);
    });

    it("should handle content with leading whitespace", () => {
      const content = `

---
title: Test
---

Content`;

      expect(hasFrontmatter(content)).toBe(true);
    });
  });

  describe("removeFrontmatter", () => {
    it("should remove frontmatter and return only content", () => {
      const content = `---
title: Test
status: draft
---

# Main Content

Body text.`;

      const result = removeFrontmatter(content);

      expect(result).not.toContain("---");
      expect(result).not.toContain("title: Test");
      expect(result).toContain("# Main Content");
      expect(result).toContain("Body text.");
    });

    it("should return content unchanged if no frontmatter", () => {
      const content = "# Content only";
      const result = removeFrontmatter(content);
      expect(result).toBe(content);
    });
  });

  describe("getFrontmatter", () => {
    it("should extract only frontmatter data", () => {
      const content = `---
title: Test
priority: 3
tags:
  - one
  - two
---

Content here.`;

      const data = getFrontmatter(content);

      expect(data.title).toBe("Test");
      expect(data.priority).toBe(3);
      expect(data.tags).toEqual(["one", "two"]);
    });

    it("should return empty object if no frontmatter", () => {
      const content = "# Just content";
      const data = getFrontmatter(content);
      expect(data).toEqual({});
    });
  });

  describe("writeMarkdownFile", () => {
    it("should write markdown file with frontmatter", () => {
      const filePath = path.join(TEST_DIR, "new.md");
      const data = {
        title: "New File",
        status: "draft",
      };
      const content = "# Content";

      writeMarkdownFile(filePath, data, content);

      const written = fs.readFileSync(filePath, "utf8");

      expect(written).toContain("title: New File");
      expect(written).toContain("status: draft");
      expect(written).toContain("# Content");
    });
  });

  describe("parseMarkdown with references", () => {
    it("should parse content and extract references in one call", () => {
      const content = `---
title: Doc with refs
---

See [[s-001a]] and [[@i-042a]].`;

      const result = parseMarkdown(content);

      expect(result.data.title).toBe("Doc with refs");
      expect(result.references).toHaveLength(2);
      expect(result.references[0].id).toBe("s-001a");
      expect(result.references[1].id).toBe("i-042a");
    });
  });

  describe("Cross-reference anchors", () => {
    it("should create anchors for cross-references", () => {
      const content = `# Main Section

This is a paragraph with [[s-001a]] reference.

Another paragraph with [[s-002a]].`;

      const refs = extractCrossReferences(content);

      expect(refs).toHaveLength(2);

      // First reference should have an anchor
      expect(refs[0].anchor).toBeDefined();
      expect(refs[0].anchor?.section_heading).toBe("Main Section");
      expect(refs[0].anchor?.section_level).toBe(1);
      expect(refs[0].anchor?.line_number).toBeDefined();
      expect(refs[0].anchor?.text_snippet).toBeDefined();
      expect(refs[0].anchor?.content_hash).toBeDefined();

      // Second reference should also have an anchor
      expect(refs[1].anchor).toBeDefined();
      expect(refs[1].anchor?.section_heading).toBe("Main Section");
    });

    it("should include context in anchors", () => {
      const content = `# Authentication

## Login Flow

The user authentication [[s-001a|Auth Spec]] requires validation.

Post-login, redirect to dashboard.`;

      const refs = extractCrossReferences(content);

      expect(refs).toHaveLength(1);
      expect(refs[0].anchor).toBeDefined();
      expect(refs[0].anchor?.section_heading).toBe("Login Flow");
      expect(refs[0].anchor?.section_level).toBe(2);
      expect(refs[0].anchor?.context_before).toBeDefined();
      expect(refs[0].anchor?.context_after).toBeDefined();
    });

    it("should create unique anchors for multiple references on same line", () => {
      const content = `# Overview

See [[s-001a]] and [[s-002a]] for details.`;

      const refs = extractCrossReferences(content);

      expect(refs).toHaveLength(2);
      expect(refs[0].anchor).toBeDefined();
      expect(refs[1].anchor).toBeDefined();

      // Both should have same section but potentially different offsets
      expect(refs[0].anchor?.section_heading).toBe("Overview");
      expect(refs[1].anchor?.section_heading).toBe("Overview");
      expect(refs[0].anchor?.line_number).toBe(refs[1].anchor?.line_number);
    });

    it("should handle references without section headings", () => {
      const content = `Just a reference [[s-001a]] with no heading.`;

      const refs = extractCrossReferences(content);

      expect(refs).toHaveLength(1);
      expect(refs[0].anchor).toBeDefined();
      expect(refs[0].anchor?.section_heading).toBeUndefined();
      expect(refs[0].anchor?.line_number).toBe(1);
    });

    it("should track line numbers correctly", () => {
      const content = `Line 1
Line 2
Line 3 with [[s-001a]]
Line 4
Line 5 with [[s-002a]]`;

      const refs = extractCrossReferences(content);

      expect(refs).toHaveLength(2);
      expect(refs[0].anchor?.line_number).toBe(3);
      expect(refs[1].anchor?.line_number).toBe(5);
    });

    it("should create anchors with all reference metadata", () => {
      const content = `# Features

Implementing [[s-001a|Authentication]]{ implements } is required.`;

      const refs = extractCrossReferences(content);

      expect(refs).toHaveLength(1);
      expect(refs[0].id).toBe("s-001a");
      expect(refs[0].displayText).toBe("Authentication");
      expect(refs[0].relationshipType).toBe("implements");
      expect(refs[0].anchor).toBeDefined();
      expect(refs[0].anchor?.section_heading).toBe("Features");
      expect(refs[0].anchor?.text_snippet).toBeDefined();
      expect(refs[0].anchor?.text_snippet?.length).toBeGreaterThan(0);
    });

    it("should handle anchor creation failures gracefully", () => {
      // This tests that even if anchor creation fails, the reference is still extracted
      const content = `[[s-001a]]`;

      const refs = extractCrossReferences(content);

      expect(refs).toHaveLength(1);
      expect(refs[0].id).toBe("s-001a");
      // Anchor might be undefined or defined depending on implementation
      // The important part is that extraction doesn't fail
    });

    it("should create anchors for nested sections", () => {
      const content = `# Top Level

## Second Level

### Third Level

Reference to [[s-001a]] here.`;

      const refs = extractCrossReferences(content);

      expect(refs).toHaveLength(1);
      expect(refs[0].anchor).toBeDefined();
      expect(refs[0].anchor?.section_heading).toBe("Third Level");
      expect(refs[0].anchor?.section_level).toBe(3);
    });
  });
});
