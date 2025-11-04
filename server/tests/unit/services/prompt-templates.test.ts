/**
 * Tests for prompt templates service
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import {
  PROMPT_TEMPLATES_TABLE,
  PROMPT_TEMPLATES_INDEXES,
} from "@sudocode-ai/types/schema";
import {
  initializeDefaultTemplates,
  getDefaultTemplate,
  getTemplateById,
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from "../../../src/services/prompt-templates.js";

describe("Prompt Templates Service", () => {
  let db: Database.Database;

  beforeAll(() => {
    // Create in-memory database for testing
    db = new Database(":memory:");
    db.exec(PROMPT_TEMPLATES_TABLE);
    db.exec(PROMPT_TEMPLATES_INDEXES);
  });

  afterAll(() => {
    db.close();
  });

  describe("initializeDefaultTemplates", () => {
    it("should insert default issue template", () => {
      initializeDefaultTemplates(db);

      const template = getDefaultTemplate(db, "issue");
      expect(template, "Template should exist").toBeTruthy();
      expect(template?.type).toBe("issue");
      expect(template?.is_default).toBe(1);
      expect(template?.name).toBe("Default Issue Template");
      expect(template?.template.includes("Fix issue {{issueId}}")).toBeTruthy();
      expect(template?.template.includes("{{#if relatedSpecs}}")).toBeTruthy();
    });

    it("should be idempotent - not insert duplicate templates", () => {
      // Reinitialize database
      db.exec("DELETE FROM prompt_templates");

      initializeDefaultTemplates(db);
      initializeDefaultTemplates(db);

      const templates = listTemplates(db, "issue");
      const defaultTemplates = templates.filter((t) => t.is_default === 1);
      expect(defaultTemplates.length).toBe(1);
    });

    it("should validate template syntax before inserting", () => {
      // This test verifies that initializeDefaultTemplates validates the template
      // If the default template had invalid syntax, it would throw an error
      db.exec("DELETE FROM prompt_templates");
      expect(() => initializeDefaultTemplates(db)).not.toThrow();
    });
  });

  describe("getDefaultTemplate", () => {
    beforeAll(() => {
      db.exec("DELETE FROM prompt_templates");
      initializeDefaultTemplates(db);
    });

    it("should return default template for issue type", () => {
      const template = getDefaultTemplate(db, "issue");
      expect(template).toBeTruthy();
      expect(template?.type).toBe("issue");
      expect(template?.is_default).toBe(1);
    });

    it("should return null if no default template exists for type", () => {
      const template = getDefaultTemplate(db, "spec");
      expect(template).toBe(null);
    });
  });

  describe("getTemplateById", () => {
    it("should return template by ID", () => {
      const defaultTemplate = getDefaultTemplate(db, "issue")!;
      const template = getTemplateById(db, defaultTemplate.id);
      expect(template).toEqual(defaultTemplate);
    });

    it("should return null if template not found", () => {
      const template = getTemplateById(db, "non-existent-id");
      expect(template).toBe(null);
    });
  });

  describe("listTemplates", () => {
    beforeAll(() => {
      db.exec("DELETE FROM prompt_templates");
      initializeDefaultTemplates(db);
    });

    it("should list all templates", () => {
      const templates = listTemplates(db);
      expect(templates.length > 0).toBeTruthy();
    });

    it("should filter templates by type", () => {
      // Create a custom template
      createTemplate(db, {
        name: "Custom Issue Template",
        type: "issue",
        template: "Custom: {{title}}",
        variables: ["title"],
      });

      const issueTemplates = listTemplates(db, "issue");
      expect(issueTemplates.length).toBe(2);
      expect(issueTemplates.every((t) => t.type === "issue")).toBeTruthy();

      const specTemplates = listTemplates(db, "spec");
      expect(specTemplates.length).toBe(0);
    });

    it("should order templates with default first", () => {
      db.exec("DELETE FROM prompt_templates");
      initializeDefaultTemplates(db);

      createTemplate(db, {
        name: "Custom Issue Template",
        type: "issue",
        template: "Custom: {{title}}",
        variables: ["title"],
      });

      const templates = listTemplates(db, "issue");
      expect(templates[0].is_default).toBe(1);
      expect(templates[0].name).toBe("Default Issue Template");
    });
  });

  describe("createTemplate", () => {
    beforeAll(() => {
      db.exec("DELETE FROM prompt_templates");
    });

    it("should create a new template", () => {
      const template = createTemplate(db, {
        name: "Test Template",
        description: "A test template",
        type: "custom",
        template: "Hello {{name}}!",
        variables: ["name"],
      });

      expect(template.id).toBeTruthy();
      expect(template.name).toBe("Test Template");
      expect(template.description).toBe("A test template");
      expect(template.type).toBe("custom");
      expect(template.template).toBe("Hello {{name}}!");
      expect(template.is_default).toBe(0);

      // Verify variables are stored as JSON
      const variables = JSON.parse(template.variables);
      expect(variables).toEqual(["name"]);
    });

    it("should create a default template", () => {
      const template = createTemplate(db, {
        name: "Default Custom Template",
        type: "custom",
        template: "Default: {{value}}",
        variables: ["value"],
        isDefault: true,
      });

      expect(template.is_default).toBe(1);
    });

    it("should validate template syntax", () => {
      expect(() =>
        createTemplate(db, {
          name: "Invalid Template",
          type: "custom",
          template: "{{#if x}}content",
          variables: ["x"],
        })
      ).toThrow(/Invalid template syntax/);
    });

    it("should set timestamps", () => {
      const template = createTemplate(db, {
        name: "Test Template",
        type: "custom",
        template: "Test",
        variables: [],
      });

      expect(template.created_at).toBeTruthy();
      expect(template.updated_at).toBeTruthy();
      expect(template.created_at).toBe(template.updated_at);
    });
  });

  describe("updateTemplate", () => {
    let templateId: string;

    beforeAll(() => {
      db.exec("DELETE FROM prompt_templates");
      const template = createTemplate(db, {
        name: "Original Name",
        description: "Original description",
        type: "custom",
        template: "Original: {{value}}",
        variables: ["value"],
      });
      templateId = template.id;
    });

    it("should update template name", () => {
      const updated = updateTemplate(db, templateId, {
        name: "Updated Name",
      });

      expect(updated?.name).toBe("Updated Name");
      expect(updated?.template).toBe("Original: {{value}}");
    });

    it("should update template content", () => {
      const updated = updateTemplate(db, templateId, {
        template: "Updated: {{newValue}}",
        variables: ["newValue"],
      });

      expect(updated?.template).toBe("Updated: {{newValue}}");
      const variables = JSON.parse(updated!.variables);
      expect(variables).toEqual(["newValue"]);
    });

    it("should update is_default flag", () => {
      const updated = updateTemplate(db, templateId, {
        isDefault: true,
      });

      expect(updated?.is_default).toBe(1);
    });

    it("should validate template syntax on update", () => {
      expect(() =>
        updateTemplate(db, templateId, {
          template: "{{#if x}}incomplete",
        })
      ).toThrow(/Invalid template syntax/);
    });

    it("should return null if template not found", () => {
      const updated = updateTemplate(db, "non-existent-id", {
        name: "New Name",
      });

      expect(updated).toBe(null);
    });

    it("should handle empty updates", () => {
      const original = getTemplateById(db, templateId)!;
      const updated = updateTemplate(db, templateId, {});

      expect(updated).toEqual(original);
    });
  });

  describe("deleteTemplate", () => {
    it("should delete a template", () => {
      const template = createTemplate(db, {
        name: "To Delete",
        type: "custom",
        template: "Delete me",
        variables: [],
      });

      const deleted = deleteTemplate(db, template.id);
      expect(deleted).toBe(true);

      const retrieved = getTemplateById(db, template.id);
      expect(retrieved).toBe(null);
    });

    it("should return false if template not found", () => {
      const deleted = deleteTemplate(db, "non-existent-id");
      expect(deleted).toBe(false);
    });
  });

  describe("Template Integration", () => {
    it("should work with default template in typical workflow", () => {
      // Initialize database with defaults
      db.exec("DELETE FROM prompt_templates");
      initializeDefaultTemplates(db);

      // Get default template
      const template = getDefaultTemplate(db, "issue");
      expect(template).toBeTruthy();

      // Template should have all required fields
      expect(template?.name).toBeTruthy();
      expect(template?.type).toBe("issue");
      expect(template?.template).toBeTruthy();
      expect(template?.is_default).toBe(1);

      // Variables should be valid JSON
      const variables = JSON.parse(template?.variables || "[]");
      expect(Array.isArray(variables)).toBeTruthy();
      expect(variables.includes("issueId")).toBeTruthy();
      expect(variables.includes("title")).toBeTruthy();
      expect(variables.includes("description")).toBeTruthy();
    });

    it("should support custom templates alongside defaults", () => {
      db.exec("DELETE FROM prompt_templates");
      initializeDefaultTemplates(db);

      // Create custom template
      const custom = createTemplate(db, {
        name: "Custom Bug Template",
        description: "Template for bug reports",
        type: "issue",
        template: "Bug: {{title}}\n\nSteps: {{steps}}",
        variables: ["title", "steps"],
      });

      // Both should exist
      const defaultTemplate = getDefaultTemplate(db, "issue");
      const customTemplate = getTemplateById(db, custom.id);

      expect(defaultTemplate).toBeTruthy();
      expect(customTemplate).toBeTruthy();
      expect(defaultTemplate?.id).not.toBe(customTemplate?.id);

      // List should show both
      const allTemplates = listTemplates(db, "issue");
      expect(allTemplates.length).toBe(2);
      expect(allTemplates[0].is_default).toBe(1); // Default first
    });
  });
});
