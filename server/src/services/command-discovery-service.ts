/**
 * CommandDiscoveryService - Discovers available slash commands for an agent
 *
 * Creates a temporary ACP session to capture `available_commands_update` events
 * without creating an execution record. Used for lazy command discovery when
 * user types "/" in the prompt input.
 *
 * @module services/command-discovery-service
 */

import {
  AgentFactory,
  type AgentHandle,
  type Session,
  type SessionUpdate,
} from "acp-factory";

export interface AvailableCommandInput {
  hint: string;
}

export interface AvailableCommand {
  name: string;
  description: string;
  input?: AvailableCommandInput;
}

export class CommandDiscoveryService {
  private readonly timeoutMs: number;

  constructor(options?: { timeoutMs?: number }) {
    this.timeoutMs = options?.timeoutMs ?? 10000; // 10 second default timeout
  }

  /**
   * Discover available slash commands for an agent type
   *
   * Spawns the agent, creates a session, sends a minimal prompt to trigger
   * the event stream, captures the available_commands_update, then kills
   * the agent. No execution record is created.
   *
   * @param agentType - The agent type (e.g., 'claude-code', 'codex')
   * @param workDir - Working directory for the session
   * @returns Array of available commands, or empty array if none/error
   */
  async discoverCommands(
    agentType: string,
    workDir: string
  ): Promise<AvailableCommand[]> {
    let agent: AgentHandle | null = null;

    try {
      // Spawn agent with auto permission mode (no interactive prompts needed)
      agent = await AgentFactory.spawn(agentType, {
        env: process.env as Record<string, string>,
        permissionMode: "auto-approve",
      });

      // Create session (no mode specified - use agent default)
      const session = await agent.createSession(workDir);

      // Capture commands from the event stream
      const commands = await this.captureCommandsFromSession(session);

      return commands;
    } catch (error) {
      console.error(
        `[CommandDiscoveryService] Failed to discover commands for ${agentType}:`,
        error
      );
      return [];
    } finally {
      // Always cleanup the agent process
      if (agent) {
        try {
          await agent.close();
        } catch (killError) {
          console.warn(
            "[CommandDiscoveryService] Failed to kill agent:",
            killError
          );
        }
      }
    }
  }

  /**
   * Capture available_commands_update from the session event stream
   *
   * Sends an empty prompt to trigger the event stream, then exits early
   * once we receive the commands or timeout.
   */
  private async captureCommandsFromSession(
    session: Session
  ): Promise<AvailableCommand[]> {
    const startTime = Date.now();
    let commands: AvailableCommand[] = [];
    let updateCount = 0;

    try {
      // Send empty prompt to trigger event stream
      // available_commands_update typically arrives early in the stream
      console.log("[CommandDiscoveryService] Starting prompt iteration...");

      for await (const update of session.prompt("")) {
        updateCount++;
        const sessionUpdate = update as SessionUpdate;

        // Log all events for debugging
        console.log(
          `[CommandDiscoveryService] Event ${updateCount}:`,
          sessionUpdate.sessionUpdate,
          // Log keys of the update object
          Object.keys(update)
        );

        // Check for available_commands_update
        if (sessionUpdate.sessionUpdate === "available_commands_update") {
          console.log("[CommandDiscoveryService] Found available_commands_update!");
          const commandsUpdate = sessionUpdate as SessionUpdate & {
            availableCommands?: Array<{
              name: string;
              description: string;
              input?: { hint: string } | null;
            }>;
          };

          if (commandsUpdate.availableCommands && Array.isArray(commandsUpdate.availableCommands)) {
            commands = commandsUpdate.availableCommands.map((cmd) => ({
              name: cmd.name,
              description: cmd.description,
              input: cmd.input ?? undefined,
            }));
            console.log(`[CommandDiscoveryService] Extracted ${commands.length} commands`);
          }
          break; // Got what we need, exit early
        }

        // Timeout check
        if (Date.now() - startTime > this.timeoutMs) {
          console.warn(
            "[CommandDiscoveryService] Timeout waiting for available_commands_update after",
            updateCount,
            "events"
          );
          break;
        }

        // Exit after first actual content (agent started responding without sending commands)
        if (
          sessionUpdate.sessionUpdate === "agent_message_chunk" ||
          sessionUpdate.sessionUpdate === "tool_call"
        ) {
          console.log(
            "[CommandDiscoveryService] Agent started responding without sending commands, exiting after",
            updateCount,
            "events"
          );
          // Agent is responding but hasn't sent commands - they may not be supported
          break;
        }
      }

      console.log(`[CommandDiscoveryService] Finished after ${updateCount} events, found ${commands.length} commands`);
    } catch (error) {
      // Handle iterator interruption gracefully
      console.warn(
        "[CommandDiscoveryService] Session iteration interrupted after",
        updateCount,
        "events:",
        error
      );
    }

    return commands;
  }
}
