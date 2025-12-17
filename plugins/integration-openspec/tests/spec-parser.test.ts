/**
 * Unit tests for OpenSpec spec parser
 *
 * Tests parsing of OpenSpec spec.md files including:
 * - Title extraction
 * - Purpose section extraction
 * - Requirement parsing
 * - Scenario parsing with GIVEN/WHEN/THEN
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  parseSpecFile,
  extractCapability,
  parseRequirements,
  parseScenarios,
  parseGivenWhenThen,
  SPEC_PATTERNS,
  type ParsedOpenSpecSpec,
  type ParsedRequirement,
  type ParsedScenario,
} from "../src/parser/spec-parser.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fixturesPath = path.join(__dirname, "fixtures", "specs");

describe("OpenSpec Spec Parser", () => {
  describe("SPEC_PATTERNS", () => {
    describe("REQUIREMENT pattern", () => {
      it("matches requirement header with name", () => {
        const line = "### Requirement: Directory Creation";
        const match = line.match(SPEC_PATTERNS.REQUIREMENT);

        expect(match).not.toBeNull();
        expect(match![1]).toBe("Directory Creation");
      });

      it("handles extra whitespace", () => {
        const line = "###   Requirement:   Error Handling  ";
        const match = line.match(SPEC_PATTERNS.REQUIREMENT);

        expect(match).not.toBeNull();
        expect(match![1].trim()).toBe("Error Handling");
      });

      it("does not match non-requirement headers", () => {
        expect("### Overview".match(SPEC_PATTERNS.REQUIREMENT)).toBeNull();
        expect("## Requirement: Name".match(SPEC_PATTERNS.REQUIREMENT)).toBeNull();
        expect("### Requirements".match(SPEC_PATTERNS.REQUIREMENT)).toBeNull();
      });
    });

    describe("SCENARIO pattern", () => {
      it("matches scenario header with description", () => {
        const line = "#### Scenario: Creating OpenSpec structure";
        const match = line.match(SPEC_PATTERNS.SCENARIO);

        expect(match).not.toBeNull();
        expect(match![1]).toBe("Creating OpenSpec structure");
      });

      it("handles extra whitespace", () => {
        const line = "####  Scenario:  Running init command  ";
        const match = line.match(SPEC_PATTERNS.SCENARIO);

        expect(match).not.toBeNull();
        expect(match![1].trim()).toBe("Running init command");
      });

      it("does not match non-scenario headers", () => {
        expect("#### Example".match(SPEC_PATTERNS.SCENARIO)).toBeNull();
        expect("### Scenario: Name".match(SPEC_PATTERNS.SCENARIO)).toBeNull();
      });
    });

    describe("GIVEN/WHEN/THEN patterns", () => {
      it("matches GIVEN with dash prefix", () => {
        const line = "- **GIVEN** the current directory has no `.openspec` folder";
        const match = line.match(SPEC_PATTERNS.GIVEN);

        expect(match).not.toBeNull();
        expect(match![1]).toBe("the current directory has no `.openspec` folder");
      });

      it("matches GIVEN with colon", () => {
        const line = "- **GIVEN**: a valid configuration";
        const match = line.match(SPEC_PATTERNS.GIVEN);

        expect(match).not.toBeNull();
        expect(match![1]).toBe("a valid configuration");
      });

      it("matches WHEN", () => {
        const line = "- **WHEN** `openspec init` is executed";
        const match = line.match(SPEC_PATTERNS.WHEN);

        expect(match).not.toBeNull();
        expect(match![1]).toBe("`openspec init` is executed");
      });

      it("matches THEN", () => {
        const line = "- **THEN** create the directory structure:";
        const match = line.match(SPEC_PATTERNS.THEN);

        expect(match).not.toBeNull();
        expect(match![1]).toBe("create the directory structure:");
      });

      it("is case-insensitive", () => {
        expect("- **given** test".match(SPEC_PATTERNS.GIVEN)).not.toBeNull();
        expect("- **WHEN** test".match(SPEC_PATTERNS.WHEN)).not.toBeNull();
        expect("- **Then** test".match(SPEC_PATTERNS.THEN)).not.toBeNull();
      });
    });
  });

  describe("extractCapability", () => {
    it("extracts capability from standard path", () => {
      const filePath = "/project/openspec/specs/cli-init/spec.md";
      expect(extractCapability(filePath)).toBe("cli-init");
    });

    it("extracts capability from nested path", () => {
      const filePath = "/home/user/projects/app/.openspec/specs/api-design/spec.md";
      expect(extractCapability(filePath)).toBe("api-design");
    });

    it("handles Windows-style paths", () => {
      // Path.sep will be used, so this tests the fallback behavior
      const filePath = path.join("C:", "project", "specs", "feature-x", "spec.md");
      expect(extractCapability(filePath)).toBe("feature-x");
    });

    it("falls back to parent directory name", () => {
      const filePath = "/some/path/my-feature/spec.md";
      expect(extractCapability(filePath)).toBe("my-feature");
    });
  });

  describe("parseGivenWhenThen", () => {
    it("parses all step types", () => {
      const lines = [
        "- **GIVEN** a test condition",
        "- **WHEN** an action occurs",
        "- **THEN** verify the result",
      ];

      const result = parseGivenWhenThen(lines);

      expect(result.given).toEqual(["a test condition"]);
      expect(result.when).toEqual(["an action occurs"]);
      expect(result.then).toEqual(["verify the result"]);
    });

    it("handles multiple steps of same type", () => {
      const lines = [
        "- **GIVEN** first condition",
        "- **GIVEN** second condition",
        "- **WHEN** action",
        "- **THEN** first assertion",
        "- **THEN** second assertion",
      ];

      const result = parseGivenWhenThen(lines);

      expect(result.given).toEqual(["first condition", "second condition"]);
      expect(result.when).toEqual(["action"]);
      expect(result.then).toEqual(["first assertion", "second assertion"]);
    });

    it("handles missing step types", () => {
      const lines = [
        "- **WHEN** just an action",
        "- **THEN** verify it",
      ];

      const result = parseGivenWhenThen(lines);

      expect(result.given).toEqual([]);
      expect(result.when).toEqual(["just an action"]);
      expect(result.then).toEqual(["verify it"]);
    });

    it("ignores non-step lines", () => {
      const lines = [
        "Some description text",
        "- **WHEN** the action",
        "Additional info",
        "- **THEN** result",
      ];

      const result = parseGivenWhenThen(lines);

      expect(result.given).toEqual([]);
      expect(result.when).toEqual(["the action"]);
      expect(result.then).toEqual(["result"]);
    });

    it("handles empty lines", () => {
      const lines = [
        "",
        "- **GIVEN** condition",
        "",
        "- **WHEN** action",
        "",
      ];

      const result = parseGivenWhenThen(lines);

      expect(result.given).toEqual(["condition"]);
      expect(result.when).toEqual(["action"]);
    });
  });

  describe("parseScenarios", () => {
    it("parses single scenario", () => {
      const content = `
#### Scenario: Test scenario

- **GIVEN** a condition
- **WHEN** action happens
- **THEN** verify result
`;

      const scenarios = parseScenarios(content);

      expect(scenarios).toHaveLength(1);
      expect(scenarios[0].description).toBe("Test scenario");
      expect(scenarios[0].given).toEqual(["a condition"]);
      expect(scenarios[0].when).toEqual(["action happens"]);
      expect(scenarios[0].then).toEqual(["verify result"]);
    });

    it("parses multiple scenarios", () => {
      const content = `
#### Scenario: First scenario

- **WHEN** first action
- **THEN** first result

#### Scenario: Second scenario

- **GIVEN** second condition
- **WHEN** second action
- **THEN** second result
`;

      const scenarios = parseScenarios(content);

      expect(scenarios).toHaveLength(2);
      expect(scenarios[0].description).toBe("First scenario");
      expect(scenarios[1].description).toBe("Second scenario");
    });

    it("handles scenarios without all step types", () => {
      const content = `
#### Scenario: Minimal scenario

- **THEN** just verify this
`;

      const scenarios = parseScenarios(content);

      expect(scenarios).toHaveLength(1);
      expect(scenarios[0].given).toBeUndefined();
      expect(scenarios[0].when).toBeUndefined();
      expect(scenarios[0].then).toEqual(["just verify this"]);
    });

    it("returns empty array for content without scenarios", () => {
      const content = `
Some text without scenarios.

More text here.
`;

      const scenarios = parseScenarios(content);

      expect(scenarios).toEqual([]);
    });
  });

  describe("parseRequirements", () => {
    it("parses single requirement", () => {
      const content = `
# Title

## Purpose

Some purpose text.

### Requirement: Test Requirement

This is the requirement content.

#### Scenario: Test scenario

- **WHEN** action
- **THEN** result
`;

      const requirements = parseRequirements(content);

      expect(requirements).toHaveLength(1);
      expect(requirements[0].name).toBe("Test Requirement");
      expect(requirements[0].content).toContain("This is the requirement content");
      expect(requirements[0].scenarios).toHaveLength(1);
    });

    it("parses multiple requirements", () => {
      const content = `
# Title

### Requirement: First Requirement

First content.

### Requirement: Second Requirement

Second content.

### Requirement: Third Requirement

Third content.
`;

      const requirements = parseRequirements(content);

      expect(requirements).toHaveLength(3);
      expect(requirements[0].name).toBe("First Requirement");
      expect(requirements[1].name).toBe("Second Requirement");
      expect(requirements[2].name).toBe("Third Requirement");
    });

    it("correctly assigns scenarios to requirements", () => {
      const content = `
### Requirement: Req A

#### Scenario: Scenario A1

- **THEN** A1 result

#### Scenario: Scenario A2

- **THEN** A2 result

### Requirement: Req B

#### Scenario: Scenario B1

- **THEN** B1 result
`;

      const requirements = parseRequirements(content);

      expect(requirements).toHaveLength(2);
      expect(requirements[0].scenarios).toHaveLength(2);
      expect(requirements[0].scenarios[0].description).toBe("Scenario A1");
      expect(requirements[0].scenarios[1].description).toBe("Scenario A2");
      expect(requirements[1].scenarios).toHaveLength(1);
      expect(requirements[1].scenarios[0].description).toBe("Scenario B1");
    });

    it("returns empty array for content without requirements", () => {
      const content = `
# Title

## Purpose

Just some text without requirements.
`;

      const requirements = parseRequirements(content);

      expect(requirements).toEqual([]);
    });
  });

  describe("parseSpecFile", () => {
    let cliInitSpec: ParsedOpenSpecSpec;
    let apiDesignSpec: ParsedOpenSpecSpec;

    beforeAll(() => {
      cliInitSpec = parseSpecFile(path.join(fixturesPath, "cli-init", "spec.md"));
      apiDesignSpec = parseSpecFile(path.join(fixturesPath, "api-design", "spec.md"));
    });

    describe("cli-init fixture", () => {
      it("extracts correct title", () => {
        expect(cliInitSpec.title).toBe("CLI Init Specification");
      });

      it("extracts correct capability", () => {
        expect(cliInitSpec.capability).toBe("cli-init");
      });

      it("extracts purpose section", () => {
        expect(cliInitSpec.purpose).toBeDefined();
        expect(cliInitSpec.purpose).toContain("openspec init");
        expect(cliInitSpec.purpose).toContain("directory structure");
      });

      it("parses all requirements", () => {
        expect(cliInitSpec.requirements).toHaveLength(3);

        const reqNames = cliInitSpec.requirements.map((r) => r.name);
        expect(reqNames).toContain("Directory Creation");
        expect(reqNames).toContain("Configuration File");
        expect(reqNames).toContain("Error Handling");
      });

      it("parses scenarios within requirements", () => {
        const directoryReq = cliInitSpec.requirements.find(
          (r) => r.name === "Directory Creation"
        );
        expect(directoryReq).toBeDefined();
        expect(directoryReq!.scenarios).toHaveLength(2);

        const scenario1 = directoryReq!.scenarios[0];
        expect(scenario1.description).toBe("Creating OpenSpec structure in empty directory");
        expect(scenario1.given).toContain("the current directory has no `.openspec` folder");
        expect(scenario1.when).toContain("`openspec init` is executed");
        expect(scenario1.then).toBeDefined();
        expect(scenario1.then!.length).toBeGreaterThan(0);
      });

      it("parses multiple THEN steps", () => {
        const directoryReq = cliInitSpec.requirements.find(
          (r) => r.name === "Directory Creation"
        );
        const scenario2 = directoryReq!.scenarios[1];

        expect(scenario2.description).toBe("Running init in existing OpenSpec directory");
        expect(scenario2.then).toBeDefined();
        expect(scenario2.then!.length).toBe(2);
      });

      it("stores raw content", () => {
        expect(cliInitSpec.rawContent).toContain("# CLI Init Specification");
        expect(cliInitSpec.rawContent).toContain("### Requirement:");
      });

      it("stores file path", () => {
        expect(cliInitSpec.filePath).toContain("cli-init");
        expect(cliInitSpec.filePath).toContain("spec.md");
      });
    });

    describe("api-design fixture", () => {
      it("extracts correct title", () => {
        expect(apiDesignSpec.title).toBe("API Design Specification");
      });

      it("extracts correct capability", () => {
        expect(apiDesignSpec.capability).toBe("api-design");
      });

      it("parses requirements with multiple scenarios", () => {
        const endpointReq = apiDesignSpec.requirements.find(
          (r) => r.name === "Endpoint Naming"
        );
        expect(endpointReq).toBeDefined();
        expect(endpointReq!.scenarios).toHaveLength(2);
      });

      it("handles requirements without scenarios", () => {
        const responseReq = apiDesignSpec.requirements.find(
          (r) => r.name === "Response Format"
        );
        expect(responseReq).toBeDefined();
        expect(responseReq!.scenarios).toHaveLength(0);
      });
    });
  });

  describe("edge cases", () => {
    it("handles content with only title", () => {
      const content = `# Just a Title`;
      const requirements = parseRequirements(content);
      expect(requirements).toEqual([]);
    });

    it("handles empty scenario content", () => {
      const content = `
#### Scenario: Empty scenario
`;
      const scenarios = parseScenarios(content);

      expect(scenarios).toHaveLength(1);
      expect(scenarios[0].given).toBeUndefined();
      expect(scenarios[0].when).toBeUndefined();
      expect(scenarios[0].then).toBeUndefined();
    });

    it("handles requirement with no content after header", () => {
      const content = `
### Requirement: Empty Requirement
`;
      const requirements = parseRequirements(content);

      expect(requirements).toHaveLength(1);
      expect(requirements[0].name).toBe("Empty Requirement");
      expect(requirements[0].content).toBe("");
      expect(requirements[0].scenarios).toEqual([]);
    });
  });
});
