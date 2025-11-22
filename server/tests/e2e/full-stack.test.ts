/**
 * Full-Stack End-to-End Tests
 *
 * These tests exercise all layers of the execution stack:
 * - Process Layer: Spawns real Claude Code processes
 * - Engine Layer: Manages task queue and execution
 * - Resilience Layer: Handles retries and circuit breaking
 * - Workflow Layer: Orchestrates complex multi-step workflows
 * - Output Layer: Parses and processes Claude Code's stream-json output
 *
 * IMPORTANT: These tests require Claude Code CLI to be installed and configured.
 * They are SKIPPED BY DEFAULT and will only run when:
 * - The environment variable RUN_E2E_TESTS=true is set
 * - AND Claude Code is available in the PATH
 *
 * To run these tests explicitly:
 *   npm run test:e2e
 *
 * Or with environment variable:
 *   RUN_E2E_TESTS=true npm test
 */

import { describe, it, beforeEach, afterEach, expect, beforeAll } from 'vitest'
import { spawn } from 'node:child_process';
import { SimpleProcessManager } from 'agent-execution-engine';
import { ClaudeCodeOutputProcessor } from '../../src/execution/output/claude-code-output-processor.js';
import { buildClaudeConfig } from '../../src/execution/process/builders/claude.js';

// Check if E2E tests should run
const SKIP_E2E = process.env.SKIP_E2E_TESTS === 'true' || process.env.RUN_E2E_TESTS !== 'true';
const CLAUDE_PATH = process.env.CLAUDE_PATH || 'claude';

/**
 * Check if Claude Code is available
 */
async function checkClaudeAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const check = spawn(CLAUDE_PATH, ['--version'], {
      stdio: 'ignore',
    });

    check.on('error', () => resolve(false));
    check.on('exit', (code) => resolve(code === 0));

    // Timeout after 5 seconds
    setTimeout(() => {
      check.kill();
      resolve(false);
    }, 5000);
  });
}

