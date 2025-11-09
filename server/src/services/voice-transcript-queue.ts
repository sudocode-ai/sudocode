/**
 * Voice Transcript Queue Service
 *
 * Manages queuing of voice transcripts for executions. When users speak
 * during an execution, transcripts are queued here and can be retrieved
 * by the AI agent via MCP tools.
 *
 * @module services/voice-transcript-queue
 */

import type { VoiceInputData } from "@sudocode-ai/types";

/**
 * Queued transcript with metadata
 */
export interface QueuedTranscript {
  transcript: string;
  confidence: number;
  timestamp: number;
  isFinal: boolean;
}

/**
 * Voice transcript queue for a single execution
 */
class ExecutionQueue {
  private transcripts: QueuedTranscript[] = [];
  private maxSize: number;

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  /**
   * Add a transcript to the queue
   */
  enqueue(data: VoiceInputData): void {
    const queued: QueuedTranscript = {
      transcript: data.transcript,
      confidence: data.confidence || 0,
      timestamp: Date.now(),
      isFinal: data.isFinal || false,
    };

    this.transcripts.push(queued);

    // Enforce max size (FIFO)
    if (this.transcripts.length > this.maxSize) {
      this.transcripts.shift();
    }
  }

  /**
   * Get all queued transcripts and clear the queue
   */
  dequeue(): QueuedTranscript[] {
    const items = [...this.transcripts];
    this.transcripts = [];
    return items;
  }

  /**
   * Peek at queued transcripts without removing them
   */
  peek(): QueuedTranscript[] {
    return [...this.transcripts];
  }

  /**
   * Get count of queued transcripts
   */
  count(): number {
    return this.transcripts.length;
  }

  /**
   * Clear all queued transcripts
   */
  clear(): void {
    this.transcripts = [];
  }
}

/**
 * Voice Transcript Queue Manager
 *
 * Manages transcript queues for all active executions
 */
export class VoiceTranscriptQueue {
  private queues = new Map<string, ExecutionQueue>();
  private maxQueueSize: number;

  constructor(maxQueueSize = 100) {
    this.maxQueueSize = maxQueueSize;
  }

  /**
   * Get or create queue for an execution
   */
  private getQueue(executionId: string): ExecutionQueue {
    let queue = this.queues.get(executionId);
    if (!queue) {
      queue = new ExecutionQueue(this.maxQueueSize);
      this.queues.set(executionId, queue);
    }
    return queue;
  }

  /**
   * Enqueue a voice transcript for an execution
   */
  enqueue(executionId: string, data: VoiceInputData): void {
    const queue = this.getQueue(executionId);
    queue.enqueue(data);

    console.log(
      `[voice-queue] Enqueued transcript for ${executionId}: "${data.transcript.substring(0, 50)}..." (confidence: ${data.confidence})`
    );
  }

  /**
   * Dequeue all transcripts for an execution
   */
  dequeue(executionId: string): QueuedTranscript[] {
    const queue = this.queues.get(executionId);
    if (!queue) {
      return [];
    }

    const transcripts = queue.dequeue();
    console.log(
      `[voice-queue] Dequeued ${transcripts.length} transcript(s) for ${executionId}`
    );
    return transcripts;
  }

  /**
   * Peek at queued transcripts without removing them
   */
  peek(executionId: string): QueuedTranscript[] {
    const queue = this.queues.get(executionId);
    return queue ? queue.peek() : [];
  }

  /**
   * Get count of queued transcripts for an execution
   */
  count(executionId: string): number {
    const queue = this.queues.get(executionId);
    return queue ? queue.count() : 0;
  }

  /**
   * Clear all transcripts for an execution
   */
  clear(executionId: string): void {
    const queue = this.queues.get(executionId);
    if (queue) {
      queue.clear();
      console.log(`[voice-queue] Cleared transcript queue for ${executionId}`);
    }
  }

  /**
   * Remove queue for an execution (cleanup)
   */
  removeQueue(executionId: string): void {
    this.queues.delete(executionId);
    console.log(`[voice-queue] Removed transcript queue for ${executionId}`);
  }

  /**
   * Get stats about all queues
   */
  getStats(): {
    totalQueues: number;
    totalTranscripts: number;
    queues: Array<{ executionId: string; count: number }>;
  } {
    const queues: Array<{ executionId: string; count: number }> = [];
    let totalTranscripts = 0;

    for (const [executionId, queue] of this.queues.entries()) {
      const count = queue.count();
      queues.push({ executionId, count });
      totalTranscripts += count;
    }

    return {
      totalQueues: this.queues.size,
      totalTranscripts,
      queues,
    };
  }
}
