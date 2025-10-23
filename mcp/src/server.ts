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

export class SudocodeMCPServer {
  private server: Server;
  private client: SudocodeClient;

  constructor(config?: import("./types.js").SudocodeClientConfig) {
    this.server = new Server(
      {
        name: "sudocode",
        version: "0.1.0",
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
              "Find issues ready to work on (no blockers) and gets project status.",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
          {
            name: "list_issues",
            description: "List all issues with optional filters",
            inputSchema: {
              type: "object",
              properties: {
                status: {
                  type: "string",
                  enum: ["open", "in_progress", "blocked", "closed"],
                  description: "Filter by status (optional)",
                },
                priority: {
                  type: "number",
                  description: "Filter by priority (0-4) (optional)",
                },
                limit: {
                  type: "number",
                  description: "Max results (optional)",
                  default: 50,
                },
                search: {
                  type: "string",
                  description:
                    "Search issues by title or description (optional)",
                },
              },
            },
          },
          {
            name: "show_issue",
            description:
              "Show detailed issue information including relationships and feedback",
            inputSchema: {
              type: "object",
              properties: {
                issue_id: {
                  type: "string",
                  description: 'Issue ID (e.g., "ISSUE-001")',
                },
              },
              required: ["issue_id"],
            },
          },
          {
            name: "upsert_issue",
            description:
              "Create or update an issue. If issue_id is provided, updates the issue; otherwise creates a new one. To close an issue, set status='closed'.",
            inputSchema: {
              type: "object",
              properties: {
                issue_id: {
                  type: "string",
                  description:
                    "Issue ID (optional - if provided, updates the issue; if not, creates new)",
                },
                title: {
                  type: "string",
                  description:
                    "Issue title (required for create, optional for update)",
                },
                description: {
                  type: "string",
                  description:
                    "Issue descriptions. Supports inline references to other specs/issues by ID in Obsidian internal link format (e.g. `[[SPEC-002]]`).",
                },
                priority: {
                  type: "number",
                  description: "Priority (0-4, 0=highest) (optional)",
                },
                parent: {
                  type: "string",
                  description: "Parent issue ID (optional)",
                },
                tags: {
                  type: "array",
                  items: { type: "string" },
                  description: "Tags (optional)",
                },
                status: {
                  type: "string",
                  enum: ["open", "in_progress", "blocked", "closed"],
                  description: "Issue status (optional)",
                },
              },
            },
          },
          {
            name: "list_specs",
            description: "List all specs with optional filters",
            inputSchema: {
              type: "object",
              properties: {
                limit: {
                  type: "number",
                  description: "Max results (optional)",
                  default: 50,
                },
                search: {
                  type: "string",
                  description:
                    "Search specs by title or description (optional)",
                },
              },
            },
          },
          {
            name: "show_spec",
            description:
              "Show detailed spec information including all feedback anchored to the spec",
            inputSchema: {
              type: "object",
              properties: {
                spec_id: {
                  type: "string",
                  description: 'Spec ID (e.g., "SPEC-001")',
                },
              },
              required: ["spec_id"],
            },
          },
          {
            name: "upsert_spec",
            description: "Create a new spec (update not yet supported in CLI)",
            inputSchema: {
              type: "object",
              properties: {
                spec_id: {
                  type: "string",
                  description:
                    "Spec ID (optional - if provided, updates the spec; if not, creates new)",
                },
                title: {
                  type: "string",
                  description: "Spec title (required for create)",
                },
                priority: {
                  type: "number",
                  description: "Priority (0-4, 0=highest) (optional)",
                },
                description: {
                  type: "string",
                  description: "Spec description (optional)",
                },
                design: {
                  type: "string",
                  description:
                    "Design notes (optional). Supports inline references to other specs/issues by ID in Obsidian internal link format (e.g. `[[ISSUE-001]]`).",
                },
                parent: {
                  type: "string",
                  description: "Parent spec ID (optional)",
                },
                tags: {
                  type: "array",
                  items: { type: "string" },
                  description: "Tags (optional)",
                },
              },
            },
          },
          {
            name: "link",
            description:
              "Create a relationship between two entities (specs or issues)",
            inputSchema: {
              type: "object",
              properties: {
                from_id: {
                  type: "string",
                  description: "Source entity ID",
                },
                to_id: {
                  type: "string",
                  description: "Target entity ID",
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
                  description: "Relationship type",
                },
              },
              required: ["from_id", "to_id"],
            },
          },
          // TODO: Add a tool to add an inline reference to a spec or issue.
          {
            name: "add_feedback",
            description: "Provide feedback to a spec.",
            inputSchema: {
              type: "object",
              properties: {
                issue_id: {
                  type: "string",
                  description:
                    "Issue ID providing feedback (required for create)",
                },
                spec_id: {
                  type: "string",
                  description:
                    "Spec ID receiving feedback (required for create)",
                },
                content: {
                  type: "string",
                  description: "Feedback content (required for create)",
                },
                type: {
                  type: "string",
                  enum: ["comment", "suggestion", "request"],
                  description: "Feedback type",
                },
                line: {
                  type: "number",
                  description:
                    "Line number to anchor feedback (use line OR text, not both)",
                },
                text: {
                  type: "string",
                  description:
                    "Text snippet to anchor feedback (use line OR text, not both)",
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
- Each spec has a unique ID (e.g., SPEC-001) and file path

**Issues**: Work items tracked in the database
- Types: bug, feature, task, epic, chore
- Status: open → in_progress → blocked → closed
- Can reference and implement specs

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

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("sudocode MCP server running on stdio");
  }
}