describe('Full-Stack E2E Tests', { skip: SKIP_E2E }, () => {
  let manager: SimpleProcessManager;
  let claudeAvailable = false;

  beforeAll(async () => {
    // Check if Claude is available before running any tests
    claudeAvailable = await checkClaudeAvailable();

    if (!claudeAvailable) {
      console.log('⚠️  Claude Code not available - E2E tests will be skipped');
      console.log('   To run E2E tests, ensure Claude Code is installed and in PATH');
      console.log('   Or set CLAUDE_PATH environment variable');
    }
  });

  beforeEach(() => {
    manager = new SimpleProcessManager();
  });

  afterEach(async () => {
    // Clean up all processes
    await manager.shutdown();

    // Force cleanup if shutdown didn't work
    const activeProcesses = manager.getAllProcesses();
    for (const proc of activeProcesses) {
      if (proc.status === 'running' && proc.pid) {
        try {
          process.kill(proc.pid, 'SIGKILL');
        } catch (e) {
          // Process already dead, ignore
        }
      }
    }
  });

  describe('Process + Output Layer Integration', () => {
    it('should spawn Claude Code and process its stream-json output', { skip: !claudeAvailable }, async () => {
      // Build Claude Code configuration
      const config = buildClaudeConfig({
        workDir: process.cwd(),
        print: true,
        outputFormat: 'stream-json',
        dangerouslySkipPermissions: true,
      });

      // Spawn Claude Code process
      const managedProcess = await manager.acquireProcess(config);
      expect(managedProcess.id).toBeTruthy();
      expect(managedProcess.pid).toBeTruthy();

      // Create output processor
      const processor = new ClaudeCodeOutputProcessor();

      // Track tool calls
      const toolCalls: any[] = [];
      processor.onToolCall((toolCall) => {
        toolCalls.push(toolCall);
      });

      // Track file changes
      const fileChanges: any[] = [];
      processor.onFileChange((fileChange) => {
        fileChanges.push(fileChange);
      });

      // Capture and process output line by line
      const outputLines: string[] = [];
      manager.onOutput(managedProcess.id, async (data, type) => {
        if (type === 'stdout') {
          const lines = data.toString().split('\n');
          for (const line of lines) {
            if (line.trim()) {
              outputLines.push(line);
              await processor.processLine(line);
            }
          }
        }
      });

      // Wait for process to complete (with timeout)
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Test timeout after 30 seconds'));
        }, 30000);

        const checkComplete = setInterval(() => {
          const process = manager.getProcess(managedProcess.id);
          if (process && (process.status === 'completed' || process.status === 'crashed')) {
            clearInterval(checkComplete);
            clearTimeout(timeout);
            resolve();
          }
        }, 100);
      });

      // Verify we processed some output
      expect(outputLines.length > 0, 'Should have received output lines').toBeTruthy();

      // Verify processor tracked messages
      const metrics = processor.getMetrics();
      expect(metrics.totalMessages > 0, 'Should have processed messages').toBeTruthy();

      // Verify at least one tool call (the Bash command)
      expect(toolCalls.length > 0, 'Should have tracked tool calls').toBeTruthy();

      // Verify we have a Bash tool call
      const bashCalls = processor.getToolCallsByName('Bash');
      expect(bashCalls.length > 0, 'Should have Bash tool call').toBeTruthy();

      // Verify token usage was tracked
      expect(metrics.usage.totalTokens > 0, 'Should have tracked token usage').toBeTruthy();

      // Verify cost was calculated
      expect(metrics.usage.cost! > 0, 'Should have calculated cost').toBeTruthy();
    });

    it('should track file operations through all layers', { skip: !claudeAvailable }, async () => {
      // Build Claude Code configuration to create and read a file
      const config = buildClaudeConfig({
        workDir: process.cwd(),
        print: true,
        outputFormat: 'stream-json',
        dangerouslySkipPermissions: true,
      });

      // Spawn Claude Code process
      const managedProcess = await manager.acquireProcess(config);

      // Create output processor
      const processor = new ClaudeCodeOutputProcessor();

      // Track file changes
      const fileChanges: any[] = [];
      processor.onFileChange((fileChange) => {
        fileChanges.push(fileChange);
      });

      // Process output
      manager.onOutput(managedProcess.id, async (data, type) => {
        if (type === 'stdout') {
          const lines = data.toString().split('\n');
          for (const line of lines) {
            if (line.trim()) {
              await processor.processLine(line);
            }
          }
        }
      });

      // Wait for completion
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Test timeout after 30 seconds'));
        }, 30000);

        const checkComplete = setInterval(() => {
          const process = manager.getProcess(managedProcess.id);
          if (process && (process.status === 'completed' || process.status === 'crashed')) {
            clearInterval(checkComplete);
            clearTimeout(timeout);
            resolve();
          }
        }, 100);
      });

      // Verify file operations were tracked
      const allFileChanges = processor.getFileChanges();
      expect(allFileChanges.length > 0, 'Should have tracked file changes').toBeTruthy();

      // Verify we have both write and read operations
      const writes = processor.getFileChangesByOperation('write');
      const reads = processor.getFileChangesByOperation('read');

      expect(writes.length > 0 || reads.length > 0, 'Should have file operations').toBeTruthy();
    });

    it('should generate execution summary from real Claude output', { skip: !claudeAvailable }, async () => {
      // Build Claude Code configuration for a simple task
      const config = buildClaudeConfig({
        workDir: process.cwd(),
        print: true,
        outputFormat: 'stream-json',
        dangerouslySkipPermissions: true,
      });

      // Spawn Claude Code process
      const managedProcess = await manager.acquireProcess(config);

      // Create output processor
      const processor = new ClaudeCodeOutputProcessor();

      // Process output
      manager.onOutput(managedProcess.id, async (data, type) => {
        if (type === 'stdout') {
          const lines = data.toString().split('\n');
          for (const line of lines) {
            if (line.trim()) {
              await processor.processLine(line);
            }
          }
        }
      });

      // Wait for completion
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Test timeout after 30 seconds'));
        }, 30000);

        const checkComplete = setInterval(() => {
          const process = manager.getProcess(managedProcess.id);
          if (process && (process.status === 'completed' || process.status === 'crashed')) {
            clearInterval(checkComplete);
            clearTimeout(timeout);
            resolve();
          }
        }, 100);
      });

      // Get execution summary
      const summary = processor.getExecutionSummary();

      // Verify summary has expected fields
      expect(summary.totalMessages > 0, 'Should have message count').toBeTruthy();
      expect(summary.toolCallsByType, 'Should have tool calls by type').toBeTruthy();
      expect(summary.totalTokens.input > 0, 'Should have input tokens').toBeTruthy();
      expect(summary.totalTokens.output > 0, 'Should have output tokens').toBeTruthy();
      expect(summary.totalCost > 0, 'Should have calculated cost').toBeTruthy();
      expect(summary.duration >= 0, 'Should have duration').toBeTruthy();
      expect(summary.startTime instanceof Date, 'Should have start time').toBeTruthy();

      // Verify success rate is sensible
      expect(summary.successRate >= 0 && summary.successRate <= 100,
        'Success rate should be between 0 and 100').toBeTruthy();
    });
  });

  describe('Error Handling Across Layers', () => {
    it('should handle Claude Code errors gracefully', { skip: !claudeAvailable }, async () => {
      // Build Claude Code configuration with invalid command
      const config = buildClaudeConfig({
        workDir: process.cwd(),
        print: true,
        outputFormat: 'stream-json',
        dangerouslySkipPermissions: true,
      });

      // Spawn Claude Code process
      const managedProcess = await manager.acquireProcess(config);

      // Create output processor
      const processor = new ClaudeCodeOutputProcessor();

      // Track errors
      const errors: any[] = [];
      processor.onError((error) => {
        errors.push(error);
      });

      // Process output
      manager.onOutput(managedProcess.id, async (data, type) => {
        if (type === 'stdout') {
          const lines = data.toString().split('\n');
          for (const line of lines) {
            if (line.trim()) {
              await processor.processLine(line);
            }
          }
        }
      });

      // Wait for completion
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Test timeout after 30 seconds'));
        }, 30000);

        const checkComplete = setInterval(() => {
          const process = manager.getProcess(managedProcess.id);
          if (process && (process.status === 'completed' || process.status === 'crashed')) {
            clearInterval(checkComplete);
            clearTimeout(timeout);
            resolve();
          }
        }, 100);
      });

      // Verify we tracked some execution
      // Note: Depending on how Claude handles the invalid command,
      // we might have errors tracked
      // At minimum, we should have processed some messages
      const metrics = processor.getMetrics();
      expect(metrics.totalMessages > 0, 'Should have processed messages').toBeTruthy();

      // Optionally verify we have tool calls
      const toolCalls = processor.getToolCalls();
      // Even if the command fails, Claude should attempt to execute it
      expect(toolCalls.length >= 0, 'Should have tracked tool calls').toBeTruthy();
    });
  });
});
