/**
 * Tests for HybridOutputProcessor
 *
 * Verifies that the hybrid processor correctly:
 * - Buffers output by lines
 * - Detects JSON vs non-JSON lines
 * - Parses JSON lines using parent class logic
 * - Handles malformed JSON gracefully
 * - Maintains separate line buffers for incomplete lines
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HybridOutputProcessor } from '../../../../src/execution/output/hybrid-output-processor.js';

describe('HybridOutputProcessor', () => {
  let processor: HybridOutputProcessor;

  beforeEach(() => {
    processor = new HybridOutputProcessor();
  });

  describe('Line Buffering', () => {
    it('should buffer incomplete lines', () => {
      // Send partial line (no newline)
      processor.processOutput(Buffer.from('{"type":"text",'), 'stdout');

      // No metrics yet (line not complete)
      const metrics = processor.getMetrics();
      expect(metrics.totalMessages).toBe(0);

      // Complete the line
      processor.processOutput(Buffer.from('"content":"hello"}\n'), 'stdout');

      // Now the line should be processed
      const updatedMetrics = processor.getMetrics();
      expect(updatedMetrics.totalMessages).toBe(1);
    });

    it('should handle multiple complete lines in one chunk', () => {
      const chunk = Buffer.from(
        '{"type":"text","message":{"content":"line1"}}\n' +
        '{"type":"text","message":{"content":"line2"}}\n' +
        '{"type":"text","message":{"content":"line3"}}\n'
      );

      processor.processOutput(chunk, 'stdout');

      const metrics = processor.getMetrics();
      expect(metrics.totalMessages).toBe(3);
    });

    it('should handle chunks with partial lines at end', () => {
      const chunk1 = Buffer.from(
        '{"type":"text","message":{"content":"complete"}}\n' +
        '{"type":"text",'
      );

      processor.processOutput(chunk1, 'stdout');

      // Only first line processed
      let metrics = processor.getMetrics();
      expect(metrics.totalMessages).toBe(1);

      // Complete second line
      const chunk2 = Buffer.from('"message":{"content":"partial"}}\n');
      processor.processOutput(chunk2, 'stdout');

      // Now both lines processed
      metrics = processor.getMetrics();
      expect(metrics.totalMessages).toBe(2);
    });

    it('should preserve line buffer across multiple chunks', () => {
      // Send JSON in tiny chunks (stress test)
      const json = '{"type":"text","message":{"content":"test"}}';
      const chunks = json.match(/.{1,5}/g) || []; // Split into 5-char chunks

      // Send all chunks except last one (no newline yet)
      for (const chunk of chunks) {
        processor.processOutput(Buffer.from(chunk), 'stdout');
      }

      // No processing yet (line not complete)
      let metrics = processor.getMetrics();
      expect(metrics.totalMessages).toBe(0);

      // Add newline to complete line
      processor.processOutput(Buffer.from('\n'), 'stdout');

      // Now it should be processed
      metrics = processor.getMetrics();
      expect(metrics.totalMessages).toBe(1);
    });
  });

  describe('JSON Detection', () => {
    it('should detect valid JSON lines', () => {
      const json = '{"type":"text","message":{"content":"hello"}}\n';
      processor.processOutput(Buffer.from(json), 'stdout');

      const metrics = processor.getMetrics();
      expect(metrics.totalMessages).toBe(1);
    });

    it('should skip non-JSON lines', () => {
      const output = Buffer.from(
        'Loading project...\n' +
        'Processing files...\n' +
        'Done!\n'
      );

      processor.processOutput(output, 'stdout');

      // No JSON detected, no messages processed
      const metrics = processor.getMetrics();
      expect(metrics.totalMessages).toBe(0);
    });

    it('should detect JSON mixed with non-JSON', () => {
      const output = Buffer.from(
        'Starting process...\n' +
        '{"type":"text","message":{"content":"processing"}}\n' +
        'Progress: 50%\n' +
        '{"type":"result","usage":{"input_tokens":100,"output_tokens":50}}\n' +
        'Finished!\n'
      );

      processor.processOutput(output, 'stdout');

      // Should detect 2 JSON lines
      const metrics = processor.getMetrics();
      expect(metrics.totalMessages).toBe(2);
    });

    it('should not parse lines that look like JSON but are not', () => {
      // Console.warn will be called for parse failures
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const output = Buffer.from(
        '{not valid json}\n' +
        '{also: not valid}\n'
      );

      processor.processOutput(output, 'stdout');

      // Should attempt to parse (looks like JSON) but fail gracefully
      const metrics = processor.getMetrics();
      expect(metrics.totalMessages).toBe(0);
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  describe('JSON Parsing', () => {
    it('should parse tool_use messages', () => {
      const json = '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tool_1","name":"Bash","input":{"command":"ls"}}]}}\n';
      processor.processOutput(Buffer.from(json), 'stdout');

      const toolCalls = processor.getToolCalls();
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].name).toBe('Bash');
      expect(toolCalls[0].input.command).toBe('ls');
      expect(toolCalls[0].status).toBe('pending');
    });

    it('should parse tool_result messages', () => {
      // First send tool_use
      const toolUse = '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tool_1","name":"Read","input":{"file_path":"test.ts"}}]}}\n';
      processor.processOutput(Buffer.from(toolUse), 'stdout');

      // Then send tool_result
      const toolResult = '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tool_1","content":"file contents"}]}}\n';
      processor.processOutput(Buffer.from(toolResult), 'stdout');

      const toolCalls = processor.getToolCalls();
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].status).toBe('success');
      expect(toolCalls[0].result).toBeDefined();
    });

    it('should parse usage messages', () => {
      const json = '{"type":"result","usage":{"input_tokens":1000,"output_tokens":500,"cache_read_input_tokens":200}}\n';
      processor.processOutput(Buffer.from(json), 'stdout');

      const metrics = processor.getMetrics();
      expect(metrics.usage.inputTokens).toBe(1000);
      expect(metrics.usage.outputTokens).toBe(500);
      expect(metrics.usage.cacheTokens).toBe(200);
      expect(metrics.usage.totalTokens).toBe(1500);
    });

    it('should parse text messages', () => {
      const json = '{"type":"assistant","message":{"content":"Hello, how can I help?"}}\n';
      processor.processOutput(Buffer.from(json), 'stdout');

      const metrics = processor.getMetrics();
      expect(metrics.totalMessages).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed JSON gracefully', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Looks like JSON but is invalid
      const badJSON = '{invalid: json, missing: quotes}\n';
      processor.processOutput(Buffer.from(badJSON), 'stdout');

      // Should log warning but not throw
      expect(warnSpy).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[HybridProcessor] Failed to parse JSON line'),
        expect.any(Object)
      );

      // Metrics should show no successful parses
      const metrics = processor.getMetrics();
      expect(metrics.totalMessages).toBe(0);

      warnSpy.mockRestore();
    });

    it('should continue processing after parse errors', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const output = Buffer.from(
        '{"type":"text","message":{"content":"valid"}}\n' +
        '{invalid json}\n' +
        '{"type":"text","message":{"content":"also valid"}}\n'
      );

      processor.processOutput(output, 'stdout');

      // Should process 2 valid lines despite error in middle
      const metrics = processor.getMetrics();
      expect(metrics.totalMessages).toBe(2);

      warnSpy.mockRestore();
    });

    it('should track parse errors in metrics', () => {
      const badJSON = '{"type":"error","message":"Something went wrong"}\n';
      processor.processOutput(Buffer.from(badJSON), 'stdout');

      const metrics = processor.getMetrics();
      // Error messages should still be processed
      expect(metrics.totalMessages).toBe(1);
    });
  });

  describe('Flush Behavior', () => {
    it('should process remaining buffer on flush', () => {
      // Send incomplete JSON line (no newline)
      const json = '{"type":"text","message":{"content":"test"}}';
      processor.processOutput(Buffer.from(json), 'stdout');

      // Not processed yet
      let metrics = processor.getMetrics();
      expect(metrics.totalMessages).toBe(0);

      // Flush should process it
      processor.flush();

      metrics = processor.getMetrics();
      expect(metrics.totalMessages).toBe(1);
    });

    it('should clear buffer after flush', () => {
      // Send incomplete line
      processor.processOutput(Buffer.from('partial'), 'stdout');
      processor.flush();

      // Send new data - should not include old buffer
      const json = '{"type":"text","message":{"content":"new"}}\n';
      processor.processOutput(Buffer.from(json), 'stdout');

      const metrics = processor.getMetrics();
      // Should only have 1 message (the new complete JSON line)
      // "partial" was flushed and cleared
      expect(metrics.totalMessages).toBe(1);
    });

    it('should skip non-JSON data in flush', () => {
      // Send non-JSON partial line
      processor.processOutput(Buffer.from('not json data'), 'stdout');

      processor.flush();

      // Should not process non-JSON
      const metrics = processor.getMetrics();
      expect(metrics.totalMessages).toBe(0);
    });
  });

  describe('Event Callbacks', () => {
    it('should emit tool call events', () => {
      const toolCallHandler = vi.fn();
      processor.onToolCall(toolCallHandler);

      const json = '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tool_1","name":"Bash","input":{"command":"ls"}}]}}\n';
      processor.processOutput(Buffer.from(json), 'stdout');

      expect(toolCallHandler).toHaveBeenCalledOnce();
      expect(toolCallHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Bash',
          input: { command: 'ls' },
          status: 'pending',
        })
      );
    });

    it('should emit progress events', () => {
      const progressHandler = vi.fn();
      processor.onProgress(progressHandler);

      const json = '{"type":"text","message":{"content":"test"}}\n';
      processor.processOutput(Buffer.from(json), 'stdout');

      expect(progressHandler).toHaveBeenCalled();
      expect(progressHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          totalMessages: 1,
        })
      );
    });

    it('should emit usage events', () => {
      const usageHandler = vi.fn();
      processor.onUsage(usageHandler);

      const json = '{"type":"result","usage":{"input_tokens":100,"output_tokens":50}}\n';
      processor.processOutput(Buffer.from(json), 'stdout');

      expect(usageHandler).toHaveBeenCalled();
      expect(usageHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          inputTokens: 100,
          outputTokens: 50,
        })
      );
    });
  });

  describe('Integration with Parent Class', () => {
    it('should use parent class metrics tracking', () => {
      const json = '{"type":"text","message":{"content":"test"}}\n';
      processor.processOutput(Buffer.from(json), 'stdout');

      const metrics = processor.getMetrics();

      // Parent class should track basic metrics
      expect(metrics.totalMessages).toBeGreaterThan(0);
      expect(metrics.startedAt).toBeInstanceOf(Date);
      expect(metrics.lastUpdate).toBeInstanceOf(Date);
      expect(metrics.errors).toBeInstanceOf(Array);
    });

    it('should use parent class tool call tracking', () => {
      const toolUse = '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tool_1","name":"Read","input":{"file_path":"test.ts"}}]}}\n';
      const toolResult = '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tool_1","content":"contents"}]}}\n';

      processor.processOutput(Buffer.from(toolUse), 'stdout');
      processor.processOutput(Buffer.from(toolResult), 'stdout');

      // Parent class tracks tool calls
      const toolCalls = processor.getToolCalls();
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].id).toBe('tool_1');
      expect(toolCalls[0].status).toBe('success');
    });

    it('should use parent class file change detection', () => {
      // Send Read tool call
      const toolUse = '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tool_1","name":"Read","input":{"file_path":"test.ts"}}]}}\n';
      const toolResult = '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tool_1","content":"file contents"}]}}\n';

      processor.processOutput(Buffer.from(toolUse), 'stdout');
      processor.processOutput(Buffer.from(toolResult), 'stdout');

      // Parent class detects file changes
      const fileChanges = processor.getFileChanges();
      expect(fileChanges).toHaveLength(1);
      expect(fileChanges[0].path).toBe('test.ts');
      expect(fileChanges[0].operation).toBe('read');
    });
  });

  describe('Real-World Scenarios', () => {
    it('should handle realistic Claude Code output stream', () => {
      // Simulates real Claude Code stream-json output mixed with terminal output
      const output = Buffer.from(
        'Thinking...\n' +
        '{"type":"assistant","message":{"content":"I will help you with that task."}}\n' +
        'Analyzing codebase...\n' +
        '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"read_1","name":"Read","input":{"file_path":"src/index.ts"}}]}}\n' +
        'Reading file...\n' +
        '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"read_1","content":"export const foo = \\"bar\\""}]}}\n' +
        '{"type":"result","usage":{"input_tokens":1000,"output_tokens":200}}\n' +
        'Task complete!\n'
      );

      processor.processOutput(output, 'stdout');

      const metrics = processor.getMetrics();

      // Should parse 4 JSON lines (1 text, 1 tool_use, 1 tool_result, 1 usage)
      expect(metrics.totalMessages).toBe(4);

      // Should track tool call
      const toolCalls = processor.getToolCalls();
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].name).toBe('Read');
      expect(toolCalls[0].status).toBe('success');

      // Should track file change
      const fileChanges = processor.getFileChanges();
      expect(fileChanges).toHaveLength(1);
      expect(fileChanges[0].path).toBe('src/index.ts');

      // Should track usage
      expect(metrics.usage.inputTokens).toBe(1000);
      expect(metrics.usage.outputTokens).toBe(200);
    });

    it('should handle large output streams efficiently', () => {
      // Generate 1000 JSON lines mixed with terminal output
      const lines: string[] = [];
      for (let i = 0; i < 1000; i++) {
        if (i % 2 === 0) {
          // JSON line
          lines.push(`{"type":"text","message":{"content":"message ${i}"}}`);
        } else {
          // Terminal output
          lines.push(`Progress: ${i}/1000`);
        }
      }

      const output = Buffer.from(lines.join('\n') + '\n');
      processor.processOutput(output, 'stdout');

      const metrics = processor.getMetrics();
      expect(metrics.totalMessages).toBe(500); // 500 JSON lines
    });
  });
});
