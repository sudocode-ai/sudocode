/**
 * MCP Server for sudocode
 *
 * This module sets up the MCP server with tools and resources.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { SudocodeClient } from "./client.js";
import * as issueTools from "./tools/issues.js";
import * as specTools from "./tools/specs.js";
import * as relationshipTools from "./tools/relationships.js";
import * as feedbackTools from "./tools/feedback.js";
import * as referenceTools from "./tools/references.js";
import { SudocodeClientConfig } from "./types.js";
import { existsSync } from "fs";
import { join } from "path";

export class SudocodeMCPServer {
  private server: Server;
  private client: SudocodeClient;
  private config: SudocodeClientConfig;
  private isInitialized: boolean = false;

  constructor(config?: SudocodeClientConfig) {
    this.config = config || {};
    this.server = new Server(
      {
        name: "sudocode",
        version: "0.1.1",
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    this.client = new SudocodeClient(config);
    this.setupHandlers();
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "ready",
            description:
              "Shows you the current project state: what issues are ready to work on (no blockers), what's in progress, and what's blocked. Essential for understanding context before making any decisions about what to work on next.",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
          {
            name: "list_issues",
            description:
              "Search and filter issues. Use this when you need to find specific issues by status, priority, keyword, or when exploring what work exists in the project.",
            inputSchema: {
              type: "object",
              properties: {
                status: {
                  type: "string",
                  enum: ["open", "in_progress", "blocked", "closed"],
                  description:
                    "Filter by workflow status: 'open' (not started), 'in_progress' (currently working), 'blocked' (waiting on dependencies), 'closed' (completed)",
                },
                priority: {
                  type: "number",
                  description:
                    "Filter by priority level where 0=highest priority and 4=lowest priority",
                },
                archived: {
                  type: "boolean",
                  description:
                    "Include archived issues. Defaults to false (excludes archived issues from results)",
                },
                limit: {
                  type: "number",
                  description:
                    "Maximum number of results to return. Defaults to 50.",
                  default: 50,
                },
                search: {
                  type: "string",
                  description:
                    "Search text - matches against issue titles and descriptions (case-insensitive)",
                },
              },
            },
          },
          {
            name: "show_issue",
            description:
              "Get full details about a specific issue. Use this to understand what the issue implements (which specs), what blocks it (dependencies), its current status, and related work. Essential for understanding context before starting implementation.",
            inputSchema: {
              type: "object",
              properties: {
                issue_id: {
                  type: "string",
                  description: 'Issue ID with format "i-xxxx" (e.g., "i-x7k9")',
                },
              },
              required: ["issue_id"],
            },
          },
          {
            name: "upsert_issue",
            description:
              "Create or update an issue (agent's actionable work item). **Issues implement specs** - use 'link' with type='implements' to connect issue to spec. **Before closing:** provide feedback on the spec using 'add_feedback' if this issue implements a spec. If issue_id is provided, updates the issue; otherwise creates a new one. To close an issue, set status='closed'. To archive an issue, set archived=true.",
            inputSchema: {
              type: "object",
              properties: {
                issue_id: {
                  type: "string",
                  description:
                    'Issue ID in format "i-xxxx". Omit to create new issue (auto-generates ID). Provide to update existing issue.',
                },
                title: {
                  type: "string",
                  description:
                    "Concise issue title describing the work (e.g., 'Implement OAuth login flow'). Required when creating, optional when updating.",
                },
                description: {
                  type: "string",
                  description:
                    "Detailed description of the work to be done. Supports markdown and inline references using [[id]] syntax (e.g., 'Implement [[s-abc123]] requirements' or 'Blocked by [[i-xyz789]]').",
                },
                priority: {
                  type: "number",
                  description:
                    "Priority level: 0 (highest/urgent) to 4 (lowest/nice-to-have). Use 0-1 for critical work, 2 for normal, 3-4 for backlog.",
                },
                parent: {
                  type: "string",
                  description:
                    "Parent issue ID for hierarchical organization (e.g., 'i-abc123'). Use to break epics into subtasks or organize related work.",
                },
                tags: {
                  type: "array",
                  items: { type: "string" },
                  description:
                    "Array of tag strings for categorization (e.g., ['backend', 'authentication', 'security']). Useful for filtering and organization.",
                },
                status: {
                  type: "string",
                  enum: ["open", "in_progress", "blocked", "closed"],
                  description:
                    "Workflow status: 'open' (ready but not started), 'in_progress' (actively working), 'blocked' (waiting on dependencies), 'closed' (completed). **Before closing spec-implementing issues, use add_feedback.**",
                },
                archived: {
                  type: "boolean",
                  description:
                    "Set to true to archive completed/obsolete issues. Archived issues are hidden from default queries but preserved for history.",
                },
              },
            },
          },
          {
            name: "list_specs",
            description:
              "Search and browse all specs in the project. Use this to find existing specifications by keyword, or to see what specs are available before creating new ones.",
            inputSchema: {
              type: "object",
              properties: {
                limit: {
                  type: "number",
                  description:
                    "Maximum number of results to return. Defaults to 50.",
                  default: 50,
                },
                search: {
                  type: "string",
                  description:
                    "Search text - matches against spec titles and descriptions (case-insensitive). Use keywords to find relevant specs.",
                },
              },
            },
          },
          {
            name: "show_spec",
            description:
              "Get full details about a specific spec including its content, relationships, and all anchored feedback. Use this to understand requirements before implementing. Shows what issues implement this spec and feedback from previous implementations.",
            inputSchema: {
              type: "object",
              properties: {
                spec_id: {
                  type: "string",
                  description:
                    'Spec ID with format "s-xxxx" (e.g., "s-14sh"). Get IDs from list_specs, ready, or show_issue results.',
                },
              },
              required: ["spec_id"],
            },
          },
          {
            name: "upsert_spec",
            description:
              "Create or update a spec (user's requirements/intent/context document). Create spec to document design requirements, architecture, API design, etc with user guidance. If spec_id is provided, updates the spec; otherwise creates a new one with a hash-based ID (e.g., s-14sh). If editing the content of an existing spec, you can also edit the content of the corresponding spec markdown file directly (`spec.file_path` you can get with show_spec).",
            inputSchema: {
              type: "object",
              properties: {
                spec_id: {
                  type: "string",
                  description:
                    'Spec ID in format "s-xxxx". Omit to create new spec (auto-generates hash-based ID). Provide to update existing spec.',
                },
                title: {
                  type: "string",
                  description:
                    "Descriptive spec title (e.g., 'OAuth Authentication System Design'). Required when creating, optional when updating.",
                },
                priority: {
                  type: "number",
                  description:
                    "Priority level: 0 (highest/urgent) to 4 (lowest/nice-to-have). Helps prioritize which specs to implement first.",
                },
                description: {
                  type: "string",
                  description:
                    "Full specification content in markdown format. Include requirements, architecture, API designs, user flows, technical decisions. Supports Obsidian-style [[entityId]] mention syntax for referencing other specs/issues.",
                },
                parent: {
                  type: "string",
                  description:
                    "Parent spec ID for hierarchical organization (e.g., 's-abc123'). Use to break large specs into sub-specs or organize by system/feature area.",
                },
                tags: {
                  type: "array",
                  items: { type: "string" },
                  description:
                    "Array of tag strings for categorization (e.g., ['architecture', 'api', 'security']). Useful for filtering and finding related specs.",
                },
              },
            },
          },
          {
            name: "link",
            description:
              "Create a relationship between specs and/or issues. Use this to establish the dependency graph and connect work to requirements. Most common: 'implements' (issue → spec) and 'blocks' (dependency ordering).",
            inputSchema: {
              type: "object",
              properties: {
                from_id: {
                  type: "string",
                  description:
                    "Source entity ID (format 'i-xxxx' for issue or 's-xxxx' for spec). This is the entity creating the relationship.",
                },
                to_id: {
                  type: "string",
                  description:
                    "Target entity ID (format 'i-xxxx' for issue or 's-xxxx' for spec). This is the entity being related to.",
                },
                type: {
                  type: "string",
                  enum: [
                    "blocks",
                    "implements",
                    "references",
                    "depends-on",
                    "discovered-from",
                    "related",
                  ],
                  description:
                    "Relationship type:\n• 'implements' - issue implements a spec (core workflow, e.g., i-abc implements s-xyz)\n• 'blocks' - from_id must complete before to_id can start (execution ordering, affects 'ready' command)\n• 'parent-child' - hierarchical organization (epics → subtasks, system specs → component specs)\n• 'depends-on' - general dependency without blocking semantics\n• 'discovered-from' - new issue found during work on another issue (provenance tracking)\n• 'references' - soft reference for context\n• 'related' - general relationship",
                },
              },
              required: ["from_id", "to_id"],
            },
          },
          {
            name: "add_reference",
            description:
              "Insert an Obsidian-style [[ID]] reference into spec or issue markdown content. Alternative to directly editing markdown - programmatically adds cross-references at specific locations.",
            inputSchema: {
              type: "object",
              properties: {
                entity_id: {
                  type: "string",
                  description:
                    "Entity ID where the reference will be inserted (format 'i-xxxx' or 's-xxxx'). This is the document being edited.",
                },
                reference_id: {
                  type: "string",
                  description:
                    "Entity ID being referenced (format 'i-xxxx' or 's-xxxx'). This creates a [[reference_id]] or [[reference_id|display_text]] link in the markdown.",
                },
                display_text: {
                  type: "string",
                  description:
                    "Optional display text for the reference. If provided, creates [[reference_id|display_text]] instead of [[reference_id]].",
                },
                relationship_type: {
                  type: "string",
                  enum: [
                    "blocks",
                    "implements",
                    "references",
                    "depends-on",
                    "discovered-from",
                    "related",
                  ],
                  description:
                    "Optional relationship type to declare using { } syntax. Creates [[reference_id]]{ relationship_type } in markdown. Use 'implements', 'blocks', 'depends-on', etc.",
                },
                line: {
                  type: "number",
                  description:
                    "Line number where reference should be inserted. Use either 'line' OR 'text', not both. Line numbers start at 1.",
                },
                text: {
                  type: "string",
                  description:
                    "Text substring to search for as insertion point. Use either 'line' OR 'text', not both. Reference will be inserted at/near this text.",
                },
                format: {
                  type: "string",
                  enum: ["inline", "newline"],
                  description:
                    "How to insert: 'inline' adds reference on same line as insertion point, 'newline' adds reference on a new line. Defaults to 'inline'.",
                  default: "inline",
                },
                // TODO: Add position handling later if needed.
              },
              required: ["entity_id", "reference_id"],
            },
          },
          {
            name: "add_feedback",
            description:
              "**REQUIRED when closing issues that implement specs.** Document implementation results by providing feedback on the spec. This closes the feedback loop between requirements (specs) and implementation (issues). Include what was accomplished, design decisions made, challenges encountered, and evidence of completion. When possible, anchor feedback to a specific and relevant location in the spec.",
            inputSchema: {
              type: "object",
              properties: {
                issue_id: {
                  type: "string",
                  description:
                    "Issue ID that's providing the feedback (format 'i-xxxx'). This is the issue that implemented the spec and is now documenting results.",
                },
                spec_id: {
                  type: "string",
                  description:
                    "Spec ID receiving the feedback (format 's-xxxx'). This is the spec that was implemented.",
                },
                content: {
                  type: "string",
                  description:
                    "Feedback content in markdown. Document: (1) Requirements met from spec, (2) Design decisions made during implementation, (3) Challenges encountered and how resolved, (4) Evidence of completion (e.g., 'All tests passing: npm test'). Be specific and actionable.",
                },
                type: {
                  type: "string",
                  enum: ["comment", "suggestion", "request"],
                  description:
                    "Feedback type:\n• 'comment' - informational feedback about implementation (most common for completed work)\n• 'suggestion' - spec needs updating based on implementation learnings\n• 'request' - need clarification or spec is unclear/incomplete",
                },
                line: {
                  type: "number",
                  description:
                    "Optional: Line number in spec markdown to anchor feedback. Use either 'line' OR 'text', not both. Anchoring connects feedback to specific spec sections. Omit both for general feedback on entire spec.",
                },
                text: {
                  type: "string",
                  description:
                    "Optional: Exact text substring from spec to anchor feedback. Use either 'line' OR 'text', not both. Must match EXACTLY (case-sensitive, whitespace-sensitive). Use show_spec first to copy exact text. Anchoring makes feedback contextual and trackable.",
                },
                // TODO: Re-enable when the agent data structure is more developed.
                // agent: {
                //   type: "string",
                //   description: "Agent providing feedback",
                // },
              },
            },
          },
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (!this.isInitialized) {
        const workingDir = this.client["workingDir"] || process.cwd();
        return {
          content: [
            {
              type: "text",
              text: `⚠️  sudocode is not initialized in this directory.\n\nWorking directory: ${workingDir}\n\nPlease run 'sudocode init' in your project root first.`,
            },
          ],
          isError: true,
        };
      }

      try {
        let result: any;

        switch (name) {
          case "ready":
            result = await issueTools.ready(this.client, args as any);
            break;

          case "list_issues":
            result = await issueTools.listIssues(this.client, args as any);
            break;

          case "show_issue":
            result = await issueTools.showIssue(this.client, args as any);
            break;

          case "upsert_issue":
            result = await issueTools.upsertIssue(this.client, args as any);
            break;

          case "list_specs":
            result = await specTools.listSpecs(this.client, args as any);
            break;

          case "show_spec":
            result = await specTools.showSpec(this.client, args as any);
            break;

          case "upsert_spec":
            result = await specTools.upsertSpec(this.client, args as any);
            break;

          case "link":
            result = await relationshipTools.link(this.client, args as any);
            break;

          case "add_reference":
            result = await referenceTools.addReference(
              this.client,
              args as any
            );
            break;

          case "add_feedback":
            result = await feedbackTools.addFeedback(this.client, args as any);
            break;

          default:
            throw new Error(`Unknown tool: ${name}`);
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        let errorText = `Error: ${
          error instanceof Error ? error.message : String(error)
        }`;

        // Include stderr if this is a sudocode error
        if (error instanceof Error && "stderr" in error && error.stderr) {
          errorText += `\n\nStderr:\n${error.stderr}`;
        }

        return {
          content: [
            {
              type: "text",
              text: errorText,
            },
          ],
          isError: true,
        };
      }
    });

    // List available resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return {
        resources: [
          {
            uri: "sudocode://quickstart",
            name: "sudocode Quickstart Guide",
            description:
              "Introduction to sudocode workflow and best practices for agents",
            mimeType: "text/markdown",
          },
        ],
      };
    });

    // Read resource content
    this.server.setRequestHandler(
      ReadResourceRequestSchema,
      async (request) => {
        const { uri } = request.params;

        if (uri === "sudocode://quickstart") {
          return {
            contents: [
              {
                uri,
                mimeType: "text/markdown",
                text: `# sudocode Quickstart

sudocode is a git-native spec and issue management system designed for AI-assisted development.

## Core Concepts

**Specs**: Technical specifications stored as markdown files
- Types: architecture, api, database, feature, research
- Status: draft → review → approved → deprecated
- Each spec has a unique hash-based ID (e.g., s-14sh) and file path

**Issues**: Work items tracked in the database
- Types: bug, feature, task, epic, chore
- Status: open → in_progress → blocked → closed
- Can reference and implement specs
- Each issue has a unique hash-based ID (e.g., i-x7k9)

**Feedback**: Issues can provide anchored feedback on specs
- Anchors track specific lines/sections in spec markdown
- Auto-relocates when specs change (smart anchoring)
- Types: comment, suggestion, request

## Typical Workflow

1. **Check ready work**: \`ready\` tool to find tasks with no blockers
2. **Claim work**: \`update_issue\` with status=in_progress
3. **Review specs**: \`show_spec\` to understand requirements
4. **Provide feedback**: \`add_feedback\` when specs are unclear
5. **Complete work**: \`close_issue\` when done
6. **Link entities**: Use \`link\` to create relationships

## Relationship Types
- \`blocks\`: Hard blocker (to_id must complete before from_id)
- \`implements\`: Issue implements a spec
- \`references\`: Soft reference
- \`depends-on\`: General dependency
- \`discovered-from\`: New work found during implementation
- \`related\`: General relationship
`,
              },
            ],
          };
        }

        throw new Error(`Unknown resource: ${uri}`);
      }
    );
  }

  /**
   * Check for .sudocode directory and required files
   * Returns initialization status and handles auto-import if needed
   */
  private async checkForInit(): Promise<{
    initialized: boolean;
    sudocodeExists: boolean;
    message?: string;
  }> {
    const workingDir = this.client["workingDir"] || process.cwd();
    const sudocodeDir = join(workingDir, ".sudocode");
    const cacheDbPath = join(sudocodeDir, "cache.db");
    const issuesPath = join(sudocodeDir, "issues.jsonl");
    const specsPath = join(sudocodeDir, "specs.jsonl");

    // Check if .sudocode directory exists
    if (!existsSync(sudocodeDir)) {
      return {
        initialized: false,
        sudocodeExists: false,
        message: "No .sudocode directory found",
      };
    }

    // .sudocode exists, check for cache.db
    if (!existsSync(cacheDbPath)) {
      // Try to auto-import from JSONL files if they exist
      if (existsSync(issuesPath) || existsSync(specsPath)) {
        try {
          console.error(
            "Found .sudocode directory but no cache.db, running import..."
          );
          await this.client.exec(["import"]);
          console.error("✓ Successfully imported data to cache.db");
          return {
            initialized: true,
            sudocodeExists: true,
            message: "Auto-imported from JSONL files",
          };
        } catch (error) {
          return {
            initialized: false,
            sudocodeExists: true,
            message: `Failed to import: ${
              error instanceof Error ? error.message : String(error)
            }`,
          };
        }
      } else {
        try {
          console.error(
            "Found .sudocode directory but no issues.jsonl or specs.jsonl, running init..."
          );
          await this.client.exec(["init"]);
          console.error("✓ Successfully initialized sudocode");
          await this.client.exec(["import"]);
          return {
            initialized: true,
            sudocodeExists: true,
            message: "Initialized sudocode",
          };
        } catch (error) {
          return {
            initialized: false,
            sudocodeExists: true,
            message: `Failed to initialize: ${
              error instanceof Error ? error.message : String(error)
            }`,
          };
        }
      }
    }

    return {
      initialized: true,
      sudocodeExists: true,
    };
  }

  /**
   * Check if sudocode is initialized in the working directory
   * This provides early warning to users without blocking server startup
   */
  private async checkInitialization() {
    const initStatus = await this.checkForInit();
    const workingDir = this.client["workingDir"] || process.cwd();

    if (initStatus.initialized) {
      this.isInitialized = true;
      console.error("✓ sudocode initialized successfully");
      if (initStatus.message) {
        console.error(`  ${initStatus.message}`);
      }
    } else {
      this.isInitialized = false;
      console.error("");
      console.error("⚠️  WARNING: sudocode is not initialized");
      console.error(`   Working directory: ${workingDir}`);
      console.error("");

      if (!initStatus.sudocodeExists) {
        console.error("   No .sudocode directory found.");
        console.error("   To initialize, run:");
        console.error("   $ sudocode init");
      } else {
        console.error(`   Issue: ${initStatus.message}`);
        console.error("   The .sudocode directory exists but is incomplete.");
        console.error("   Try running:");
        console.error("   $ sudocode import");
      }
    }
  }

  async run() {
    // Check if sudocode is initialized (non-blocking warning)
    await this.checkInitialization();

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("sudocode MCP server running on stdio");
  }
}
