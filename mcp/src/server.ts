/**
 * MCP Server for Sudograph
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
import * as analyticsTools from "./tools/analytics.js";
import * as initTools from "./tools/init.js";
import * as feedbackTools from "./tools/feedback.js";

export class SudocodeMCPServer {
  private server: Server;
  private client: SudocodeClient;

  constructor() {
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

    this.client = new SudocodeClient();
    this.setupHandlers();
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "ready",
            description: "Find issues and specs ready to work on (no blockers)",
            inputSchema: {
              type: "object",
              properties: {
                limit: {
                  type: "number",
                  description: "Max items to return",
                  default: 10,
                },
                priority: {
                  type: "number",
                  description: "Filter by priority (0-4, 0=highest)",
                },
                assignee: {
                  type: "string",
                  description: "Filter by assignee",
                },
                show_specs: {
                  type: "boolean",
                  description: "Include ready specs",
                  default: false,
                },
                show_issues: {
                  type: "boolean",
                  description: "Include ready issues",
                  default: true,
                },
              },
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
                  description: "Filter by status",
                },
                type: {
                  type: "string",
                  enum: ["bug", "feature", "task", "epic", "chore"],
                  description: "Filter by issue type",
                },
                priority: {
                  type: "number",
                  description: "Filter by priority (0-4)",
                },
                assignee: {
                  type: "string",
                  description: "Filter by assignee",
                },
                limit: {
                  type: "number",
                  description: "Max results",
                  default: 50,
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
                  description: 'Issue ID (e.g., "sg-1")',
                },
              },
              required: ["issue_id"],
            },
          },
          {
            name: "create_issue",
            description: "Create a new issue",
            inputSchema: {
              type: "object",
              properties: {
                title: {
                  type: "string",
                  description: "Issue title",
                },
                description: {
                  type: "string",
                  description: "Issue description",
                  default: "",
                },
                type: {
                  type: "string",
                  enum: ["bug", "feature", "task", "epic", "chore"],
                  description: "Issue type",
                  default: "task",
                },
                priority: {
                  type: "number",
                  description: "Priority (0-4, 0=highest)",
                  default: 2,
                },
                assignee: {
                  type: "string",
                  description: "Assignee username",
                },
                parent: {
                  type: "string",
                  description: "Parent issue ID",
                },
                tags: {
                  type: "array",
                  items: { type: "string" },
                  description: "Tags",
                },
                estimate: {
                  type: "number",
                  description: "Estimated minutes",
                },
              },
              required: ["title"],
            },
          },
          {
            name: "update_issue",
            description: "Update an existing issue",
            inputSchema: {
              type: "object",
              properties: {
                issue_id: {
                  type: "string",
                  description: "Issue ID",
                },
                status: {
                  type: "string",
                  enum: ["open", "in_progress", "blocked", "closed"],
                  description: "New status",
                },
                priority: {
                  type: "number",
                  description: "New priority",
                },
                assignee: {
                  type: "string",
                  description: "New assignee",
                },
                type: {
                  type: "string",
                  enum: ["bug", "feature", "task", "epic", "chore"],
                  description: "New type",
                },
                title: {
                  type: "string",
                  description: "New title",
                },
                description: {
                  type: "string",
                  description: "New description",
                },
              },
              required: ["issue_id"],
            },
          },
          {
            name: "close_issue",
            description: "Close one or more issues",
            inputSchema: {
              type: "object",
              properties: {
                issue_ids: {
                  type: "array",
                  items: { type: "string" },
                  description: "Issue IDs to close",
                },
                reason: {
                  type: "string",
                  description: "Reason for closing",
                  default: "Completed",
                },
              },
              required: ["issue_ids"],
            },
          },
          {
            name: "blocked_issues",
            description: "Get blocked issues showing what is blocking them",
            inputSchema: {
              type: "object",
              properties: {
                show_specs: {
                  type: "boolean",
                  description: "Include blocked specs",
                  default: false,
                },
                show_issues: {
                  type: "boolean",
                  description: "Include blocked issues",
                  default: true,
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
                status: {
                  type: "string",
                  enum: ["draft", "review", "approved", "deprecated"],
                  description: "Filter by status",
                },
                type: {
                  type: "string",
                  enum: [
                    "architecture",
                    "api",
                    "database",
                    "feature",
                    "research",
                  ],
                  description: "Filter by spec type",
                },
                priority: {
                  type: "number",
                  description: "Filter by priority (0-4)",
                },
                limit: {
                  type: "number",
                  description: "Max results",
                  default: 50,
                },
              },
            },
          },
          {
            name: "show_spec",
            description: "Show detailed spec information including feedback",
            inputSchema: {
              type: "object",
              properties: {
                spec_id: {
                  type: "string",
                  description: 'Spec ID (e.g., "sg-spec-1")',
                },
              },
              required: ["spec_id"],
            },
          },
          {
            name: "create_spec",
            description: "Create a new spec",
            inputSchema: {
              type: "object",
              properties: {
                title: {
                  type: "string",
                  description: "Spec title",
                },
                type: {
                  type: "string",
                  enum: [
                    "architecture",
                    "api",
                    "database",
                    "feature",
                    "research",
                  ],
                  description: "Spec type",
                  default: "feature",
                },
                priority: {
                  type: "number",
                  description: "Priority (0-4, 0=highest)",
                  default: 2,
                },
                description: {
                  type: "string",
                  description: "Spec description",
                },
                design: {
                  type: "string",
                  description: "Design notes",
                },
                file_path: {
                  type: "string",
                  description: "Path for spec markdown file",
                },
                parent: {
                  type: "string",
                  description: "Parent spec ID",
                },
                tags: {
                  type: "array",
                  items: { type: "string" },
                  description: "Tags",
                },
              },
              required: ["title"],
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
                    "parent-child",
                    "discovered-from",
                    "related",
                  ],
                  description: "Relationship type",
                },
              },
              required: ["from_id", "to_id"],
            },
          },
          {
            name: "stats",
            description: "Get comprehensive project statistics",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
          {
            name: "status",
            description: "Get quick project status",
            inputSchema: {
              type: "object",
              properties: {
                verbose: {
                  type: "boolean",
                  description: "Show verbose output",
                  default: false,
                },
              },
            },
          },
          {
            name: "init",
            description: "Initialize Sudograph in the current directory",
            inputSchema: {
              type: "object",
              properties: {
                prefix: {
                  type: "string",
                  description: "ID prefix for specs and issues",
                  default: "sudocode",
                },
              },
            },
          },
          {
            name: "add_feedback",
            description: "Add anchored feedback to a spec",
            inputSchema: {
              type: "object",
              properties: {
                issue_id: {
                  type: "string",
                  description: "Issue ID providing feedback",
                },
                spec_id: {
                  type: "string",
                  description: "Spec ID receiving feedback",
                },
                content: {
                  type: "string",
                  description: "Feedback content",
                },
                type: {
                  type: "string",
                  enum: [
                    "ambiguity",
                    "missing_requirement",
                    "technical_constraint",
                    "suggestion",
                    "question",
                  ],
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
                agent: {
                  type: "string",
                  description: "Agent providing feedback",
                },
              },
              required: ["issue_id", "spec_id", "content"],
            },
          },
          {
            name: "list_feedback",
            description: "List feedback with optional filters",
            inputSchema: {
              type: "object",
              properties: {
                issue: {
                  type: "string",
                  description: "Filter by issue ID",
                },
                spec: {
                  type: "string",
                  description: "Filter by spec ID",
                },
                type: {
                  type: "string",
                  enum: [
                    "ambiguity",
                    "missing_requirement",
                    "technical_constraint",
                    "suggestion",
                    "question",
                  ],
                  description: "Filter by feedback type",
                },
                status: {
                  type: "string",
                  enum: ["open", "acknowledged", "resolved", "wont_fix"],
                  description: "Filter by feedback status",
                },
                limit: {
                  type: "number",
                  description: "Max results",
                  default: 50,
                },
              },
            },
          },
          {
            name: "show_feedback",
            description: "Show detailed feedback information",
            inputSchema: {
              type: "object",
              properties: {
                feedback_id: {
                  type: "string",
                  description: "Feedback ID",
                },
              },
              required: ["feedback_id"],
            },
          },
          {
            name: "acknowledge_feedback",
            description: "Acknowledge feedback",
            inputSchema: {
              type: "object",
              properties: {
                feedback_id: {
                  type: "string",
                  description: "Feedback ID to acknowledge",
                },
              },
              required: ["feedback_id"],
            },
          },
          {
            name: "resolve_feedback",
            description: "Resolve feedback",
            inputSchema: {
              type: "object",
              properties: {
                feedback_id: {
                  type: "string",
                  description: "Feedback ID to resolve",
                },
              },
              required: ["feedback_id"],
            },
          },
          {
            name: "wontfix_feedback",
            description: "Mark feedback as won't fix",
            inputSchema: {
              type: "object",
              properties: {
                feedback_id: {
                  type: "string",
                  description: "Feedback ID to mark as won't fix",
                },
              },
              required: ["feedback_id"],
            },
          },
          {
            name: "stale_feedback",
            description: "Get stale feedback with outdated anchors",
            inputSchema: {
              type: "object",
              properties: {
                limit: {
                  type: "number",
                  description: "Max results",
                  default: 50,
                },
              },
            },
          },
          {
            name: "relocate_feedback",
            description: "Relocate feedback anchor after spec changes",
            inputSchema: {
              type: "object",
              properties: {
                feedback_id: {
                  type: "string",
                  description: "Feedback ID to relocate",
                },
              },
              required: ["feedback_id"],
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

          case "create_issue":
            result = await issueTools.createIssue(this.client, args as any);
            break;

          case "update_issue":
            result = await issueTools.updateIssue(this.client, args as any);
            break;

          case "close_issue":
            result = await issueTools.closeIssue(this.client, args as any);
            break;

          case "blocked_issues":
            result = await issueTools.blockedIssues(this.client, args as any);
            break;

          case "list_specs":
            result = await specTools.listSpecs(this.client, args as any);
            break;

          case "show_spec":
            result = await specTools.showSpec(this.client, args as any);
            break;

          case "create_spec":
            result = await specTools.createSpec(this.client, args as any);
            break;

          case "link":
            result = await relationshipTools.link(this.client, args as any);
            break;

          case "stats":
            result = await analyticsTools.stats(this.client);
            break;

          case "status":
            result = await analyticsTools.status(this.client, args as any);
            break;

          case "init":
            result = await initTools.init(this.client, args as any);
            break;

          case "add_feedback":
            result = await feedbackTools.addFeedback(this.client, args as any);
            break;

          case "list_feedback":
            result = await feedbackTools.listFeedback(this.client, args as any);
            break;

          case "show_feedback":
            result = await feedbackTools.showFeedback(this.client, args as any);
            break;

          case "acknowledge_feedback":
            result = await feedbackTools.acknowledgeFeedback(
              this.client,
              args as any
            );
            break;

          case "resolve_feedback":
            result = await feedbackTools.resolveFeedback(
              this.client,
              args as any
            );
            break;

          case "wontfix_feedback":
            result = await feedbackTools.wontfixFeedback(
              this.client,
              args as any
            );
            break;

          case "stale_feedback":
            result = await feedbackTools.staleFeedback(
              this.client,
              args as any
            );
            break;

          case "relocate_feedback":
            result = await feedbackTools.relocateFeedback(
              this.client,
              args as any
            );
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
- Each spec has a unique ID (e.g., sg-spec-1) and file path

**Issues**: Work items tracked in the database
- Types: bug, feature, task, epic, chore
- Status: open → in_progress → blocked → closed
- Can reference and implement specs

**Feedback**: Issues can provide anchored feedback on specs
- Anchors track specific lines/sections in spec markdown
- Auto-relocates when specs change (smart anchoring)
- Types: ambiguity, missing_requirement, technical_constraint, suggestion, question

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
- \`parent-child\`: Epic/subtask hierarchy
- \`discovered-from\`: New work found during implementation
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
