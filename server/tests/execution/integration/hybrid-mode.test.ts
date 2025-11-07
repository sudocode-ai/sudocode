/**
 * Integration tests for hybrid mode execution
 *
 * Tests the complete flow of hybrid mode with mocked Claude CLI:
 * - PTY process spawning
 * - Hybrid output processing
 * - Terminal data forwarding
 * - Structured JSON parsing
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PtyProcessManager } from '../../../src/execution/process/pty-manager.js';
import { HybridOutputProcessor } from '../../../src/execution/output/hybrid-output-processor.js';
import { buildClaudeConfig } from '../../../src/execution/process/builders/claude.js';
import type { ProcessConfig } from '../../../src/execution/process/types.js';

const CWD = process.cwd();

describe('Hybrid Mode Integration', () => {
  let manager: PtyProcessManager;

  beforeEach(() => {
    manager = new PtyProcessManager();
  });

  afterEach(async () => {
    await manager.shutdown();
  });

  describe('Claude Config Builder', () => {
    it('should configure hybrid mode correctly', () => {
      const config = buildClaudeConfig({
        workDir: CWD,
        mode: 'hybrid',
        terminal: {
          cols: 80,
          rows: 24,
        },
      });

      expect(config.mode).toBe('hybrid');
      expect(config.args).toContain('--output-format');
      expect(config.args).toContain('stream-json');
      expect(config.args).not.toContain('--print');
      expect(config.terminal).toBeDefined();
    });

    it('should configure interactive mode correctly', () => {
      const config = buildClaudeConfig({
        workDir: CWD,
        mode: 'interactive',
        terminal: {
          cols: 80,
          rows: 24,
        },
      });

      expect(config.mode).toBe('interactive');
      expect(config.args).not.toContain('--print');
      expect(config.args).not.toContain('--output-format');
    });

    it('should configure structured mode correctly', () => {
      const config = buildClaudeConfig({
        workDir: CWD,
        mode: 'structured',
      });

      expect(config.mode).toBe('structured');
      expect(config.args).toContain('--print');
      expect(config.args).toContain('--output-format');
      expect(config.args).toContain('stream-json');
    });
  });

  describe('Hybrid Mode Execution', () => {
    it('should spawn process and parse hybrid output', async () => {
      // Mock a simple CLI that outputs both plain text and JSON
      const config: ProcessConfig = {
        executablePath: 'node',
        args: [
          '-e',
          `
          // Simulate Claude CLI hybrid output
          console.log('\\x1b[1;32m[Claude starting...]\\x1b[0m');

          // Output a JSON tool_use message
          const toolUse = {
            type: 'assistant',
            message: {
              content: [{
                type: 'tool_use',
                id: 'toolu_mock',
                name: 'Bash',
                input: { command: 'echo "hello"' }
              }]
            }
          };
          console.log(JSON.stringify(toolUse));

          // More terminal output
          console.log('Tool executed successfully');

          // Output a tool_result message
          const toolResult = {
            type: 'user',
            message: {
              content: [{
                type: 'tool_result',
                tool_use_id: 'toolu_mock',
                content: 'hello',
                is_error: false
              }]
            }
          };
          console.log(JSON.stringify(toolResult));

          // Final text
          console.log('\\x1b[1;32m[Complete]\\x1b[0m');
          `,
        ],
        workDir: CWD,
        mode: 'hybrid',
        terminal: {
          cols: 80,
          rows: 24,
        },
      };

      const ptyProcess = await manager.acquireProcess(config);
      const processor = new HybridOutputProcessor();

      // Collect data
      const terminalOutput: string[] = [];
      const toolCalls: any[] = [];

      processor.onTerminalData((data) => {
        terminalOutput.push(data);
      });

      processor.onToolCall((toolCall) => {
        toolCalls.push(toolCall);
      });

      // Process PTY output through hybrid processor
      ptyProcess.onData(async (data) => {
        await processor.processTerminalData(data);
      });

      // Wait for process to complete
      await new Promise<void>((resolve) => {
        ptyProcess.onExit(() => {
          resolve();
        });
      });

      // Flush any remaining buffered data
      await processor.flush();

      // Verify terminal output captured everything
      const fullOutput = terminalOutput.join('');
      expect(fullOutput).toContain('[Claude starting...]');
      expect(fullOutput).toContain('Tool executed successfully');
      expect(fullOutput).toContain('[Complete]');

      // Verify JSON parsing extracted tool calls
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]).toMatchObject({
        id: 'toolu_mock',
        name: 'Bash',
        // Status is 'success' because tool_result was also processed
        status: 'success',
      });
      expect(toolCalls[0].input).toMatchObject({
        command: 'echo "hello"',
      });

      // Verify metrics
      const metrics = processor.getMetrics();
      expect(metrics.totalMessages).toBeGreaterThan(0);
      expect(metrics.toolCalls.length).toBe(1);
    });

    it('should handle rapid JSON messages', async () => {
      // Mock CLI that outputs JSON rapidly
      const config: ProcessConfig = {
        executablePath: 'node',
        args: [
          '-e',
          `
          // Output 10 JSON messages rapidly
          for (let i = 0; i < 10; i++) {
            const msg = {
              type: 'assistant',
              message: {
                content: [{
                  type: 'tool_use',
                  id: 'toolu_' + i,
                  name: 'Read',
                  input: { file_path: '/test' + i + '.ts' }
                }]
              }
            };
            console.log(JSON.stringify(msg));
          }
          `,
        ],
        workDir: CWD,
        mode: 'hybrid',
        terminal: {
          cols: 80,
          rows: 24,
        },
      };

      const ptyProcess = await manager.acquireProcess(config);
      const processor = new HybridOutputProcessor();

      const toolCalls: any[] = [];
      processor.onToolCall((toolCall) => {
        toolCalls.push(toolCall);
      });

      ptyProcess.onData(async (data) => {
        await processor.processTerminalData(data);
      });

      await new Promise<void>((resolve) => {
        ptyProcess.onExit(() => {
          resolve();
        });
      });

      await processor.flush();

      // All 10 messages should be parsed
      expect(toolCalls).toHaveLength(10);
      expect(toolCalls[0].id).toBe('toolu_0');
      expect(toolCalls[9].id).toBe('toolu_9');
    });

    it('should handle interleaved text and JSON', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: [
          '-e',
          `
          console.log('Line 1');
          console.log(JSON.stringify({
            type: 'assistant',
            message: {
              content: [{
                type: 'tool_use',
                id: 'toolu_1',
                name: 'Bash',
                input: {}
              }]
            }
          }));
          console.log('Line 2');
          console.log(JSON.stringify({
            type: 'assistant',
            message: {
              content: [{
                type: 'tool_use',
                id: 'toolu_2',
                name: 'Read',
                input: {}
              }]
            }
          }));
          console.log('Line 3');
          `,
        ],
        workDir: CWD,
        mode: 'hybrid',
        terminal: {
          cols: 80,
          rows: 24,
        },
      };

      const ptyProcess = await manager.acquireProcess(config);
      const processor = new HybridOutputProcessor();

      const terminalLines: string[] = [];
      const toolCalls: any[] = [];

      processor.onTerminalData((data) => {
        terminalLines.push(...data.split('\n').filter((l) => l.trim()));
      });

      processor.onToolCall((toolCall) => {
        toolCalls.push(toolCall);
      });

      ptyProcess.onData(async (data) => {
        await processor.processTerminalData(data);
      });

      await new Promise<void>((resolve) => {
        ptyProcess.onExit(() => {
          resolve();
        });
      });

      await processor.flush();

      // Terminal got everything
      const fullText = terminalLines.join('\n');
      expect(fullText).toContain('Line 1');
      expect(fullText).toContain('Line 2');
      expect(fullText).toContain('Line 3');

      // JSON was parsed
      expect(toolCalls).toHaveLength(2);
      expect(toolCalls[0].name).toBe('Bash');
      expect(toolCalls[1].name).toBe('Read');
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed JSON gracefully', async () => {
      const config: ProcessConfig = {
        executablePath: 'node',
        args: [
          '-e',
          `
          console.log('Valid text');
          console.log('{invalid json');
          console.log('More text');
          `,
        ],
        workDir: CWD,
        mode: 'hybrid',
        terminal: {
          cols: 80,
          rows: 24,
        },
      };

      const ptyProcess = await manager.acquireProcess(config);
      const processor = new HybridOutputProcessor();

      const terminalOutput: string[] = [];
      processor.onTerminalData((data) => {
        terminalOutput.push(data);
      });

      ptyProcess.onData(async (data) => {
        await processor.processTerminalData(data);
      });

      await new Promise<void>((resolve) => {
        ptyProcess.onExit(() => {
          resolve();
        });
      });

      // Should not crash, terminal output should be preserved
      const fullOutput = terminalOutput.join('');
      expect(fullOutput).toContain('Valid text');
      expect(fullOutput).toContain('More text');
    });
  });

  describe('Process Management', () => {
    it('should report metrics correctly', async () => {
      const config: ProcessConfig = {
        executablePath: 'echo',
        args: ['test'],
        workDir: CWD,
        mode: 'hybrid',
        terminal: {
          cols: 80,
          rows: 24,
        },
      };

      const ptyProcess = await manager.acquireProcess(config);

      await new Promise<void>((resolve) => {
        ptyProcess.onExit(() => {
          resolve();
        });
      });

      const metrics = manager.getMetrics();
      expect(metrics.totalSpawned).toBe(1);
      expect(metrics.totalCompleted).toBe(1);
      expect(metrics.totalFailed).toBe(0);
    });
  });
});
