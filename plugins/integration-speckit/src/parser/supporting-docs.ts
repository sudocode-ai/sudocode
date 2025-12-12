/**
 * Supporting Documents Parser for Spec-Kit Integration
 *
 * Parses supporting documents in spec-kit feature directories:
 * - research.md - Research notes and findings
 * - data-model.md - Data model definitions
 * - contracts/*.json - API contracts and schemas
 *
 * These documents reference the plan and provide additional context.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, basename, extname, dirname } from "path";
import {
  PATTERNS,
  extractMetadata,
  extractTitle,
  extractCrossReferences,
  findContentStartIndex,
} from "./markdown-utils.js";

/**
 * Types of supporting documents
 */
export type SupportingDocType =
  | "research"
  | "data-model"
  | "contract"
  | "other";

/**
 * Parsed supporting document
 */
export interface ParsedSupportingDoc {
  /** Document type */
  type: SupportingDocType;
  /** Document title (from # header or filename) */
  title: string;
  /** All metadata key-value pairs */
  metadata: Map<string, string>;
  /** Main content */
  content: string;
  /** Cross-references found in the content */
  crossReferences: Array<{ id: string; displayText?: string }>;
  /** Source file path */
  filePath: string;
  /** File name without extension */
  fileName: string;
  /** File extension */
  fileExtension: string;
}

/**
 * Parsed contract document (JSON/YAML)
 */
export interface ParsedContract {
  /** Contract name (from filename) */
  name: string;
  /** Parsed contract data */
  data: Record<string, unknown>;
  /** Source file path */
  filePath: string;
  /** File format (json, yaml, yml) */
  format: "json" | "yaml";
}

/**
 * Options for parsing supporting documents
 */
export interface ParseSupportingDocOptions {
  /** Whether to include full content (default: true) */
  includeContent?: boolean;
  /** Whether to extract cross-references (default: true) */
  extractReferences?: boolean;
}

/**
 * Parse a research.md file
 *
 * @param filePath - Absolute path to the research.md file
 * @param options - Parsing options
 * @returns Parsed document or null
 */
export function parseResearch(
  filePath: string,
  options: ParseSupportingDocOptions = {}
): ParsedSupportingDoc | null {
  return parseSupportingDoc(filePath, "research", options);
}

/**
 * Parse a data-model.md file
 *
 * @param filePath - Absolute path to the data-model.md file
 * @param options - Parsing options
 * @returns Parsed document or null
 */
export function parseDataModel(
  filePath: string,
  options: ParseSupportingDocOptions = {}
): ParsedSupportingDoc | null {
  return parseSupportingDoc(filePath, "data-model", options);
}

/**
 * Parse any supporting markdown document
 *
 * @param filePath - Absolute path to the file
 * @param type - Document type
 * @param options - Parsing options
 * @returns Parsed document or null
 */
export function parseSupportingDoc(
  filePath: string,
  type: SupportingDocType = "other",
  options: ParseSupportingDocOptions = {}
): ParsedSupportingDoc | null {
  const { includeContent = true, extractReferences = true } = options;

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const rawContent = readFileSync(filePath, "utf-8");
    const lines = rawContent.split("\n");

    const fileName = basename(filePath, extname(filePath));
    const fileExtension = extname(filePath).slice(1); // Remove leading dot

    // Extract title (use filename if no title in content)
    const title = extractTitle(lines) || formatFileName(fileName);

    // Extract metadata
    const metadata = extractMetadata(lines);

    // Extract main content
    let content = "";
    if (includeContent) {
      const contentStartIndex = findContentStartIndex(lines);
      content = lines.slice(contentStartIndex).join("\n").trim();
    }

    // Extract cross-references
    let crossReferences: Array<{ id: string; displayText?: string }> = [];
    if (extractReferences) {
      crossReferences = extractCrossReferences(rawContent);
    }

    return {
      type,
      title,
      metadata,
      content,
      crossReferences,
      filePath,
      fileName,
      fileExtension,
    };
  } catch (error) {
    console.error(`[supporting-docs] Failed to parse ${filePath}:`, error);
    return null;
  }
}

/**
 * Parse a contract file (JSON or YAML)
 *
 * @param filePath - Absolute path to the contract file
 * @returns Parsed contract or null
 */
export function parseContract(filePath: string): ParsedContract | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const ext = extname(filePath).toLowerCase();
    const name = basename(filePath, ext);
    const rawContent = readFileSync(filePath, "utf-8");

    let data: Record<string, unknown>;
    let format: "json" | "yaml";

    if (ext === ".json") {
      data = JSON.parse(rawContent);
      format = "json";
    } else if (ext === ".yaml" || ext === ".yml") {
      // Simple YAML parsing (for basic structures)
      // Note: For complex YAML, a proper library should be used
      data = parseSimpleYaml(rawContent);
      format = "yaml";
    } else {
      return null; // Unsupported format
    }

    return {
      name,
      data,
      filePath,
      format,
    };
  } catch (error) {
    console.error(
      `[supporting-docs] Failed to parse contract ${filePath}:`,
      error
    );
    return null;
  }
}

/**
 * Parse all contracts in a directory
 *
 * @param contractsDir - Path to the contracts directory
 * @returns Array of parsed contracts
 */
