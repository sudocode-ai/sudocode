/**
 * Tests for spec-parser
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  parseSpec,
  parseSpecContent,
  isSpecFile,
  getSpecFileTitle,
  getSpecFileStatus,
} from "../../src/parser/spec-parser.js";

describe("Spec Parser", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `speckit-spec-parser-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("parseSpec", () => {
    it("should parse a basic spec file", () => {
      const specFile = join(testDir, "spec.md");
      writeFileSync(
        specFile,
        `# Feature Specification: Authentication

**Feature Branch**: feature/auth
**Status**: Draft
**Created**: 2024-01-15

## Overview

This spec describes the authentication system.
`
      );

      const result = parseSpec(specFile);

      expect(result).not.toBeNull();
      expect(result?.title).toBe("Authentication");
      expect(result?.rawTitle).toBe("Feature Specification: Authentication");
      expect(result?.featureBranch).toBe("feature/auth");
      expect(result?.status).toBe("Draft");
      expect(result?.createdAt?.toISOString().startsWith("2024-01-15")).toBe(true);
      expect(result?.content).toContain("This spec describes");
    });

    it("should parse a spec without Feature Specification prefix", () => {
      const specFile = join(testDir, "spec.md");
      writeFileSync(
        specFile,
        `# User Management

**Status**: In Progress

Content here.
`
      );

      const result = parseSpec(specFile);

      expect(result).not.toBeNull();
      expect(result?.title).toBe("User Management");
      expect(result?.status).toBe("In Progress");
    });

    it("should extract cross-references", () => {
      const specFile = join(testDir, "spec.md");
      writeFileSync(
        specFile,
        `# Feature Specification: Auth

**Status**: Draft

See [[s-001-plan]] for implementation details.
Related to [[i-002|User Story 2]].
`
      );

      const result = parseSpec(specFile);

      expect(result?.crossReferences).toHaveLength(2);
      expect(result?.crossReferences[0]).toEqual({ id: "s-001-plan", displayText: undefined });
      expect(result?.crossReferences[1]).toEqual({ id: "i-002", displayText: "User Story 2" });
    });

    it("should return null for non-existent file", () => {
      const result = parseSpec(join(testDir, "nonexistent.md"));
      expect(result).toBeNull();
    });

    it("should return null for file without title", () => {
      const specFile = join(testDir, "spec.md");
      writeFileSync(specFile, "Just content without a title.\n");

      const result = parseSpec(specFile);
      expect(result).toBeNull();
    });

    it("should handle spec with only title", () => {
      const specFile = join(testDir, "spec.md");
      writeFileSync(specFile, "# Simple Spec\n");

      const result = parseSpec(specFile);

      expect(result).not.toBeNull();
      expect(result?.title).toBe("Simple Spec");
      expect(result?.status).toBeNull();
      expect(result?.featureBranch).toBeNull();
    });

    it("should preserve metadata map", () => {
      const specFile = join(testDir, "spec.md");
      writeFileSync(
        specFile,
        `# Spec Title

**Status**: Draft
**Author**: John Doe
**Priority**: High
**Custom Field**: Custom Value

Content.
`
      );

      const result = parseSpec(specFile);

      expect(result?.metadata.get("Status")).toBe("Draft");
      expect(result?.metadata.get("Author")).toBe("John Doe");
      expect(result?.metadata.get("Priority")).toBe("High");
      expect(result?.metadata.get("Custom Field")).toBe("Custom Value");
    });

    it("should not include content when includeContent is false", () => {
      const specFile = join(testDir, "spec.md");
      writeFileSync(
        specFile,
        `# Spec Title

**Status**: Draft

This is the content that should not be included.
`
      );

      const result = parseSpec(specFile, { includeContent: false });

      expect(result?.content).toBe("");
    });

    it("should not extract references when extractReferences is false", () => {
      const specFile = join(testDir, "spec.md");
      writeFileSync(
        specFile,
        `# Spec Title

See [[s-001-ref]] for details.
`
      );

      const result = parseSpec(specFile, { extractReferences: false });

      expect(result?.crossReferences).toHaveLength(0);
    });
  });

  describe("parseSpecContent", () => {
    it("should parse spec content from string", () => {
      const content = `# Feature Specification: Test Feature

**Status**: Complete
**Feature Branch**: feature/test

## Description

Test description here.
`;

      const result = parseSpecContent(content);

      expect(result).not.toBeNull();
      expect(result?.title).toBe("Test Feature");
      expect(result?.status).toBe("Complete");
      expect(result?.featureBranch).toBe("feature/test");
      expect(result?.filePath).toBe("<string>");
    });

    it("should accept custom file path", () => {
      const content = "# Test\n\nContent.\n";
      const result = parseSpecContent(content, "/custom/path.md");

      expect(result?.filePath).toBe("/custom/path.md");
    });
  });

  describe("isSpecFile", () => {
    it("should return true for file with Feature Specification prefix", () => {
      const specFile = join(testDir, "spec.md");
      writeFileSync(
        specFile,
        `# Feature Specification: Auth

Content.
`
      );

      expect(isSpecFile(specFile)).toBe(true);
    });

    it("should return true for file with Feature Branch metadata", () => {
      const specFile = join(testDir, "spec.md");
      writeFileSync(
        specFile,
        `# Auth System

**Feature Branch**: feature/auth

Content.
`
      );

      expect(isSpecFile(specFile)).toBe(true);
    });

    it("should return false for regular markdown file", () => {
      const mdFile = join(testDir, "readme.md");
      writeFileSync(
        mdFile,
        `# README

This is a regular markdown file.
`
      );

      expect(isSpecFile(mdFile)).toBe(false);
    });

    it("should return false for non-existent file", () => {
      expect(isSpecFile(join(testDir, "nonexistent.md"))).toBe(false);
    });
  });

  describe("getSpecFileTitle", () => {
    it("should return cleaned title from spec file", () => {
      const specFile = join(testDir, "spec.md");
      writeFileSync(specFile, "# Feature Specification: My Feature\n\nContent.\n");

      expect(getSpecFileTitle(specFile)).toBe("My Feature");
    });

    it("should return raw title if no prefix", () => {
      const specFile = join(testDir, "spec.md");
      writeFileSync(specFile, "# Simple Title\n\nContent.\n");

      expect(getSpecFileTitle(specFile)).toBe("Simple Title");
    });

    it("should return null for non-existent file", () => {
      expect(getSpecFileTitle(join(testDir, "nonexistent.md"))).toBeNull();
    });

    it("should return null for file without title", () => {
      const specFile = join(testDir, "spec.md");
      writeFileSync(specFile, "Just content.\n");

      expect(getSpecFileTitle(specFile)).toBeNull();
    });
  });

  describe("getSpecFileStatus", () => {
    it("should return status from spec file", () => {
      const specFile = join(testDir, "spec.md");
      writeFileSync(
        specFile,
        `# Spec

**Status**: In Progress

Content.
`
      );

      expect(getSpecFileStatus(specFile)).toBe("In Progress");
    });

    it("should normalize status casing", () => {
      const specFile = join(testDir, "spec.md");
      writeFileSync(
        specFile,
        `# Spec

**status**: draft

Content.
`
      );

      expect(getSpecFileStatus(specFile)).toBe("Draft");
    });

    it("should return null for file without status", () => {
      const specFile = join(testDir, "spec.md");
      writeFileSync(specFile, "# Spec\n\nContent.\n");

      expect(getSpecFileStatus(specFile)).toBeNull();
    });

    it("should return null for non-existent file", () => {
      expect(getSpecFileStatus(join(testDir, "nonexistent.md"))).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("should handle spec with colons in title", () => {
      const specFile = join(testDir, "spec.md");
      writeFileSync(specFile, "# Feature Specification: Auth: OAuth 2.0\n");

      const result = parseSpec(specFile);

      expect(result?.title).toBe("Auth: OAuth 2.0");
    });

    it("should handle multiline metadata values gracefully", () => {
      const specFile = join(testDir, "spec.md");
      writeFileSync(
        specFile,
        `# Spec

**Status**: Draft
**Description**: This is a long description
that spans multiple lines

## Content

Main content here.
`
      );

      const result = parseSpec(specFile);

      expect(result?.metadata.get("Status")).toBe("Draft");
      expect(result?.metadata.get("Description")).toBe("This is a long description");
    });

    it("should handle empty status value", () => {
      const specFile = join(testDir, "spec.md");
      writeFileSync(
        specFile,
        `# Spec

**Status**:

Content.
`
      );

      const result = parseSpec(specFile);

      // Empty status value is normalized to null or empty string
      expect(result?.status === "" || result?.status === null).toBe(true);
    });

    it("should handle various date formats", () => {
      const specFile1 = join(testDir, "spec1.md");
      writeFileSync(specFile1, "# Spec\n\n**Created**: 2024-01-15\n");

      const specFile2 = join(testDir, "spec2.md");
      writeFileSync(specFile2, "# Spec\n\n**Created**: 2024-01-15T10:30:00\n");

      const result1 = parseSpec(specFile1);
      const result2 = parseSpec(specFile2);

      expect(result1?.createdAt).toBeInstanceOf(Date);
      expect(result2?.createdAt).toBeInstanceOf(Date);
    });
  });
});
