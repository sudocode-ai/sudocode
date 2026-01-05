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
import { SudocodeMCPServerConfig } from "./types.js";
import { existsSync } from "fs";
import { join } from "path";
import {
  type Scope,
  type ScopeConfig,
  resolveScopes,
  getUsableScopes,
  hasExtendedScopes,
} from "./scopes.js";
import { SudocodeAPIClient } from "./api-client.js";
import {
  getToolsForScopes as getToolDefsForScopes,
  getToolByName,
  getHandlerType,
} from "./tool-registry.js";

export class SudocodeMCPServer {
  private server: Server;
  private client: SudocodeClient;
  private apiClient: SudocodeAPIClient | null = null;
  private config: SudocodeMCPServerConfig;
  private scopeConfig: ScopeConfig;
  private usableScopes: Set<Scope>;
  private isInitialized: boolean = false;

  constructor(config?: SudocodeMCPServerConfig) {
    this.config = config || {};

    // Resolve scopes from config
    const scopeArg = this.config.scope || "default";
    this.scopeConfig = resolveScopes(
      scopeArg,
      this.config.serverUrl,
      this.config.projectId
    );

    // Determine which scopes are actually usable (have prerequisites met)
    this.usableScopes = getUsableScopes(
      this.scopeConfig.enabledScopes,
      this.config.serverUrl
    );

    // Create API client if server URL is configured and extended scopes are enabled
    if (this.config.serverUrl && hasExtendedScopes(this.usableScopes)) {
      this.apiClient = new SudocodeAPIClient({
        serverUrl: this.config.serverUrl,
        projectId: this.config.projectId,
      });
    }

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
    // List available tools - filtered by usable scopes
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const availableTools = getToolDefsForScopes(this.usableScopes);
      return {
        tools: availableTools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      };
    });

    // Handle tool calls - route to CLI or API based on tool scope
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      // Get tool definition
      const tool = getToolByName(name);
      if (!tool) {
        return {
          content: [
            {
              type: "text",
              text: `Unknown tool: ${name}`,
            },
          ],
          isError: true,
        };
      }

      // Check if tool is in enabled scopes
      if (!this.usableScopes.has(tool.scope)) {
        return {
          content: [
            {
              type: "text",
              text: `Tool '${name}' is not available. Scope '${tool.scope}' is not enabled or missing prerequisites (--server-url).`,
            },
          ],
          isError: true,
        };
      }

      // Check initialization for CLI tools
      const handlerType = getHandlerType(tool);
      if (handlerType === "cli" && !this.isInitialized) {
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
        let result: unknown;

        if (handlerType === "cli") {
          // Route to CLI handlers (default scope)
          result = await this.handleCliTool(name, args as Record<string, unknown>);
        } else {
          // Route to API handlers (extended scopes)
          result = await this.handleApiTool(name, args as Record<string, unknown>);
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
   * Handle CLI-based tools (default scope).
   */
  private async handleCliTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    switch (name) {
      case "ready":
        return issueTools.ready(this.client, args as any);
      case "list_issues":
        return issueTools.listIssues(this.client, args as any);
      case "show_issue":
        return issueTools.showIssue(this.client, args as any);
      case "upsert_issue":
        return issueTools.upsertIssue(this.client, args as any);
      case "list_specs":
        return specTools.listSpecs(this.client, args as any);
      case "show_spec":
        return specTools.showSpec(this.client, args as any);
      case "upsert_spec":
        return specTools.upsertSpec(this.client, args as any);
      case "link":
        return relationshipTools.link(this.client, args as any);
      case "add_reference":
        return referenceTools.addReference(this.client, args as any);
      case "add_feedback":
        return feedbackTools.addFeedback(this.client, args as any);
      default:
        throw new Error(`Unknown CLI tool: ${name}`);
    }
  }

  /**
   * Handle API-based tools (extended scopes).
   */
  private async handleApiTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    if (!this.apiClient) {
      throw new Error(
        `Tool '${name}' requires --server-url to be configured.`
      );
    }

    switch (name) {
      // Overview
      case "project_status":
        return this.apiClient.getProjectStatus();

      // Executions
      case "list_executions":
        return this.apiClient.listExecutions(args as any);
      case "show_execution":
        return this.apiClient.showExecution(args as any);
      case "start_execution":
        return this.apiClient.startExecution(args as any);
      case "start_adhoc_execution":
        return this.apiClient.startAdhocExecution(args as any);
      case "create_follow_up":
        return this.apiClient.createFollowUp(args as any);
      case "cancel_execution":
        return this.apiClient.cancelExecution(args as any);

      // Inspection
      case "execution_trajectory":
        return this.apiClient.getExecutionTrajectory(args as any);
      case "execution_changes":
        return this.apiClient.getExecutionChanges(args as any);
      case "execution_chain":
        return this.apiClient.getExecutionChain(args as any);

      // Workflows
      case "list_workflows":
        return this.apiClient.listWorkflows(args as any);
      case "show_workflow":
        return this.apiClient.showWorkflow(args as any);
      case "workflow_status":
        return this.apiClient.getWorkflowStatus(args as any);
      case "create_workflow":
        return this.apiClient.createWorkflow(args as any);
      case "start_workflow":
        return this.apiClient.startWorkflow(args as any);
      case "pause_workflow":
        return this.apiClient.pauseWorkflow(args as any);
      case "cancel_workflow":
        return this.apiClient.cancelWorkflow(args as any);
      case "resume_workflow":
        return this.apiClient.resumeWorkflow(args as any);

      default:
        throw new Error(`Unknown API tool: ${name}`);
    }
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

    // Log scope configuration
    const enabledScopesList = Array.from(this.usableScopes).join(", ");
    const availableTools = getToolDefsForScopes(this.usableScopes);
    console.error(`✓ Enabled scopes: ${enabledScopesList}`);
    console.error(`✓ Available tools: ${availableTools.length}`);

    if (this.config.serverUrl) {
      console.error(`✓ Server URL: ${this.config.serverUrl}`);
    }

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("sudocode MCP server running on stdio");
  }
}