export function parseContractsDirectory(
  contractsDir: string
): ParsedContract[] {
  if (!existsSync(contractsDir)) {
    return [];
  }

  try {
    const contracts: ParsedContract[] = [];
    const entries = readdirSync(contractsDir);

    for (const entry of entries) {
      const filePath = join(contractsDir, entry);
      const stats = statSync(filePath);

      if (stats.isFile()) {
        const ext = extname(entry).toLowerCase();
        if ([".json", ".yaml", ".yml"].includes(ext)) {
          const contract = parseContract(filePath);
          if (contract) {
            contracts.push(contract);
          }
        }
      }
    }

    return contracts;
  } catch (error) {
    console.error(
      `[supporting-docs] Failed to parse contracts directory:`,
      error
    );
    return [];
  }
}

/**
 * Discover and parse all supporting documents in a feature directory
 *
 * @param featureDir - Path to the feature directory (e.g., .specify/specs/001-auth)
 * @returns Object containing all parsed supporting documents
 */
export function discoverSupportingDocs(featureDir: string): {
  research: ParsedSupportingDoc | null;
  dataModel: ParsedSupportingDoc | null;
  contracts: ParsedContract[];
  other: ParsedSupportingDoc[];
} {
  const result = {
    research: null as ParsedSupportingDoc | null,
    dataModel: null as ParsedSupportingDoc | null,
    contracts: [] as ParsedContract[],
    other: [] as ParsedSupportingDoc[],
  };

  if (!existsSync(featureDir)) {
    return result;
  }

  // Parse research.md
  const researchPath = join(featureDir, "research.md");
  if (existsSync(researchPath)) {
    result.research = parseResearch(researchPath);
  }

  // Parse data-model.md
  const dataModelPath = join(featureDir, "data-model.md");
  if (existsSync(dataModelPath)) {
    result.dataModel = parseDataModel(dataModelPath);
  }

  // Parse contracts directory
  const contractsDir = join(featureDir, "contracts");
  if (existsSync(contractsDir)) {
    result.contracts = parseContractsDirectory(contractsDir);
  }

  // Look for other markdown files (exclude spec.md, plan.md, tasks.md)
  try {
    const entries = readdirSync(featureDir);
    const knownFiles = [
      "spec.md",
      "plan.md",
      "tasks.md",
      "research.md",
      "data-model.md",
    ];

    for (const entry of entries) {
      const filePath = join(featureDir, entry);
      const stats = statSync(filePath);

      if (
        stats.isFile() &&
        entry.endsWith(".md") &&
        !knownFiles.includes(entry.toLowerCase())
      ) {
        const doc = parseSupportingDoc(filePath, "other");
        if (doc) {
          result.other.push(doc);
        }
      }
    }
  } catch {
    // Ignore errors listing directory
  }

  return result;
}

/**
 * Simple YAML parser for basic structures
 * For complex YAML, a proper library like js-yaml should be used
 */
function parseSimpleYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = content.split("\n");

  let currentKey = "";
  let currentIndent = 0;
  const stack: Array<{ obj: Record<string, unknown>; indent: number }> = [
    { obj: result, indent: -1 },
  ];

  for (const line of lines) {
    // Skip comments and empty lines
    if (line.trim().startsWith("#") || line.trim() === "") {
      continue;
    }

    // Calculate indentation
    const match = line.match(/^(\s*)/);
    const indent = match ? match[1].length : 0;

    // Pop stack to find correct parent
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].obj;

    // Parse key-value
    const kvMatch = line.trim().match(/^([^:]+):\s*(.*)$/);
    if (kvMatch) {
      const [, key, value] = kvMatch;
      const trimmedKey = key.trim();
      const trimmedValue = value.trim();

      if (trimmedValue === "" || trimmedValue === "|" || trimmedValue === ">") {
        // Start of nested object or multiline string
        parent[trimmedKey] = {};
        stack.push({
          obj: parent[trimmedKey] as Record<string, unknown>,
          indent,
        });
        currentKey = trimmedKey;
        currentIndent = indent;
      } else {
        // Simple key-value
        parent[trimmedKey] = parseYamlValue(trimmedValue);
      }
    } else if (line.trim().startsWith("-")) {
      // Array item
      const itemValue = line.trim().slice(1).trim();
      if (!Array.isArray(parent[currentKey])) {
        parent[currentKey] = [];
      }
      (parent[currentKey] as unknown[]).push(parseYamlValue(itemValue));
    }
  }

  return result;
}

/**
 * Parse a simple YAML value
 */
function parseYamlValue(value: string): unknown {
  // Remove quotes
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  // Boolean
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;

  // Null
  if (value.toLowerCase() === "null" || value === "~") return null;

  // Number
  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);

  // String
  return value;
}

/**
 * Format a filename for display (convert kebab-case to Title Case)
 */
function formatFileName(fileName: string): string {
  return fileName
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Detect the type of a supporting document from its filename
 *
 * @param filePath - Path to the file
 * @returns Document type
 */
export function detectDocType(filePath: string): SupportingDocType {
  const fileName = basename(filePath).toLowerCase();

  if (fileName === "research.md") return "research";
  if (fileName === "data-model.md") return "data-model";
  if (filePath.includes("/contracts/") || filePath.includes("\\contracts\\")) {
    return "contract";
  }

  return "other";
}
