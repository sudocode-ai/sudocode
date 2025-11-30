/**
 * Tests for PromptResolver service
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { PromptResolver } from "../../../src/services/prompt-resolver.js"
import type { Spec, Issue } from "@sudocode-ai/types"
import * as specsService from "../../../src/services/specs.js"
import * as issuesService from "../../../src/services/issues.js"

// Mock the service modules
vi.mock("../../../src/services/specs.js", () => ({
  getSpecById: vi.fn(),
}))

vi.mock("../../../src/services/issues.js", () => ({
  getIssueById: vi.fn(),
}))

const mockGetSpecById = vi.mocked(specsService.getSpecById)
const mockGetIssueById = vi.mocked(issuesService.getIssueById)

describe("PromptResolver", () => {
  let resolver: PromptResolver
  let mockDb: any

  beforeEach(() => {
    mockDb = {} as any
    resolver = new PromptResolver(mockDb)
    mockGetSpecById.mockClear()
    mockGetIssueById.mockClear()
  })

  describe("resolve", () => {
    it("should resolve a simple spec reference", async () => {
      const mockSpec: Spec = {
        id: "s-abc123",
        uuid: "uuid-spec",
        title: "Test Spec",
        file_path: "/path/to/spec.md",
        content: "This is the spec content.",
        priority: 2,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-02T00:00:00Z",
      }

      mockGetSpecById.mockReturnValue(mockSpec)

      const prompt = "Please implement [[s-abc123]]"
      const result = await resolver.resolve(prompt)

      expect(result.errors).toHaveLength(0)
      expect(result.references).toHaveLength(1)
      expect(result.references[0]).toMatchObject({
        type: "spec",
        id: "s-abc123",
        found: true,
      })

      // Now returns raw content only, not formatted headers
      expect(result.resolvedPrompt).toContain("This is the spec content.")
      expect(mockGetSpecById).toHaveBeenCalledWith(mockDb, "s-abc123")
    })

    it("should resolve a simple issue reference", async () => {
      const mockIssue: Issue = {
        id: "i-xyz789",
        uuid: "uuid-issue",
        title: "Test Issue",
        content: "This is the issue description.",
        status: "open",
        priority: 1,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-02T00:00:00Z",
      }

      mockGetIssueById.mockReturnValue(mockIssue)

      const prompt = "Fix the bug described in [[i-xyz789]]"
      const result = await resolver.resolve(prompt)

      expect(result.errors).toHaveLength(0)
      expect(result.references).toHaveLength(1)
      expect(result.references[0]).toMatchObject({
        type: "issue",
        id: "i-xyz789",
        found: true,
      })

      // Now returns raw content only, not formatted headers
      expect(result.resolvedPrompt).toContain("This is the issue description.")
      expect(mockGetIssueById).toHaveBeenCalledWith(mockDb, "i-xyz789")
    })

    it("should track file mentions without resolving them", async () => {
      const prompt = "Review @src/components/App.tsx and @README.md"
      const result = await resolver.resolve(prompt)

      expect(result.errors).toHaveLength(0)
      expect(result.references).toHaveLength(2)

      const fileRefs = result.references.filter((r) => r.type === "file")
      expect(fileRefs).toHaveLength(2)
      expect(fileRefs[0]).toMatchObject({
        type: "file",
        id: "src/components/App.tsx",
        found: true,
      })
      expect(fileRefs[1]).toMatchObject({
        type: "file",
        id: "README.md",
        found: true,
      })

      // File mentions should not be modified in prompt
      expect(result.resolvedPrompt).toBe(prompt)
    })

    it("should handle mixed references (specs, issues, files)", async () => {
      const mockSpec: Spec = {
        id: "s-abc123",
        uuid: "uuid-spec",
        title: "API Spec",
        file_path: "/path/to/spec.md",
        content: "API design document.",
        priority: 2,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-02T00:00:00Z",
      }

      const mockIssue: Issue = {
        id: "i-xyz789",
        uuid: "uuid-issue",
        title: "Implement API",
        content: "Implement the API endpoints.",
        status: "in_progress",
        priority: 1,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-02T00:00:00Z",
      }

      mockGetSpecById.mockReturnValue(mockSpec)
      mockGetIssueById.mockReturnValue(mockIssue)

      const prompt =
        "Implement [[s-abc123]] as described in [[i-xyz789]]. Review @src/api/routes.ts"
      const result = await resolver.resolve(prompt)

      expect(result.errors).toHaveLength(0)
      expect(result.references).toHaveLength(3)

      const specRefs = result.references.filter((r) => r.type === "spec")
      const issueRefs = result.references.filter((r) => r.type === "issue")
      const fileRefs = result.references.filter((r) => r.type === "file")

      expect(specRefs).toHaveLength(1)
      expect(issueRefs).toHaveLength(1)
      expect(fileRefs).toHaveLength(1)

      // Now returns raw content only
      expect(result.resolvedPrompt).toContain("Implement the API endpoints.")
      expect(result.resolvedPrompt).toContain("@src/api/routes.ts")
    })

    it("should handle missing spec references", async () => {
      mockGetSpecById.mockReturnValue(null)

      const prompt = "Implement [[s-missing]]"
      const result = await resolver.resolve(prompt)

      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toBe("Spec s-missing not found")
      expect(result.references).toHaveLength(1)
      expect(result.references[0]).toMatchObject({
        type: "spec",
        id: "s-missing",
        found: false,
        error: "Spec s-missing not found",
      })

      // Reference should not be replaced
      expect(result.resolvedPrompt).toBe(prompt)
    })

    it("should handle missing issue references", async () => {
      mockGetIssueById.mockReturnValue(null)

      const prompt = "Fix [[i-missing]]"
      const result = await resolver.resolve(prompt)

      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toBe("Issue i-missing not found")
      expect(result.references).toHaveLength(1)
      expect(result.references[0]).toMatchObject({
        type: "issue",
        id: "i-missing",
        found: false,
        error: "Issue i-missing not found",
      })

      // Reference should not be replaced
      expect(result.resolvedPrompt).toBe(prompt)
    })

    it("should handle multiple occurrences of same reference", async () => {
      const mockSpec: Spec = {
        id: "s-abc123",
        uuid: "uuid-spec",
        title: "Test Spec",
        file_path: "/path/to/spec.md",
        content: "Spec content.",
        priority: 2,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-02T00:00:00Z",
      }

      mockGetSpecById.mockReturnValue(mockSpec)

      const prompt =
        "Read [[s-abc123]] first. Then implement [[s-abc123]] carefully."
      const result = await resolver.resolve(prompt)

      expect(result.errors).toHaveLength(0)
      expect(result.references).toHaveLength(1) // Deduplicated
      expect(mockGetSpecById).toHaveBeenCalledTimes(1) // Only fetched once

      // Both occurrences should be replaced with raw content
      const occurrences = (result.resolvedPrompt.match(/Spec content\./g) || [])
        .length
      expect(occurrences).toBe(2)
    })

    it("should handle case-insensitive references", async () => {
      const mockSpec: Spec = {
        id: "s-abc123",
        uuid: "uuid-spec",
        title: "Test Spec",
        file_path: "/path/to/spec.md",
        content: "Spec content.",
        priority: 2,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-02T00:00:00Z",
      }

      mockGetSpecById.mockReturnValue(mockSpec)

      const prompt = "Implement [[S-ABC123]] and [[s-abc123]]"
      const result = await resolver.resolve(prompt)

      expect(result.errors).toHaveLength(0)
      expect(result.references).toHaveLength(1) // Deduplicated (both lowercase)
      expect(result.references[0].id).toBe("s-abc123")

      // Both occurrences should be replaced with raw content
      const occurrences = (result.resolvedPrompt.match(/Spec content\./g) || [])
        .length
      expect(occurrences).toBe(2)
    })

    it("should handle empty prompt", async () => {
      const prompt = ""
      const result = await resolver.resolve(prompt)

      expect(result.errors).toHaveLength(0)
      expect(result.references).toHaveLength(0)
      expect(result.resolvedPrompt).toBe("")
    })

    it("should handle prompt with no references", async () => {
      const prompt = "Just do some general work"
      const result = await resolver.resolve(prompt)

      expect(result.errors).toHaveLength(0)
      expect(result.references).toHaveLength(0)
      expect(result.resolvedPrompt).toBe(prompt)
    })

    it("should preserve markdown formatting in spec content", async () => {
      const mockSpec: Spec = {
        id: "s-abc123",
        uuid: "uuid-spec",
        title: "Formatted Spec",
        file_path: "/path/to/spec.md",
        content: "# Heading\n\n- List item 1\n- List item 2\n\n**Bold text**",
        priority: 2,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-02T00:00:00Z",
      }

      mockGetSpecById.mockReturnValue(mockSpec)

      const prompt = "Review [[s-abc123]]"
      const result = await resolver.resolve(prompt)

      expect(result.resolvedPrompt).toContain("# Heading")
      expect(result.resolvedPrompt).toContain("- List item 1")
      expect(result.resolvedPrompt).toContain("**Bold text**")
    })

    it("should preserve markdown formatting in issue content", async () => {
      const mockIssue: Issue = {
        id: "i-xyz789",
        uuid: "uuid-issue",
        title: "Formatted Issue",
        content: "## Steps\n\n1. First step\n2. Second step\n\n`code block`",
        status: "open",
        priority: 1,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-02T00:00:00Z",
      }

      mockGetIssueById.mockReturnValue(mockIssue)

      const prompt = "Complete [[i-xyz789]]"
      const result = await resolver.resolve(prompt)

      expect(result.resolvedPrompt).toContain("## Steps")
      expect(result.resolvedPrompt).toContain("1. First step")
      expect(result.resolvedPrompt).toContain("`code block`")
    })

    it("should return raw content without metadata", async () => {
      const mockSpec: Spec = {
        id: "s-abc123",
        uuid: "uuid-spec",
        title: "Test Spec",
        file_path: "/path/to/spec.md",
        content: "Content",
        priority: 3,
        created_at: "2025-01-01T10:00:00Z",
        updated_at: "2025-01-02T15:30:00Z",
      }

      mockGetSpecById.mockReturnValue(mockSpec)

      const prompt = "Review [[s-abc123]]"
      const result = await resolver.resolve(prompt)

      // Now returns raw content only, no metadata formatting
      expect(result.resolvedPrompt).toContain("Content")
      expect(result.resolvedPrompt).not.toContain("Created:")
      expect(result.resolvedPrompt).not.toContain("Updated:")
    })

    it("should handle file mentions with various formats", async () => {
      const prompt =
        "Review @src/file.ts, @./relative/path.js, and @/absolute/path.tsx"
      const result = await resolver.resolve(prompt)

      expect(result.references).toHaveLength(3)
      expect(result.references.map((r) => r.id)).toEqual([
        "src/file.ts",
        "./relative/path.js",
        "/absolute/path.tsx",
      ])
    })

    it("should handle spec references with alphanumeric IDs", async () => {
      const mockSpec: Spec = {
        id: "s-a1b2c3",
        uuid: "uuid-spec",
        title: "Alphanumeric Spec",
        file_path: "/path/to/spec.md",
        content: "Content",
        priority: 2,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-02T00:00:00Z",
      }

      mockGetSpecById.mockReturnValue(mockSpec)

      const prompt = "Implement [[s-a1b2c3]]"
      const result = await resolver.resolve(prompt)

      expect(result.errors).toHaveLength(0)
      expect(result.references).toHaveLength(1)
      expect(result.references[0].id).toBe("s-a1b2c3")
    })

    it("should handle issue references with alphanumeric IDs", async () => {
      const mockIssue: Issue = {
        id: "i-x9y8z7",
        uuid: "uuid-issue",
        title: "Alphanumeric Issue",
        content: "Content",
        status: "open",
        priority: 1,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-02T00:00:00Z",
      }

      mockGetIssueById.mockReturnValue(mockIssue)

      const prompt = "Fix [[i-x9y8z7]]"
      const result = await resolver.resolve(prompt)

      expect(result.errors).toHaveLength(0)
      expect(result.references).toHaveLength(1)
      expect(result.references[0].id).toBe("i-x9y8z7")
    })

    it("should accumulate multiple errors", async () => {
      mockGetSpecById.mockReturnValue(null)
      mockGetIssueById.mockReturnValue(null)

      const prompt = "Implement [[s-missing1]] and [[s-missing2]], fix [[i-missing]]"
      const result = await resolver.resolve(prompt)

      expect(result.errors).toHaveLength(3)
      expect(result.errors).toContain("Spec s-missing1 not found")
      expect(result.errors).toContain("Spec s-missing2 not found")
      expect(result.errors).toContain("Issue i-missing not found")
    })

    it("should handle partial resolution (some found, some missing)", async () => {
      const mockSpec: Spec = {
        id: "s-found",
        uuid: "uuid-spec",
        title: "Found Spec",
        file_path: "/path/to/spec.md",
        content: "Content",
        priority: 2,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-02T00:00:00Z",
      }

      mockGetSpecById.mockImplementation((db, id) =>
        id === "s-found" ? mockSpec : null
      )

      const prompt = "Implement [[s-found]] and [[s-missing]]"
      const result = await resolver.resolve(prompt)

      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toBe("Spec s-missing not found")

      expect(result.references).toHaveLength(2)
      expect(result.references.find((r) => r.id === "s-found")?.found).toBe(true)
      expect(result.references.find((r) => r.id === "s-missing")?.found).toBe(
        false
      )

      // Only found spec should be replaced
      expect(result.resolvedPrompt).toContain("[[s-missing]]")
    })
  })

  describe("@ mention syntax", () => {
    it("should resolve @s-xxxxx spec mentions", async () => {
      const mockSpec: Spec = {
        id: "s-abc123",
        uuid: "uuid-spec",
        title: "Test Spec",
        file_path: "/path/to/spec.md",
        content: "Spec content.",
        priority: 2,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-02T00:00:00Z",
      }

      mockGetSpecById.mockReturnValue(mockSpec)

      const prompt = "Implement @s-abc123 please"
      const result = await resolver.resolve(prompt)

      expect(result.errors).toHaveLength(0)
      expect(result.references).toHaveLength(1)
      expect(result.references[0]).toMatchObject({
        type: "spec",
        id: "s-abc123",
        found: true,
      })

      expect(result.resolvedPrompt).not.toContain("@s-abc123")
    })

    it("should resolve @i-xxxxx issue mentions", async () => {
      const mockIssue: Issue = {
        id: "i-xyz789",
        uuid: "uuid-issue",
        title: "Test Issue",
        content: "Issue description.",
        status: "open",
        priority: 1,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-02T00:00:00Z",
      }

      mockGetIssueById.mockReturnValue(mockIssue)

      const prompt = "Fix @i-xyz789 urgently"
      const result = await resolver.resolve(prompt)

      expect(result.errors).toHaveLength(0)
      expect(result.references).toHaveLength(1)
      expect(result.references[0]).toMatchObject({
        type: "issue",
        id: "i-xyz789",
        found: true,
      })

      expect(result.resolvedPrompt).not.toContain("@i-xyz789")
    })

    it("should handle mixed @ and [[ ]] syntax", async () => {
      const mockSpec: Spec = {
        id: "s-spec1",
        uuid: "uuid-spec",
        title: "Spec 1",
        file_path: "/path/to/spec.md",
        content: "Spec content.",
        priority: 2,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-02T00:00:00Z",
      }

      const mockIssue: Issue = {
        id: "i-issue1",
        uuid: "uuid-issue",
        title: "Issue 1",
        content: "Issue description.",
        status: "open",
        priority: 1,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-02T00:00:00Z",
      }

      mockGetSpecById.mockReturnValue(mockSpec)
      mockGetIssueById.mockReturnValue(mockIssue)

      const prompt = "Implement @s-spec1 as described in [[i-issue1]]"
      const result = await resolver.resolve(prompt)

      expect(result.errors).toHaveLength(0)
      expect(result.references).toHaveLength(2)

    })

    it("should not confuse @entity-id with @file paths", async () => {
      const mockSpec: Spec = {
        id: "s-abc123",
        uuid: "uuid-spec",
        title: "Test Spec",
        file_path: "/path/to/spec.md",
        content: "Content",
        priority: 2,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-02T00:00:00Z",
      }

      mockGetSpecById.mockReturnValue(mockSpec)

      const prompt = "Review @s-abc123 and @src/components/App.tsx"
      const result = await resolver.resolve(prompt)

      expect(result.errors).toHaveLength(0)
      expect(result.references).toHaveLength(2)

      const specRefs = result.references.filter((r) => r.type === "spec")
      const fileRefs = result.references.filter((r) => r.type === "file")

      expect(specRefs).toHaveLength(1)
      expect(fileRefs).toHaveLength(1)
      expect(fileRefs[0].id).toBe("src/components/App.tsx")

      // Spec should be replaced, file should not
      expect(result.resolvedPrompt).toContain("@src/components/App.tsx")
    })

    it("should handle @entity-id at end of sentence", async () => {
      const mockSpec: Spec = {
        id: "s-abc123",
        uuid: "uuid-spec",
        title: "Test Spec",
        file_path: "/path/to/spec.md",
        content: "Content",
        priority: 2,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-02T00:00:00Z",
      }

      mockGetSpecById.mockReturnValue(mockSpec)

      const prompt = "Implement @s-abc123."
      const result = await resolver.resolve(prompt)

      expect(result.errors).toHaveLength(0)
      expect(result.references).toHaveLength(1)
    })

    it("should deduplicate same entity mentioned with different syntaxes", async () => {
      const mockSpec: Spec = {
        id: "s-abc123",
        uuid: "uuid-spec",
        title: "Test Spec",
        file_path: "/path/to/spec.md",
        content: "Content",
        priority: 2,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-02T00:00:00Z",
      }

      mockGetSpecById.mockReturnValue(mockSpec)

      const prompt = "Review [[s-abc123]] and then implement @s-abc123"
      const result = await resolver.resolve(prompt)

      expect(result.errors).toHaveLength(0)
      expect(result.references).toHaveLength(1) // Deduplicated
      expect(mockGetSpecById).toHaveBeenCalledTimes(1) // Only fetched once

      // Both occurrences should be replaced with raw content
      const occurrences = (result.resolvedPrompt.match(/Content/g) || [])
        .length
      expect(occurrences).toBe(2)
    })

    it("should handle @entity-id with comma after it", async () => {
      const mockIssue: Issue = {
        id: "i-xyz789",
        uuid: "uuid-issue",
        title: "Test Issue",
        content: "Issue description.",
        status: "open",
        priority: 1,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-02T00:00:00Z",
      }

      mockGetIssueById.mockReturnValue(mockIssue)

      const prompt = "Fix @i-xyz789, then test it"
      const result = await resolver.resolve(prompt)

      expect(result.errors).toHaveLength(0)
      expect(result.references).toHaveLength(1)
    })
  })
})
