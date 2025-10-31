/**
 * Unit tests for ClaudeCodeOutputProcessor
 *
 * Tests the core functionality of parsing Claude Code's stream-json output,
 * tracking tool calls, detecting file changes, and aggregating metrics.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ClaudeCodeOutputProcessor } from '../../../../src/execution/output/claude-code-output-processor.js';
import type {
  ToolCall,
  FileChange,
  ProcessingMetrics,
} from '../../../../src/execution/output/types.js';

describe('ClaudeCodeOutputProcessor', () => {
  describe('Initialization', () => {
    it('should initialize with empty metrics', () => {
      const processor = new ClaudeCodeOutputProcessor();
      const metrics = processor.getMetrics();

      assert.strictEqual(metrics.totalMessages, 0);
      assert.deepStrictEqual(metrics.toolCalls, []);
      assert.deepStrictEqual(metrics.fileChanges, []);
      assert.deepStrictEqual(metrics.errors, []);
      assert.strictEqual(metrics.usage.inputTokens, 0);
      assert.strictEqual(metrics.usage.outputTokens, 0);
      assert.strictEqual(metrics.usage.cacheTokens, 0);
      assert.strictEqual(metrics.usage.totalTokens, 0);
      assert.strictEqual(metrics.usage.cost, 0);
      assert.strictEqual(metrics.usage.provider, 'anthropic');
    });

    it('should initialize with empty tool calls', () => {
      const processor = new ClaudeCodeOutputProcessor();
      assert.deepStrictEqual(processor.getToolCalls(), []);
    });

    it('should initialize with empty file changes', () => {
      const processor = new ClaudeCodeOutputProcessor();
      assert.deepStrictEqual(processor.getFileChanges(), []);
    });
  });

  describe('Line Parsing', () => {
    it('should skip empty lines', async () => {
      const processor = new ClaudeCodeOutputProcessor();
      await processor.processLine('');
      await processor.processLine('   ');
      await processor.processLine('\n');

      const metrics = processor.getMetrics();
      assert.strictEqual(metrics.totalMessages, 0);
    });

    it('should handle malformed JSON gracefully', async () => {
      const processor = new ClaudeCodeOutputProcessor();
      let errorCalls = 0;
      const errorHandler = () => {
        errorCalls++;
      };
      processor.onError(errorHandler);

      await processor.processLine('not valid json');

      const metrics = processor.getMetrics();
      assert.strictEqual(metrics.errors.length, 1);
      assert.ok(metrics.errors[0].message.includes('Failed to parse'));
      assert.strictEqual(errorCalls, 1);
    });

    it('should parse valid JSON and increment message count', async () => {
      const processor = new ClaudeCodeOutputProcessor();
      await processor.processLine('{"type":"assistant","message":{"content":"Hello"}}');

      const metrics = processor.getMetrics();
      assert.strictEqual(metrics.totalMessages, 1);
    });

    it('should track line numbers for error reporting', async () => {
      const processor = new ClaudeCodeOutputProcessor();
      const errorCalls: any[] = [];
      processor.onError((error) => {
        errorCalls.push(error);
      });

      await processor.processLine('{}');
      await processor.processLine('invalid json');

      assert.strictEqual(errorCalls.length, 1);
      assert.ok(errorCalls[0].message.includes('line 2'));
    });
  });

  describe('Message Type Detection', () => {
    it('should detect text messages', async () => {
      const processor = new ClaudeCodeOutputProcessor();
      const json = JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Hello, world!' }],
        },
      });

      await processor.processLine(json);

      const metrics = processor.getMetrics();
      assert.strictEqual(metrics.totalMessages, 1);
    });

    it('should detect tool_use messages', async () => {
      const processor = new ClaudeCodeOutputProcessor();
      const toolCallArgs: any[] = [];
      processor.onToolCall((arg) => {
        toolCallArgs.push(arg);
      });

      const json = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tool-123',
              name: 'Read',
              input: { file_path: 'test.ts' },
            },
          ],
        },
      });

      await processor.processLine(json);

      assert.strictEqual(toolCallArgs.length, 1);
      const toolCall = toolCallArgs[0] as ToolCall;
      assert.strictEqual(toolCall.id, 'tool-123');
      assert.strictEqual(toolCall.name, 'Read');
      assert.strictEqual(toolCall.status, 'pending');
    });

    it('should detect usage messages', async () => {
      const processor = new ClaudeCodeOutputProcessor();
      const json = JSON.stringify({
        type: 'result',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 10,
        },
      });

      await processor.processLine(json);

      const metrics = processor.getMetrics();
      assert.strictEqual(metrics.usage.inputTokens, 100);
      assert.strictEqual(metrics.usage.outputTokens, 50);
      assert.strictEqual(metrics.usage.cacheTokens, 10);
    });

    it('should detect error messages', async () => {
      const processor = new ClaudeCodeOutputProcessor();
      const errorCalls: any[] = [];
      processor.onError((error) => {
        errorCalls.push(error);
      });

      const json = JSON.stringify({
        type: 'error',
        error: {
          message: 'Something went wrong',
        },
      });

      await processor.processLine(json);

      assert.strictEqual(errorCalls.length, 1);
      assert.strictEqual(errorCalls[0].message, 'Something went wrong');
    });
  });

  describe('Tool Call Tracking', () => {
    it('should track tool_use with pending status', async () => {
      const processor = new ClaudeCodeOutputProcessor();
      const json = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tool-456',
              name: 'Bash',
              input: { command: 'ls -la' },
            },
          ],
        },
      });

      await processor.processLine(json);

      const toolCalls = processor.getToolCalls();
      assert.strictEqual(toolCalls.length, 1);
      assert.strictEqual(toolCalls[0].id, 'tool-456');
      assert.strictEqual(toolCalls[0].name, 'Bash');
      assert.strictEqual(toolCalls[0].status, 'pending');
      assert.deepStrictEqual(toolCalls[0].input, { command: 'ls -la' });
    });

    it('should update tool call status on tool_result', async () => {
      const processor = new ClaudeCodeOutputProcessor();

      // First, process tool_use
      const toolUseJson = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tool-789',
              name: 'Read',
              input: { file_path: 'test.ts' },
            },
          ],
        },
      });
      await processor.processLine(toolUseJson);

      // Then, process tool_result
      const toolResultJson = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-789',
              content: 'file contents here',
              is_error: false,
            },
          ],
        },
      });
      await processor.processLine(toolResultJson);

      const toolCalls = processor.getToolCalls();
      assert.strictEqual(toolCalls.length, 1);
      assert.strictEqual(toolCalls[0].status, 'success');
      assert.strictEqual(toolCalls[0].result, 'file contents here');
      assert.ok(toolCalls[0].completedAt !== undefined);
    });

    it('should mark tool call as error on error result', async () => {
      const processor = new ClaudeCodeOutputProcessor();

      // Process tool_use
      const toolUseJson = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tool-error',
              name: 'Bash',
              input: { command: 'invalid-command' },
            },
          ],
        },
      });
      await processor.processLine(toolUseJson);

      // Process error result
      const toolResultJson = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-error',
              content: 'Command not found',
              is_error: true,
            },
          ],
        },
      });
      await processor.processLine(toolResultJson);

      const toolCalls = processor.getToolCalls();
      assert.strictEqual(toolCalls[0].status, 'error');
      assert.strictEqual(toolCalls[0].error, 'Command not found');
    });

    it('should handle tool_result without matching tool_use gracefully', async () => {
      const processor = new ClaudeCodeOutputProcessor();
      const toolResultJson = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'nonexistent-tool',
              content: 'result',
              is_error: false,
            },
          ],
        },
      });

      // Should not throw
      await processor.processLine(toolResultJson);

      const toolCalls = processor.getToolCalls();
      assert.strictEqual(toolCalls.length, 0);
    });
  });

  describe('File Change Detection', () => {
    it('should detect file read from Read tool', async () => {
      const processor = new ClaudeCodeOutputProcessor();
      const fileChangeCalls: any[] = [];
      processor.onFileChange((change) => {
        fileChangeCalls.push(change);
      });

      // Tool use
      await processor.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'read-1',
                name: 'Read',
                input: { file_path: '/path/to/file.ts' },
              },
            ],
          },
        })
      );

      // Tool result
      await processor.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'read-1',
                content: 'file contents',
                is_error: false,
              },
            ],
          },
        })
      );

      assert.strictEqual(fileChangeCalls.length, 1);
      const fileChange = fileChangeCalls[0] as FileChange;
      assert.strictEqual(fileChange.path, '/path/to/file.ts');
      assert.strictEqual(fileChange.operation, 'read');
      assert.strictEqual(fileChange.toolCallId, 'read-1');
    });

    it('should detect file write from Write tool', async () => {
      const processor = new ClaudeCodeOutputProcessor();
      const fileChangeCalls: any[] = [];
      processor.onFileChange((change) => {
        fileChangeCalls.push(change);
      });

      await processor.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'write-1',
                name: 'Write',
                input: { file_path: '/path/to/new.ts', content: 'code' },
              },
            ],
          },
        })
      );

      await processor.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'write-1',
                content: 'File written successfully',
                is_error: false,
              },
            ],
          },
        })
      );

      assert.strictEqual(fileChangeCalls.length, 1);
      const fileChange = fileChangeCalls[0] as FileChange;
      assert.strictEqual(fileChange.path, '/path/to/new.ts');
      assert.strictEqual(fileChange.operation, 'write');
    });

    it('should detect file edit from Edit tool', async () => {
      const processor = new ClaudeCodeOutputProcessor();
      const fileChangeCalls: any[] = [];
      processor.onFileChange((change) => {
        fileChangeCalls.push(change);
      });

      await processor.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'edit-1',
                name: 'Edit',
                input: {
                  file_path: '/path/to/edit.ts',
                  old_string: 'old',
                  new_string: 'new',
                },
              },
            ],
          },
        })
      );

      await processor.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'edit-1',
                content: 'Edit successful',
                is_error: false,
              },
            ],
          },
        })
      );

      assert.strictEqual(fileChangeCalls.length, 1);
      const fileChange = fileChangeCalls[0] as FileChange;
      assert.strictEqual(fileChange.path, '/path/to/edit.ts');
      assert.strictEqual(fileChange.operation, 'edit');
    });

    it('should not detect file changes for non-file-operation tools', async () => {
      const processor = new ClaudeCodeOutputProcessor();
      let fileChangeCallCount = 0;
      processor.onFileChange(() => {
        fileChangeCallCount++;
      });

      await processor.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'bash-1',
                name: 'Bash',
                input: { command: 'echo hello' },
              },
            ],
          },
        })
      );

      await processor.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'bash-1',
                content: 'hello',
                is_error: false,
              },
            ],
          },
        })
      );

      assert.strictEqual(fileChangeCallCount, 0);
    });

    it('should track file changes in metrics', async () => {
      const processor = new ClaudeCodeOutputProcessor();
      await processor.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'read-2',
                name: 'Read',
                input: { file_path: 'test.ts' },
              },
            ],
          },
        })
      );

      await processor.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'read-2',
                content: 'contents',
                is_error: false,
              },
            ],
          },
        })
      );

      const fileChanges = processor.getFileChanges();
      assert.strictEqual(fileChanges.length, 1);
      assert.strictEqual(fileChanges[0].path, 'test.ts');
    });
  });

  describe('Usage Metrics', () => {
    it('should aggregate token usage', async () => {
      const processor = new ClaudeCodeOutputProcessor();
      await processor.processLine(
        JSON.stringify({
          type: 'result',
          usage: {
            input_tokens: 100,
            output_tokens: 200,
            cache_read_input_tokens: 50,
          },
        })
      );

      await processor.processLine(
        JSON.stringify({
          type: 'result',
          usage: {
            input_tokens: 150,
            output_tokens: 100,
            cache_creation_input_tokens: 25,
          },
        })
      );

      const metrics = processor.getMetrics();
      assert.strictEqual(metrics.usage.inputTokens, 250);
      assert.strictEqual(metrics.usage.outputTokens, 300);
      assert.strictEqual(metrics.usage.cacheTokens, 75);
      assert.strictEqual(metrics.usage.totalTokens, 550);
    });

    it('should calculate cost correctly', async () => {
      const processor = new ClaudeCodeOutputProcessor();
      await processor.processLine(
        JSON.stringify({
          type: 'result',
          usage: {
            input_tokens: 1_000_000, // 1M tokens
            output_tokens: 1_000_000, // 1M tokens
            cache_read_input_tokens: 1_000_000, // 1M tokens
          },
        })
      );

      const metrics = processor.getMetrics();
      // Input: $3/M, Output: $15/M, Cache: $0.30/M
      // Cost = (1M * 3) + (1M * 15) + (1M * 0.30) = $18.30
      const expectedCost = 18.3;
      assert.ok(metrics.usage.cost !== undefined);
      assert.ok(Math.abs(metrics.usage.cost - expectedCost) < 0.01);
    });
  });

  describe('Event Handlers', () => {
    it('should emit onToolCall when tool is invoked', async () => {
      const processor = new ClaudeCodeOutputProcessor();
      let callCount = 0;
      processor.onToolCall(() => {
        callCount++;
      });

      await processor.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'tool-event',
                name: 'Test',
                input: {},
              },
            ],
          },
        })
      );

      assert.strictEqual(callCount, 1);
    });

    it('should emit onFileChange when file is modified', async () => {
      const processor = new ClaudeCodeOutputProcessor();
      let callCount = 0;
      processor.onFileChange(() => {
        callCount++;
      });

      await processor.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'write-event',
                name: 'Write',
                input: { file_path: 'test.ts', content: 'code' },
              },
            ],
          },
        })
      );

      await processor.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'write-event',
                content: 'success',
                is_error: false,
              },
            ],
          },
        })
      );

      assert.strictEqual(callCount, 1);
    });

    it('should emit onProgress periodically', async () => {
      const processor = new ClaudeCodeOutputProcessor();
      const progressCalls: any[] = [];
      processor.onProgress((metrics) => {
        progressCalls.push(metrics);
      });

      await processor.processLine('{"type":"assistant","message":{"content":"test"}}');

      assert.ok(progressCalls.length > 0);
      const metrics = progressCalls[0] as ProcessingMetrics;
      assert.strictEqual(metrics.totalMessages, 1);
    });

    it('should emit onError for errors', async () => {
      const processor = new ClaudeCodeOutputProcessor();
      let callCount = 0;
      processor.onError(() => {
        callCount++;
      });

      await processor.processLine(
        JSON.stringify({
          type: 'error',
          error: { message: 'Test error' },
        })
      );

      assert.strictEqual(callCount, 1);
    });

    it('should support multiple event handlers', async () => {
      const processor = new ClaudeCodeOutputProcessor();
      let handler1CallCount = 0;
      let handler2CallCount = 0;

      processor.onToolCall(() => {
        handler1CallCount++;
      });
      processor.onToolCall(() => {
        handler2CallCount++;
      });

      await processor.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'multi-handler',
                name: 'Test',
                input: {},
              },
            ],
          },
        })
      );

      assert.strictEqual(handler1CallCount, 1);
      assert.strictEqual(handler2CallCount, 1);
    });

    it('should handle errors in event handlers gracefully', async () => {
      const processor = new ClaudeCodeOutputProcessor();
      let normalHandlerCalled = false;

      processor.onToolCall(() => {
        throw new Error('Handler error');
      });
      processor.onToolCall(() => {
        normalHandlerCalled = true;
      });

      // Should not throw despite handler error
      await processor.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'error-handler',
                name: 'Test',
                input: {},
              },
            ],
          },
        })
      );

      // Normal handler should still be called
      assert.ok(normalHandlerCalled);
    });
  });

  describe('Metrics Consistency', () => {
    it('should return defensive copies of metrics arrays', () => {
      const processor = new ClaudeCodeOutputProcessor();
      const metrics1 = processor.getMetrics();
      metrics1.toolCalls.push({
        id: 'fake',
        name: 'fake',
        input: {},
        status: 'pending',
        timestamp: new Date(),
      });

      const metrics2 = processor.getMetrics();
      assert.strictEqual(metrics2.toolCalls.length, 0);
    });

    it('should keep tool calls in both Map and metrics array in sync', async () => {
      const processor = new ClaudeCodeOutputProcessor();
      await processor.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'sync-test',
                name: 'Test',
                input: {},
              },
            ],
          },
        })
      );

      const toolCallsFromMap = processor.getToolCalls();
      const toolCallsFromMetrics = processor.getMetrics().toolCalls;

      assert.strictEqual(toolCallsFromMap.length, 1);
      assert.strictEqual(toolCallsFromMetrics.length, 1);
      assert.strictEqual(toolCallsFromMap[0].id, toolCallsFromMetrics[0].id);
    });
  });

  describe('Query Methods', () => {
    it('should filter tool calls by name', async () => {
      const processor = new ClaudeCodeOutputProcessor();

      // Add multiple tool calls with different names
      await processor.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', id: 'bash-1', name: 'Bash', input: { command: 'ls' } },
            ],
          },
        })
      );

      await processor.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'test.ts' } },
            ],
          },
        })
      );

      await processor.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', id: 'bash-2', name: 'Bash', input: { command: 'pwd' } },
            ],
          },
        })
      );

      const bashCalls = processor.getToolCallsByName('Bash');
      const readCalls = processor.getToolCallsByName('Read');

      assert.strictEqual(bashCalls.length, 2);
      assert.strictEqual(readCalls.length, 1);
      assert.strictEqual(bashCalls[0].name, 'Bash');
      assert.strictEqual(readCalls[0].name, 'Read');
    });

    it('should filter file changes by path', async () => {
      const processor = new ClaudeCodeOutputProcessor();

      // Add file changes to different paths
      await processor.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'read-1',
                name: 'Read',
                input: { file_path: 'src/index.ts' },
              },
            ],
          },
        })
      );

      await processor.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'read-1',
                content: 'content',
                is_error: false,
              },
            ],
          },
        })
      );

      await processor.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'read-2',
                name: 'Read',
                input: { file_path: 'src/test.ts' },
              },
            ],
          },
        })
      );

      await processor.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'read-2',
                content: 'content',
                is_error: false,
              },
            ],
          },
        })
      );

      const indexChanges = processor.getFileChangesByPath('src/index.ts');
      const testChanges = processor.getFileChangesByPath('src/test.ts');

      assert.strictEqual(indexChanges.length, 1);
      assert.strictEqual(testChanges.length, 1);
      assert.strictEqual(indexChanges[0].path, 'src/index.ts');
    });

    it('should filter file changes by operation', async () => {
      const processor = new ClaudeCodeOutputProcessor();

      // Add Read, Write, and Edit operations
      const operations = [
        { id: 'read-1', name: 'Read', path: 'file1.ts' },
        { id: 'write-1', name: 'Write', path: 'file2.ts' },
        { id: 'edit-1', name: 'Edit', path: 'file3.ts' },
        { id: 'read-2', name: 'Read', path: 'file4.ts' },
      ];

      for (const op of operations) {
        await processor.processLine(
          JSON.stringify({
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  id: op.id,
                  name: op.name,
                  input: { file_path: op.path },
                },
              ],
            },
          })
        );

        await processor.processLine(
          JSON.stringify({
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: op.id,
                  content: 'success',
                  is_error: false,
                },
              ],
            },
          })
        );
      }

      const reads = processor.getFileChangesByOperation('read');
      const writes = processor.getFileChangesByOperation('write');
      const edits = processor.getFileChangesByOperation('edit');

      assert.strictEqual(reads.length, 2);
      assert.strictEqual(writes.length, 1);
      assert.strictEqual(edits.length, 1);
    });

    it('should get only failed tool calls', async () => {
      const processor = new ClaudeCodeOutputProcessor();

      // Add successful and failed tool calls
      await processor.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', id: 'success-1', name: 'Bash', input: {} }],
          },
        })
      );

      await processor.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'success-1',
                content: 'success',
                is_error: false,
              },
            ],
          },
        })
      );

      await processor.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', id: 'fail-1', name: 'Bash', input: {} }],
          },
        })
      );

      await processor.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'fail-1',
                content: 'error',
                is_error: true,
              },
            ],
          },
        })
      );

      const failed = processor.getFailedToolCalls();

      assert.strictEqual(failed.length, 1);
      assert.strictEqual(failed[0].status, 'error');
      assert.strictEqual(failed[0].id, 'fail-1');
    });

    it('should get only successful tool calls', async () => {
      const processor = new ClaudeCodeOutputProcessor();

      // Add successful and failed tool calls
      await processor.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', id: 'success-1', name: 'Bash', input: {} }],
          },
        })
      );

      await processor.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'success-1',
                content: 'success',
                is_error: false,
              },
            ],
          },
        })
      );

      await processor.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', id: 'fail-1', name: 'Bash', input: {} }],
          },
        })
      );

      await processor.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'fail-1',
                content: 'error',
                is_error: true,
              },
            ],
          },
        })
      );

      const successful = processor.getSuccessfulToolCalls();

      assert.strictEqual(successful.length, 1);
      assert.strictEqual(successful[0].status, 'success');
      assert.strictEqual(successful[0].id, 'success-1');
    });

    it('should get total cost', async () => {
      const processor = new ClaudeCodeOutputProcessor();

      await processor.processLine(
        JSON.stringify({
          type: 'result',
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
            cache_read_input_tokens: 100,
          },
        })
      );

      const cost = processor.getTotalCost();

      // Input: 1000 * $3/1M = $0.003
      // Output: 500 * $15/1M = $0.0075
      // Cache: 100 * $0.30/1M = $0.00003
      // Total: ~$0.01053
      assert.ok(cost > 0);
      assert.ok(cost < 1); // Should be a small fraction of a dollar
    });

    it('should return zero cost when no usage tracked', () => {
      const processor = new ClaudeCodeOutputProcessor();
      const cost = processor.getTotalCost();
      assert.strictEqual(cost, 0);
    });
  });

  describe('Execution Summary', () => {
    it('should generate complete execution summary', async () => {
      const processor = new ClaudeCodeOutputProcessor();

      // Add various tool calls
      await processor.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', id: 'bash-1', name: 'Bash', input: {} }],
          },
        })
      );

      await processor.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'bash-1',
                content: 'success',
                is_error: false,
              },
            ],
          },
        })
      );

      await processor.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'test.ts' } },
            ],
          },
        })
      );

      await processor.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'read-1',
                content: 'contents',
                is_error: false,
              },
            ],
          },
        })
      );

      // Add usage
      await processor.processLine(
        JSON.stringify({
          type: 'result',
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
          },
        })
      );

      const summary = processor.getExecutionSummary();

      assert.strictEqual(summary.totalMessages, 5);
      assert.strictEqual(summary.toolCallsByType['Bash'], 1);
      assert.strictEqual(summary.toolCallsByType['Read'], 1);
      assert.strictEqual(summary.fileOperationsByType['read'], 1);
      assert.strictEqual(summary.successRate, 100);
      assert.strictEqual(summary.totalTokens.input, 1000);
      assert.strictEqual(summary.totalTokens.output, 500);
      assert.ok(summary.totalCost > 0);
      assert.ok(summary.duration >= 0);
      assert.ok(summary.startTime instanceof Date);
    });

    it('should calculate success rate correctly', async () => {
      const processor = new ClaudeCodeOutputProcessor();

      // Add 2 successful and 1 failed
      for (let i = 0; i < 2; i++) {
        await processor.processLine(
          JSON.stringify({
            type: 'assistant',
            message: {
              content: [{ type: 'tool_use', id: `success-${i}`, name: 'Bash', input: {} }],
            },
          })
        );

        await processor.processLine(
          JSON.stringify({
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: `success-${i}`,
                  content: 'ok',
                  is_error: false,
                },
              ],
            },
          })
        );
      }

      await processor.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', id: 'fail-1', name: 'Bash', input: {} }],
          },
        })
      );

      await processor.processLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'fail-1',
                content: 'error',
                is_error: true,
              },
            ],
          },
        })
      );

      const summary = processor.getExecutionSummary();

      // 2 successful out of 3 total = 66.67%
      assert.ok(Math.abs(summary.successRate - 66.67) < 0.1);
    });

    it('should handle empty state gracefully', () => {
      const processor = new ClaudeCodeOutputProcessor();
      const summary = processor.getExecutionSummary();

      assert.strictEqual(summary.totalMessages, 0);
      assert.deepStrictEqual(summary.toolCallsByType, {});
      assert.deepStrictEqual(summary.fileOperationsByType, {});
      assert.strictEqual(summary.successRate, 0);
      assert.strictEqual(summary.totalCost, 0);
    });
  });
});
