import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ClaudeCodeOutputProcessor } from '../../../../src/execution/output/claude-code-output-processor.js';
import type { ToolCall, FileChange } from '../../../../src/execution/output/types.js';

/**
 * Helper function to read and process a fixture file
 */
async function processFixture(fixtureName: string): Promise<ClaudeCodeOutputProcessor> {
  const fixturePath = join(
    process.cwd(),
    'tests',
    'fixtures',
    'output',
    fixtureName
  );
  const content = await readFile(fixturePath, 'utf-8');
  const lines = content.split('\n').filter((line) => line.trim() !== '');

  const processor = new ClaudeCodeOutputProcessor();

  for (const line of lines) {
    await processor.processLine(line);
  }

  return processor;
}

describe('End-to-End Output Processing', () => {
  describe('Simple Bash Execution', () => {
    it('should process a simple bash command', async () => {
      const processor = await processFixture('simple-bash.jsonl');

      const toolCalls = processor.getToolCalls();
      assert.strictEqual(toolCalls.length, 1);
      assert.strictEqual(toolCalls[0].name, 'Bash');
      assert.strictEqual(toolCalls[0].status, 'success');
    });

    it('should track usage metrics correctly', async () => {
      const processor = await processFixture('simple-bash.jsonl');

      const metrics = processor.getMetrics();
      assert.strictEqual(metrics.usage.inputTokens, 150);
      assert.strictEqual(metrics.usage.outputTokens, 50);
      assert.strictEqual(metrics.usage.cacheTokens, 25);
    });

    it('should calculate cost correctly', async () => {
      const processor = await processFixture('simple-bash.jsonl');

      const cost = processor.getTotalCost();
      // Input: 150 * $3/M = $0.00045
      // Output: 50 * $15/M = $0.00075
      // Cache: 25 * $0.30/M = $0.0000075
      // Total: $0.0012075
      assert.ok(Math.abs(cost - 0.0012075) < 0.0000001);
    });
  });

  describe('File Operations', () => {
    it('should track all file changes', async () => {
      const processor = await processFixture('file-operations.jsonl');

      const fileChanges = processor.getFileChanges();
      assert.strictEqual(fileChanges.length, 3);
    });

    it('should identify read operations', async () => {
      const processor = await processFixture('file-operations.jsonl');

      const reads = processor.getFileChangesByOperation('read');
      assert.strictEqual(reads.length, 1);
      assert.strictEqual(reads[0].path, '/path/to/config.ts');
    });

    it('should identify edit operations', async () => {
      const processor = await processFixture('file-operations.jsonl');

      const edits = processor.getFileChangesByOperation('edit');
      assert.strictEqual(edits.length, 1);
      assert.strictEqual(edits[0].path, '/path/to/config.ts');
    });

    it('should identify write operations', async () => {
      const processor = await processFixture('file-operations.jsonl');

      const writes = processor.getFileChangesByOperation('write');
      assert.strictEqual(writes.length, 1);
      assert.strictEqual(writes[0].path, '/path/to/new-file.ts');
    });

    it('should filter file changes by path', async () => {
      const processor = await processFixture('file-operations.jsonl');

      const configChanges = processor.getFileChangesByPath('/path/to/config.ts');
      assert.strictEqual(configChanges.length, 2); // read and edit
    });
  });

  describe('Error Handling', () => {
    it('should track failed tool calls', async () => {
      const processor = await processFixture('error-case.jsonl');

      const failedCalls = processor.getFailedToolCalls();
      assert.strictEqual(failedCalls.length, 3);
    });

    it('should mark tool calls with errors', async () => {
      const processor = await processFixture('error-case.jsonl');

      const toolCalls = processor.getToolCalls();
      assert.strictEqual(toolCalls.length, 3);
      for (const call of toolCalls) {
        assert.strictEqual(call.status, 'error');
      }
    });

    it('should track error content', async () => {
      const processor = await processFixture('error-case.jsonl');

      const failedReads = processor.getToolCallsByName('Read');
      assert.strictEqual(failedReads.length, 1);
      assert.strictEqual(failedReads[0].status, 'error');
    });

    it('should calculate success rate correctly for errors', async () => {
      const processor = await processFixture('error-case.jsonl');

      const summary = processor.getExecutionSummary();
      assert.strictEqual(summary.successRate, 0);
    });
  });

  describe('Complex Multi-Tool Workflow', () => {
    it('should track multiple tool types', async () => {
      const processor = await processFixture('complex-workflow.jsonl');

      const toolCalls = processor.getToolCalls();
      assert.strictEqual(toolCalls.length, 5);

      const grepCalls = processor.getToolCallsByName('Grep');
      const readCalls = processor.getToolCallsByName('Read');
      const editCalls = processor.getToolCallsByName('Edit');
      const bashCalls = processor.getToolCallsByName('Bash');

      assert.strictEqual(grepCalls.length, 1);
      assert.strictEqual(readCalls.length, 2);
      assert.strictEqual(editCalls.length, 1);
      assert.strictEqual(bashCalls.length, 1);
    });

    it('should track tool call execution order', async () => {
      const processor = await processFixture('complex-workflow.jsonl');

      const toolCalls = processor.getToolCalls();
      assert.strictEqual(toolCalls[0].name, 'Grep');
      assert.strictEqual(toolCalls[1].name, 'Read');
      assert.strictEqual(toolCalls[2].name, 'Edit');
      assert.strictEqual(toolCalls[3].name, 'Bash');
      assert.strictEqual(toolCalls[4].name, 'Read');
    });

    it('should generate accurate execution summary', async () => {
      const processor = await processFixture('complex-workflow.jsonl');

      const summary = processor.getExecutionSummary();
      assert.strictEqual(summary.toolCallsByType['Grep'], 1);
      assert.strictEqual(summary.toolCallsByType['Read'], 2);
      assert.strictEqual(summary.toolCallsByType['Edit'], 1);
      assert.strictEqual(summary.toolCallsByType['Bash'], 1);
      assert.strictEqual(summary.successRate, 100);
    });
  });

  describe('Usage Tracking', () => {
    it('should accumulate token usage across all fixtures', async () => {
      const processors = await Promise.all([
        processFixture('simple-bash.jsonl'),
        processFixture('file-operations.jsonl'),
        processFixture('complex-workflow.jsonl'),
      ]);

      const totalInput = processors.reduce(
        (sum, p) => sum + p.getMetrics().usage.inputTokens,
        0
      );
      const totalOutput = processors.reduce(
        (sum, p) => sum + p.getMetrics().usage.outputTokens,
        0
      );

      assert.strictEqual(totalInput, 900); // 150 + 250 + 500
      assert.strictEqual(totalOutput, 350); // 50 + 100 + 200
    });

    it('should track cache tokens separately', async () => {
      const processor = await processFixture('simple-bash.jsonl');

      const metrics = processor.getMetrics();
      assert.strictEqual(metrics.usage.cacheTokens, 25);
    });

    it('should calculate total cost across multiple operations', async () => {
      const processor = await processFixture('file-operations.jsonl');

      const cost = processor.getTotalCost();
      // Input: 250 * $3/M = $0.00075
      // Output: 100 * $15/M = $0.00150
      // Cache: 50 * $0.30/M = $0.000015
      // Total: $0.002265
      assert.ok(Math.abs(cost - 0.002265) < 0.000001);
    });
  });

  describe('Event-Driven Integration', () => {
    it('should emit tool call events during processing', async () => {
      const fixturePath = join(
        process.cwd(),
        'tests',
        'fixtures',
        'output',
        'simple-bash.jsonl'
      );
      const content = await readFile(fixturePath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim() !== '');

      const processor = new ClaudeCodeOutputProcessor();
      const toolCallEvents: ToolCall[] = [];

      processor.onToolCall((toolCall) => {
        toolCallEvents.push(toolCall);
      });

      for (const line of lines) {
        await processor.processLine(line);
      }

      assert.strictEqual(toolCallEvents.length, 1);
      assert.strictEqual(toolCallEvents[0].name, 'Bash');
    });

    it('should emit file change events', async () => {
      const fixturePath = join(
        process.cwd(),
        'tests',
        'fixtures',
        'output',
        'file-operations.jsonl'
      );
      const content = await readFile(fixturePath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim() !== '');

      const processor = new ClaudeCodeOutputProcessor();
      const fileChangeEvents: FileChange[] = [];

      processor.onFileChange((fileChange) => {
        fileChangeEvents.push(fileChange);
      });

      for (const line of lines) {
        await processor.processLine(line);
      }

      assert.strictEqual(fileChangeEvents.length, 3);
    });

    it('should emit progress events', async () => {
      const fixturePath = join(
        process.cwd(),
        'tests',
        'fixtures',
        'output',
        'complex-workflow.jsonl'
      );
      const content = await readFile(fixturePath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim() !== '');

      const processor = new ClaudeCodeOutputProcessor();
      let progressCount = 0;

      processor.onProgress(() => {
        progressCount++;
      });

      for (const line of lines) {
        await processor.processLine(line);
      }

      assert.ok(progressCount > 0);
    });

    it('should not emit error events for successful processing', async () => {
      const fixturePath = join(
        process.cwd(),
        'tests',
        'fixtures',
        'output',
        'simple-bash.jsonl'
      );
      const content = await readFile(fixturePath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim() !== '');

      const processor = new ClaudeCodeOutputProcessor();
      const errors: Array<{ message: string; timestamp: Date; details?: any }> = [];

      processor.onError((error) => {
        errors.push(error);
      });

      for (const line of lines) {
        await processor.processLine(line);
      }

      assert.strictEqual(errors.length, 0);
    });
  });

  describe('Query Integration', () => {
    it('should support filtering and querying across workflow', async () => {
      const processor = await processFixture('complex-workflow.jsonl');

      const successfulCalls = processor.getSuccessfulToolCalls();
      assert.strictEqual(successfulCalls.length, 5);

      const failedCalls = processor.getFailedToolCalls();
      assert.strictEqual(failedCalls.length, 0);
    });

    it('should provide execution summary with all metrics', async () => {
      const processor = await processFixture('complex-workflow.jsonl');

      const summary = processor.getExecutionSummary();

      assert.strictEqual(summary.totalMessages, 11); // All messages processed
      assert.ok(summary.toolCallsByType);
      assert.ok(summary.fileOperationsByType);
      assert.strictEqual(summary.successRate, 100);
      assert.ok(summary.totalTokens.input > 0);
      assert.ok(summary.totalTokens.output > 0);
      assert.ok(summary.totalCost > 0);
      assert.ok(summary.duration >= 0);
    });

    it('should combine queries for complex analysis', async () => {
      const processor = await processFixture('file-operations.jsonl');

      // Get all successful file writes
      const successfulCalls = processor.getSuccessfulToolCalls();
      const writeCalls = successfulCalls.filter((call) => call.name === 'Write');

      assert.strictEqual(writeCalls.length, 1);
      assert.strictEqual(writeCalls[0].name, 'Write');

      // Verify corresponding file change was tracked
      const writes = processor.getFileChangesByOperation('write');
      assert.strictEqual(writes.length, 1);
      assert.strictEqual(writes[0].path, '/path/to/new-file.ts');
    });
  });
});
