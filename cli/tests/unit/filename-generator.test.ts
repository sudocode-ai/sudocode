/**
 * Unit tests for filename generator
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  titleToFilename,
  generateUniqueFilename,
  findExistingEntityFile,
} from "../../src/filename-generator.js";

describe("Filename Generator", () => {
  describe("titleToFilename", () => {
    it("should convert simple title to snake_case", () => {
      expect(titleToFilename("Implement Watch Mode")).toBe(
        "implement_watch_mode"
      );
    });

    it("should handle special characters", () => {
      expect(titleToFilename("User Auth & Permissions!")).toBe(
        "user_auth_permissions"
      );
    });

    it("should handle multiple spaces", () => {
      expect(titleToFilename("Multiple    Spaces    Test")).toBe(
        "multiple_spaces_test"
      );
    });

    it("should trim underscores from edges", () => {
      expect(titleToFilename("  Leading and Trailing  ")).toBe(
        "leading_and_trailing"
      );
    });

    it("should handle numbers", () => {
      expect(titleToFilename("Version 2.0 Update")).toBe("version_2_0_update");
    });

    it("should truncate long titles", () => {
      const longTitle =
        "This is a very long title that should be truncated to a reasonable length for filenames";
      const result = titleToFilename(longTitle, 50);
      expect(result.length).toBeLessThanOrEqual(50);
      expect(result).toBe("this_is_a_very_long_title_that_should_be_truncated");
    });

    it("should handle unicode characters", () => {
      expect(titleToFilename("Café & Piñata 🎉")).toBe("caf_pi_ata");
    });

    it("should handle empty string", () => {
      expect(titleToFilename("")).toBe("");
    });
  });

  describe("generateUniqueFilename", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "filename-test-"));
    });

    afterEach(() => {
      if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should generate unified format with ID and title slug", () => {
      const filename = generateUniqueFilename("Test Spec", "spec-001");
      expect(filename).toBe("spec-001_test_spec.md");
    });

    it("should generate unified format even when file exists", () => {
      // Create existing file - unified format always uses {id}_{title_slug}
      const existingFile = path.join(tempDir, "spec-001_test_spec.md");
      fs.writeFileSync(
        existingFile,
        `---
id: spec-001
title: Test Spec
---

Content`,
        "utf8"
      );

      const filename = generateUniqueFilename("Test Spec", "spec-001");
      expect(filename).toBe("spec-001_test_spec.md");
    });

    it("should generate unique filenames for different IDs with same title", () => {
      const filename1 = generateUniqueFilename("Test Spec", "spec-001");
      const filename2 = generateUniqueFilename("Test Spec", "spec-002");

      expect(filename1).toBe("spec-001_test_spec.md");
      expect(filename2).toBe("spec-002_test_spec.md");
      expect(filename1).not.toBe(filename2);
    });

    it("should handle custom extension", () => {
      const filename = generateUniqueFilename("Test Spec", "spec-001", ".txt");
      expect(filename).toBe("spec-001_test_spec.txt");
    });
  });

  describe("findExistingEntityFile", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "filename-test-"));
    });

    afterEach(() => {
      if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should find unified format filename (new standard)", () => {
      const unifiedFile = path.join(tempDir, "spec-001_test_spec.md");
      fs.writeFileSync(
        unifiedFile,
        `---
id: spec-001
title: Test Spec
---

Content`,
        "utf8"
      );

      const found = findExistingEntityFile("spec-001", tempDir, "Test Spec");
      expect(found).toBe(unifiedFile);
    });

    it("should find ID-based filename (legacy)", () => {
      const legacyFile = path.join(tempDir, "spec-001.md");
      fs.writeFileSync(
        legacyFile,
        `---
id: spec-001
title: Test Spec
---

Content`,
        "utf8"
      );

      const found = findExistingEntityFile("spec-001", tempDir, "Test Spec");
      expect(found).toBe(legacyFile);
    });

    it("should find title-based filename (legacy)", () => {
      const titleFile = path.join(tempDir, "test_spec.md");
      fs.writeFileSync(
        titleFile,
        `---
id: spec-001
title: Test Spec
---

Content`,
        "utf8"
      );

      const found = findExistingEntityFile("spec-001", tempDir, "Test Spec");
      expect(found).toBe(titleFile);
    });

    it("should find title-based with ID suffix (legacy)", () => {
      const titleWithIdFile = path.join(tempDir, "test_spec_spec-001.md");
      fs.writeFileSync(
        titleWithIdFile,
        `---
id: spec-001
title: Test Spec
---

Content`,
        "utf8"
      );

      const found = findExistingEntityFile("spec-001", tempDir, "Test Spec");
      expect(found).toBe(titleWithIdFile);
    });

    it("should prioritize unified format over legacy formats", () => {
      // Create both unified and legacy files
      const unifiedFile = path.join(tempDir, "spec-001_test_spec.md");
      const legacyFile = path.join(tempDir, "spec-001.md");

      fs.writeFileSync(
        unifiedFile,
        `---
id: spec-001
title: Test Spec
---

Content`,
        "utf8"
      );

      fs.writeFileSync(
        legacyFile,
        `---
id: spec-001
title: Test Spec
---

Content`,
        "utf8"
      );

      const found = findExistingEntityFile("spec-001", tempDir, "Test Spec");
      // Should find unified format first
      expect(found).toBe(unifiedFile);
    });

    it("should return null when not found", () => {
      const found = findExistingEntityFile("spec-404", tempDir, "Nonexistent");
      expect(found).toBeNull();
    });

    it("should verify ID in frontmatter for title-based lookup", () => {
      // Create file with matching title but wrong ID
      const wrongIdFile = path.join(tempDir, "test_spec.md");
      fs.writeFileSync(
        wrongIdFile,
        `---
id: spec-wrong
title: Test Spec
---

Content`,
        "utf8"
      );

      // Should not find it (ID mismatch)
      const found = findExistingEntityFile("spec-001", tempDir, "Test Spec");
      expect(found).toBeNull();
    });
  });
});
