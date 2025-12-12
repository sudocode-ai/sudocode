/**
 * Tests for plan-parser
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  parsePlan,
  parsePlanContent,
  isPlanFile,
  getPlanFileTitle,
  getPlanFileStatus,
} from "../../src/parser/plan-parser.js";

describe("Plan Parser", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `speckit-plan-parser-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("parsePlan", () => {
    it("should parse a basic plan file", () => {
      const planFile = join(testDir, "plan.md");
      writeFileSync(
        planFile,
        `# Implementation Plan: Authentication

**Branch**: feature/auth
**Spec**: [[s-001-spec]]
**Status**: Draft
**Created**: 2024-01-15

## Overview

This plan describes how to implement authentication.
`
      );

      const result = parsePlan(planFile);

      expect(result).not.toBeNull();
      expect(result?.title).toBe("Authentication");
      expect(result?.rawTitle).toBe("Implementation Plan: Authentication");
      expect(result?.branch).toBe("feature/auth");
      expect(result?.specReference).toBe("s-001-spec");
      expect(result?.status).toBe("Draft");
      expect(result?.createdAt?.toISOString().startsWith("2024-01-15")).toBe(true);
      expect(result?.content).toContain("how to implement authentication");
    });

    it("should parse a plan without Implementation Plan prefix", () => {
      const planFile = join(testDir, "plan.md");
      writeFileSync(
        planFile,
        `# User Management Plan

**Status**: In Progress
**Spec**: spec.md

Content here.
`
      );

      const result = parsePlan(planFile);

      expect(result).not.toBeNull();
      expect(result?.title).toBe("User Management Plan");
      expect(result?.status).toBe("In Progress");
      expect(result?.specReference).toBe("spec.md");
    });

    it("should extract spec reference without brackets", () => {
      const planFile = join(testDir, "plan.md");
      writeFileSync(
        planFile,
        `# Plan

**Spec**: s-001-spec

Content.
`
      );

      const result = parsePlan(planFile);

      expect(result?.specReference).toBe("s-001-spec");
    });

    it("should extract spec reference with brackets", () => {
      const planFile = join(testDir, "plan.md");
      writeFileSync(
        planFile,
        `# Plan

**Spec**: [[s-002-spec|Feature Spec]]

Content.
`
      );

      const result = parsePlan(planFile);

      expect(result?.specReference).toBe("s-002-spec|Feature Spec");
    });

    it("should extract cross-references", () => {
      const planFile = join(testDir, "plan.md");
      writeFileSync(
        planFile,
        `# Implementation Plan: Auth

**Status**: Draft

See [[s-001-spec]] for requirements.
Tasks in [[i-001-tasks]].
`
      );

      const result = parsePlan(planFile);

      expect(result?.crossReferences).toHaveLength(2);
      expect(result?.crossReferences[0]).toEqual({ id: "s-001-spec", displayText: undefined });
      expect(result?.crossReferences[1]).toEqual({ id: "i-001-tasks", displayText: undefined });
    });

    it("should return null for non-existent file", () => {
      const result = parsePlan(join(testDir, "nonexistent.md"));
      expect(result).toBeNull();
    });

    it("should return null for file without title", () => {
      const planFile = join(testDir, "plan.md");
      writeFileSync(planFile, "Just content without a title.\n");

      const result = parsePlan(planFile);
      expect(result).toBeNull();
    });

    it("should handle plan with only title", () => {
      const planFile = join(testDir, "plan.md");
      writeFileSync(planFile, "# Simple Plan\n");

      const result = parsePlan(planFile);

      expect(result).not.toBeNull();
      expect(result?.title).toBe("Simple Plan");
      expect(result?.status).toBeNull();
      expect(result?.branch).toBeNull();
      expect(result?.specReference).toBeNull();
    });

    it("should use Feature Branch as fallback for branch", () => {
      const planFile = join(testDir, "plan.md");
      writeFileSync(
        planFile,
        `# Plan

**Feature Branch**: feature/auth

Content.
`
      );

      const result = parsePlan(planFile);

      expect(result?.branch).toBe("feature/auth");
    });

    it("should preserve metadata map", () => {
      const planFile = join(testDir, "plan.md");
      writeFileSync(
        planFile,
        `# Plan Title

**Status**: Draft
**Branch**: feature/test
**Spec**: [[s-001]]
**Assignee**: John Doe

Content.
`
      );

      const result = parsePlan(planFile);

      expect(result?.metadata.get("Status")).toBe("Draft");
      expect(result?.metadata.get("Branch")).toBe("feature/test");
      expect(result?.metadata.get("Assignee")).toBe("John Doe");
    });

    it("should not include content when includeContent is false", () => {
      const planFile = join(testDir, "plan.md");
      writeFileSync(
        planFile,
        `# Plan Title

**Status**: Draft

This is the content that should not be included.
`
      );

      const result = parsePlan(planFile, { includeContent: false });

      expect(result?.content).toBe("");
    });

    it("should not extract references when extractReferences is false", () => {
      const planFile = join(testDir, "plan.md");
      writeFileSync(
        planFile,
        `# Plan Title

See [[s-001-ref]] for details.
`
      );

      const result = parsePlan(planFile, { extractReferences: false });

      expect(result?.crossReferences).toHaveLength(0);
    });
  });

  describe("parsePlanContent", () => {
    it("should parse plan content from string", () => {
      const content = `# Implementation Plan: Test Feature

**Status**: Complete
**Branch**: feature/test
**Spec**: [[s-test]]

## Description

Test description here.
`;

      const result = parsePlanContent(content);

      expect(result).not.toBeNull();
      expect(result?.title).toBe("Test Feature");
      expect(result?.status).toBe("Complete");
      expect(result?.branch).toBe("feature/test");
      expect(result?.specReference).toBe("s-test");
      expect(result?.filePath).toBe("<string>");
    });

    it("should accept custom file path", () => {
      const content = "# Test\n\nContent.\n";
      const result = parsePlanContent(content, "/custom/path.md");

      expect(result?.filePath).toBe("/custom/path.md");
    });
  });

  describe("isPlanFile", () => {
    it("should return true for file with Implementation Plan prefix", () => {
      const planFile = join(testDir, "plan.md");
      writeFileSync(
        planFile,
        `# Implementation Plan: Auth

Content.
`
      );

      expect(isPlanFile(planFile)).toBe(true);
    });

    it("should return true for file with Spec metadata", () => {
      const planFile = join(testDir, "plan.md");
      writeFileSync(
        planFile,
        `# Auth Plan

**Spec**: [[s-001]]

Content.
`
      );

      expect(isPlanFile(planFile)).toBe(true);
    });

    it("should return false for regular markdown file", () => {
      const mdFile = join(testDir, "readme.md");
      writeFileSync(
        mdFile,
        `# README

This is a regular markdown file.
`
      );

      expect(isPlanFile(mdFile)).toBe(false);
    });

    it("should return false for non-existent file", () => {
      expect(isPlanFile(join(testDir, "nonexistent.md"))).toBe(false);
    });
  });

  describe("getPlanFileTitle", () => {
    it("should return cleaned title from plan file", () => {
      const planFile = join(testDir, "plan.md");
      writeFileSync(planFile, "# Implementation Plan: My Feature\n\nContent.\n");

      expect(getPlanFileTitle(planFile)).toBe("My Feature");
    });

    it("should return raw title if no prefix", () => {
      const planFile = join(testDir, "plan.md");
      writeFileSync(planFile, "# Simple Title\n\nContent.\n");

      expect(getPlanFileTitle(planFile)).toBe("Simple Title");
    });

    it("should return null for non-existent file", () => {
      expect(getPlanFileTitle(join(testDir, "nonexistent.md"))).toBeNull();
    });

    it("should return null for file without title", () => {
      const planFile = join(testDir, "plan.md");
      writeFileSync(planFile, "Just content.\n");

      expect(getPlanFileTitle(planFile)).toBeNull();
    });
  });

  describe("getPlanFileStatus", () => {
    it("should return status from plan file", () => {
      const planFile = join(testDir, "plan.md");
      writeFileSync(
        planFile,
        `# Plan

**Status**: In Progress

Content.
`
      );

      expect(getPlanFileStatus(planFile)).toBe("In Progress");
    });

    it("should normalize status casing", () => {
      const planFile = join(testDir, "plan.md");
      writeFileSync(
        planFile,
        `# Plan

**status**: complete

Content.
`
      );

      expect(getPlanFileStatus(planFile)).toBe("Complete");
    });

    it("should return null for file without status", () => {
      const planFile = join(testDir, "plan.md");
      writeFileSync(planFile, "# Plan\n\nContent.\n");

      expect(getPlanFileStatus(planFile)).toBeNull();
    });

    it("should return null for non-existent file", () => {
      expect(getPlanFileStatus(join(testDir, "nonexistent.md"))).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("should handle plan with colons in title", () => {
      const planFile = join(testDir, "plan.md");
      writeFileSync(planFile, "# Implementation Plan: Auth: Phase 1\n");

      const result = parsePlan(planFile);

      expect(result?.title).toBe("Auth: Phase 1");
    });

    it("should handle multiple branch metadata fields", () => {
      const planFile = join(testDir, "plan.md");
      writeFileSync(
        planFile,
        `# Plan

**Feature Branch**: feature/auth
**Branch**: main

Content.
`
      );

      const result = parsePlan(planFile);

      // Branch should take precedence over Feature Branch
      expect(result?.branch).toBe("main");
    });

    it("should handle empty spec reference", () => {
      const planFile = join(testDir, "plan.md");
      writeFileSync(
        planFile,
        `# Plan

**Spec**:

Content.
`
      );

      const result = parsePlan(planFile);

      // Empty spec reference results in null or empty string
      expect(result?.specReference === "" || result?.specReference === null).toBe(true);
    });
  });
});
