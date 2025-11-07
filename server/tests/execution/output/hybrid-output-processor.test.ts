/**
 * Tests for HybridOutputProcessor
 *
 * Verifies that JSON messages are correctly extracted from terminal streams
 * while forwarding all data to terminal handlers.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HybridOutputProcessor } from '../../../src/execution/output/hybrid-output-processor.js';

describe('HybridOutputProcessor', () => {
  let processor: HybridOutputProcessor;

  beforeEach(() => {
    processor = new HybridOutputProcessor();
  });

  describe('Terminal data forwarding', () => {
    it('should forward all terminal data to handlers', async () => {
      const terminalData: string[] = [];
      processor.onTerminalData((data) => {
        terminalData.push(data);
      });

      await processor.processTerminalData('Hello from terminal\r\n');
      await processor.processTerminalData('More data\r\n');

      expect(terminalData).toEqual([
        'Hello from terminal\r\n',
        'More data\r\n',
      ]);
    });

    it('should forward data even if it contains JSON', async () => {
      const terminalData: string[] = [];
      processor.onTerminalData((data) => {
        terminalData.push(data);
      });

      const jsonLine = '{"type":"result","usage":{"input_tokens":100}}\r\n';
      await processor.processTerminalData(jsonLine);

      expect(terminalData).toEqual([jsonLine]);
    });
  });

  describe('JSON extraction', () => {
    it('should extract JSON messages from terminal stream', async () => {
      const toolCalls: any[] = [];
      processor.onToolCall((toolCall) => {
        toolCalls.push(toolCall);
      });

      // Simulate Claude Code output with JSON message
      const jsonMessage = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'toolu_123',
              name: 'Read',
              input: { file_path: '/test.ts' },
            },
          ],
        },
      });

      await processor.processTerminalData(jsonMessage + '\n');

      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]).toMatchObject({
        id: 'toolu_123',
        name: 'Read',
        status: 'pending',
      });
    });

    it('should handle mixed terminal output and JSON', async () => {
      const terminalData: string[] = [];
      const toolCalls: any[] = [];

      processor.onTerminalData((data) => {
        terminalData.push(data);
      });
      processor.onToolCall((toolCall) => {
        toolCalls.push(toolCall);
      });

      // Mixed output: plain text, JSON, ANSI codes
      await processor.processTerminalData('Starting...\r\n');
      await processor.processTerminalData(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'toolu_456',
                name: 'Bash',
                input: { command: 'ls' },
              },
            ],
          },
        }) + '\n'
      );
      await processor.processTerminalData('\x1b[32mSuccess!\x1b[0m\r\n');

      // All data forwarded to terminal
      expect(terminalData).toHaveLength(3);

      // JSON extracted and parsed
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].name).toBe('Bash');
    });

    it('should skip non-JSON lines silently', async () => {
      const messages: any[] = [];
      processor.onMessage((msg) => {
        messages.push(msg);
      });

      await processor.processTerminalData('Plain text line\n');
      await processor.processTerminalData('Another line\n');
      await processor.processTerminalData('[some output]\n');

      // No messages parsed (non-JSON ignored)
      expect(messages).toHaveLength(0);
    });
  });

  describe('Line buffering', () => {
    it('should buffer incomplete lines', async () => {
      const toolCalls: any[] = [];
      processor.onToolCall((toolCall) => {
        toolCalls.push(toolCall);
      });

      const jsonMessage = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'toolu_789',
              name: 'Write',
              input: { file_path: '/test.ts' },
            },
          ],
        },
      });

      // Send in chunks
      const part1 = jsonMessage.slice(0, 50);
      const part2 = jsonMessage.slice(50) + '\n';

      await processor.processTerminalData(part1);
      expect(toolCalls).toHaveLength(0); // Not complete yet

      await processor.processTerminalData(part2);
      expect(toolCalls).toHaveLength(1); // Now parsed
    });

    it('should handle multiple lines in single chunk', async () => {
      const toolCalls: any[] = [];
      processor.onToolCall((toolCall) => {
        toolCalls.push(toolCall);
      });

      const json1 = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'Read',
              input: {},
            },
          ],
        },
      });

      const json2 = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'toolu_2',
              name: 'Write',
              input: {},
            },
          ],
        },
      });

      // Send multiple lines at once
      await processor.processTerminalData(`${json1}\n${json2}\n`);

      expect(toolCalls).toHaveLength(2);
      expect(toolCalls[0].id).toBe('toolu_1');
      expect(toolCalls[1].id).toBe('toolu_2');
    });
  });

  describe('Flush', () => {
    it('should process buffered data on flush', async () => {
      const toolCalls: any[] = [];
      processor.onToolCall((toolCall) => {
        toolCalls.push(toolCall);
      });

      const jsonMessage = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'toolu_final',
              name: 'Bash',
              input: {},
            },
          ],
        },
      });

      // Send without newline
      await processor.processTerminalData(jsonMessage);
      expect(toolCalls).toHaveLength(0); // Not complete

      // Flush should process it
      await processor.flush();
      expect(toolCalls).toHaveLength(1);
    });
  });

  describe('Event handlers', () => {
    it('should emit progress events', async () => {
      const progressUpdates: any[] = [];
      processor.onProgress((metrics) => {
        progressUpdates.push(metrics);
      });

      const json = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'toolu_progress',
              name: 'Read',
              input: {},
            },
          ],
        },
      });

      await processor.processTerminalData(json + '\n');

      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates[0].totalMessages).toBeGreaterThan(0);
    });

    it('should emit usage events', async () => {
      const usageUpdates: any[] = [];
      processor.onUsage((usage) => {
        usageUpdates.push(usage);
      });

      const json = JSON.stringify({
        type: 'result',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 0,
        },
      });

      await processor.processTerminalData(json + '\n');

      expect(usageUpdates).toHaveLength(1);
      expect(usageUpdates[0].inputTokens).toBe(100);
      expect(usageUpdates[0].outputTokens).toBe(50);
    });
  });

  describe('Query methods', () => {
    it('should delegate to internal JSON processor', async () => {
      const json = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'toolu_query',
              name: 'Bash',
              input: { command: 'echo test' },
            },
          ],
        },
      });

      await processor.processTerminalData(json + '\n');

      const toolCalls = processor.getToolCalls();
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].name).toBe('Bash');

      const bashCalls = processor.getToolCallsByName('Bash');
      expect(bashCalls).toHaveLength(1);

      const metrics = processor.getMetrics();
      expect(metrics.totalMessages).toBeGreaterThan(0);
    });
  });
});
