import { describe, it , expect } from 'vitest'
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaudeCodeOutputProcessor } from '../../../../src/execution/output/claude-code-output-processor.js';
import type { ToolCall, FileChange } from '../../../../src/execution/output/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Helper function to read and process a fixture file
 */
async function processFixture(fixtureName: string): Promise<ClaudeCodeOutputProcessor> {
  const fixturePath = join(
    __dirname,
    '../../../fixtures/output',
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
      expect(toolCalls.length).toBe(1);
      expect(toolCalls[0].name).toBe('Bash');
      expect(toolCalls[0].status).toBe('success');
    });

    it('should track usage metrics correctly', async () => {
      const processor = await processFixture('simple-bash.jsonl');

      const metrics = processor.getMetrics();
      expect(metrics.usage.inputTokens).toBe(150);
      expect(metrics.usage.outputTokens).toBe(50);
      expect(metrics.usage.cacheTokens).toBe(25);
    });

    it('should calculate cost correctly', async () => {
      const processor = await processFixture('simple-bash.jsonl');

      const cost = processor.getTotalCost();
      // Input: 150 * $3/M = $0.00045
      // Output: 50 * $15/M = $0.00075
      // Cache: 25 * $0.30/M = $0.0000075
      // Total: $0.0012075
      expect(Math.abs(cost - 0.0012075) < 0.0000001).toBeTruthy();
    });
  });

  describe('File Operations', () => {
    it('should track all file changes', async () => {
      const processor = await processFixture('file-operations.jsonl');

      const fileChanges = processor.getFileChanges();
      expect(fileChanges.length).toBe(3);
    });

    it('should identify read operations', async () => {
      const processor = await processFixture('file-operations.jsonl');

      const reads = processor.getFileChangesByOperation('read');
      expect(reads.length).toBe(1);
      expect(reads[0].path).toBe('/path/to/config.ts');
    });

    it('should identify edit operations', async () => {
      const processor = await processFixture('file-operations.jsonl');

      const edits = processor.getFileChangesByOperation('edit');
      expect(edits.length).toBe(1);
      expect(edits[0].path).toBe('/path/to/config.ts');
    });

    it('should identify write operations', async () => {
      const processor = await processFixture('file-operations.jsonl');

      const writes = processor.getFileChangesByOperation('write');
      expect(writes.length).toBe(1);
      expect(writes[0].path).toBe('/path/to/new-file.ts');
    });

    it('should filter file changes by path', async () => {
      const processor = await processFixture('file-operations.jsonl');

      const configChanges = processor.getFileChangesByPath('/path/to/config.ts');
      expect(configChanges.length).toBe(2); // read and edit
    });
  });

  describe('Error Handling', () => {
    it('should track failed tool calls', async () => {
      const processor = await processFixture('error-case.jsonl');

      const failedCalls = processor.getFailedToolCalls();
      expect(failedCalls.length).toBe(3);
    });

    it('should mark tool calls with errors', async () => {
      const processor = await processFixture('error-case.jsonl');

      const toolCalls = processor.getToolCalls();
      expect(toolCalls.length).toBe(3);
      for (const call of toolCalls) {
        expect(call.status).toBe('error');
      }
    });

    it('should track error content', async () => {
      const processor = await processFixture('error-case.jsonl');

      const failedReads = processor.getToolCallsByName('Read');
      expect(failedReads.length).toBe(1);
      expect(failedReads[0].status).toBe('error');
    });

    it('should calculate success rate correctly for errors', async () => {
      const processor = await processFixture('error-case.jsonl');

      const summary = processor.getExecutionSummary();
      expect(summary.successRate).toBe(0);
    });
  });

  describe('Complex Multi-Tool Workflow', () => {
    it('should track multiple tool types', async () => {
      const processor = await processFixture('complex-workflow.jsonl');

      const toolCalls = processor.getToolCalls();
      expect(toolCalls.length).toBe(5);

      const grepCalls = processor.getToolCallsByName('Grep');
      const readCalls = processor.getToolCallsByName('Read');
      const editCalls = processor.getToolCallsByName('Edit');
      const bashCalls = processor.getToolCallsByName('Bash');

      expect(grepCalls.length).toBe(1);
      expect(readCalls.length).toBe(2);
      expect(editCalls.length).toBe(1);
      expect(bashCalls.length).toBe(1);
    });

    it('should track tool call execution order', async () => {
      const processor = await processFixture('complex-workflow.jsonl');

      const toolCalls = processor.getToolCalls();
      expect(toolCalls[0].name).toBe('Grep');
      expect(toolCalls[1].name).toBe('Read');
      expect(toolCalls[2].name).toBe('Edit');
      expect(toolCalls[3].name).toBe('Bash');
      expect(toolCalls[4].name).toBe('Read');
    });

    it('should generate accurate execution summary', async () => {
      const processor = await processFixture('complex-workflow.jsonl');

      const summary = processor.getExecutionSummary();
      expect(summary.toolCallsByType['Grep']).toBe(1);
      expect(summary.toolCallsByType['Read']).toBe(2);
      expect(summary.toolCallsByType['Edit']).toBe(1);
      expect(summary.toolCallsByType['Bash']).toBe(1);
      expect(summary.successRate).toBe(100);
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

      expect(totalInput).toBe(900); // 150 + 250 + 500
      expect(totalOutput).toBe(350); // 50 + 100 + 200
    });

    it('should track cache tokens separately', async () => {
      const processor = await processFixture('simple-bash.jsonl');

      const metrics = processor.getMetrics();
      expect(metrics.usage.cacheTokens).toBe(25);
    });

    it('should calculate total cost across multiple operations', async () => {
      const processor = await processFixture('file-operations.jsonl');

      const cost = processor.getTotalCost();
      // Input: 250 * $3/M = $0.00075
      // Output: 100 * $15/M = $0.00150
      // Cache: 50 * $0.30/M = $0.000015
      // Total: $0.002265
      expect(Math.abs(cost - 0.002265) < 0.000001).toBeTruthy();
    });
  });

  describe('Event-Driven Integration', () => {
    it('should emit tool call events during processing', async () => {
      const fixturePath = join(
        __dirname,
        '../../../fixtures/output',
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

      expect(toolCallEvents.length).toBe(1);
      expect(toolCallEvents[0].name).toBe('Bash');
    });

    it('should emit file change events', async () => {
      const fixturePath = join(
        __dirname,
        '../../../fixtures/output',
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

      expect(fileChangeEvents.length).toBe(3);
    });

    it('should emit progress events', async () => {
      const fixturePath = join(
        __dirname,
        '../../../fixtures/output',
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

      expect(progressCount > 0).toBeTruthy();
    });

    it('should not emit error events for successful processing', async () => {
      const fixturePath = join(
        __dirname,
        '../../../fixtures/output',
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

      expect(errors.length).toBe(0);
    });
  });

  describe('Query Integration', () => {
    it('should support filtering and querying across workflow', async () => {
      const processor = await processFixture('complex-workflow.jsonl');

      const successfulCalls = processor.getSuccessfulToolCalls();
      expect(successfulCalls.length).toBe(5);

      const failedCalls = processor.getFailedToolCalls();
      expect(failedCalls.length).toBe(0);
    });

    it('should provide execution summary with all metrics', async () => {
      const processor = await processFixture('complex-workflow.jsonl');

      const summary = processor.getExecutionSummary();

      expect(summary.totalMessages).toBe(11); // All messages processed
      expect(summary.toolCallsByType).toBeTruthy();
      expect(summary.fileOperationsByType).toBeTruthy();
      expect(summary.successRate).toBe(100);
      expect(summary.totalTokens.input > 0).toBeTruthy();
      expect(summary.totalTokens.output > 0).toBeTruthy();
      expect(summary.totalCost > 0).toBeTruthy();
      expect(summary.duration >= 0).toBeTruthy();
    });

    it('should combine queries for complex analysis', async () => {
      const processor = await processFixture('file-operations.jsonl');

      // Get all successful file writes
      const successfulCalls = processor.getSuccessfulToolCalls();
      const writeCalls = successfulCalls.filter((call) => call.name === 'Write');

      expect(writeCalls.length).toBe(1);
      expect(writeCalls[0].name).toBe('Write');

      // Verify corresponding file change was tracked
      const writes = processor.getFileChangesByOperation('write');
      expect(writes.length).toBe(1);
      expect(writes[0].path).toBe('/path/to/new-file.ts');
    });
  });
});
