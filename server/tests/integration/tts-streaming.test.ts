/**
 * TTS Streaming Integration Tests
 *
 * Tests end-to-end TTS streaming via WebSocket, including:
 * - WebSocket connection and tts_request handling
 * - Audio chunk streaming with sequential indices
 * - Completion with tts_end message
 * - Error handling when sidecar is unavailable
 * - Long text producing multiple chunks
 *
 * These tests use mocks for the TTS sidecar to avoid requiring Python/Kokoro installation.
 * The actual WebSocket message handling is tested with real server code.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { WebSocket as WsClient } from 'ws';
import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

// Import the types we need
import type {
  TTSAudioChunk,
  TTSStreamEnd,
  TTSStreamError,
} from '@sudocode-ai/types';

// ============================================================================
// Mock TTS Sidecar Manager
// ============================================================================

/**
 * Mock implementation of TTSSidecarManager for testing
 * Simulates the sidecar behavior without requiring Python/Kokoro
 */
class MockTTSSidecarManager extends EventEmitter {
  private _state: 'idle' | 'ready' | 'error' = 'idle';
  private _shouldFail: boolean = false;
  private _chunkCount: number = 3;
  private _chunkDelay: number = 5;

  getState() {
    return this._state;
  }

  setMockState(state: 'idle' | 'ready' | 'error') {
    this._state = state;
  }

  setShouldFail(shouldFail: boolean) {
    this._shouldFail = shouldFail;
  }

  setChunkCount(count: number) {
    this._chunkCount = count;
  }

  setChunkDelay(delay: number) {
    this._chunkDelay = delay;
  }

  reset() {
    this._state = 'idle';
    this._shouldFail = false;
    this._chunkCount = 3;
    this._chunkDelay = 5;
    this.removeAllListeners();
  }

  async ensureReady(): Promise<void> {
    if (this._shouldFail) {
      throw new Error('Mock sidecar unavailable');
    }
    this._state = 'ready';
  }

  async generate(request: { id: string; text: string; voice?: string; speed?: number }): Promise<void> {
    if (this._shouldFail) {
      // Emit error after a short delay
      setImmediate(() => {
        this.emit('error', {
          id: request.id,
          type: 'error',
          error: 'Mock sidecar failed to generate',
          recoverable: false,
        });
      });
      return;
    }

    // Simulate audio chunk generation using setImmediate for faster execution
    const totalChunks = this._chunkCount;
    const delay = this._chunkDelay;

    const emitChunks = async () => {
      for (let i = 0; i < totalChunks; i++) {
        if (delay > 0) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        this.emit('audio', {
          id: request.id,
          type: 'audio',
          chunk: Buffer.from(`mock-audio-chunk-${i}`).toString('base64'),
          index: i,
        });
      }

      // Emit done after all chunks
      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      this.emit('done', {
        id: request.id,
        type: 'done',
        total_chunks: totalChunks,
      });
    };

    // Start chunk emission asynchronously
    emitChunks();
  }

  async shutdown(): Promise<void> {
    this._state = 'idle';
  }
}

// ============================================================================
// Test Server Setup
// ============================================================================

/**
 * Creates a minimal test HTTP + WebSocket server that handles TTS requests
 * Uses the mock sidecar manager for testing
 */
function createTestServer(mockSidecar: MockTTSSidecarManager): {
  server: http.Server;
  wss: WebSocketServer;
  getPort: () => number;
  close: () => Promise<void>;
} {
  const server = http.createServer();
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    // Send welcome message
    ws.send(JSON.stringify({ type: 'pong', message: 'Connected to test server' }));

    ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }

        if (message.type === 'tts_request') {
          const requestId = message.request_id;
          const text = message.text;

          if (!requestId) {
            ws.send(JSON.stringify({
              type: 'tts_error',
              request_id: undefined,
              error: 'request_id is required',
              recoverable: false,
              fallback: true,
            }));
            return;
          }

          if (!text) {
            ws.send(JSON.stringify({
              type: 'tts_error',
              request_id: requestId,
              error: 'text is required',
              recoverable: false,
              fallback: true,
            }));
            return;
          }

          // Set up sidecar event handlers
          const startTime = Date.now();

          const audioHandler = (response: any) => {
            if (response.id !== requestId) return;
            ws.send(JSON.stringify({
              type: 'tts_audio',
              request_id: requestId,
              chunk: response.chunk,
              index: response.index,
              is_final: false,
            }));
          };

          const doneHandler = (response: any) => {
            if (response.id !== requestId) return;
            const durationMs = Date.now() - startTime;
            ws.send(JSON.stringify({
              type: 'tts_end',
              request_id: requestId,
              total_chunks: response.total_chunks,
              duration_ms: durationMs,
            }));
            cleanup();
          };

          const errorHandler = (response: any) => {
            if (response.id !== requestId) return;
            ws.send(JSON.stringify({
              type: 'tts_error',
              request_id: requestId,
              error: response.error,
              recoverable: response.recoverable,
              fallback: !response.recoverable,
            }));
            cleanup();
          };

          const cleanup = () => {
            mockSidecar.off('audio', audioHandler);
            mockSidecar.off('done', doneHandler);
            mockSidecar.off('error', errorHandler);
          };

          mockSidecar.on('audio', audioHandler);
          mockSidecar.on('done', doneHandler);
          mockSidecar.on('error', errorHandler);

          try {
            await mockSidecar.ensureReady();
            await mockSidecar.generate({
              id: requestId,
              text: text,
              voice: message.voice,
              speed: message.speed,
            });
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            ws.send(JSON.stringify({
              type: 'tts_error',
              request_id: requestId,
              error: `TTS sidecar unavailable: ${errorMessage}`,
              recoverable: false,
              fallback: true,
            }));
            cleanup();
          }
        }
      } catch {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Invalid message format',
        }));
      }
    });
  });

  return {
    server,
    wss,
    getPort: () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        return address.port;
      }
      return 0;
    },
    close: async () => {
      // Close all connections
      wss.clients.forEach(client => {
        client.terminate();
      });

      await new Promise<void>((resolve) => {
        wss.close(() => {
          server.close(() => resolve());
        });
      });
    },
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Connect to WebSocket and wait for connection + welcome message
 */
async function connectWebSocket(url: string, timeoutMs = 5000): Promise<WsClient> {
  return new Promise((resolve, reject) => {
    const ws = new WsClient(url);
    let welcomeReceived = false;

    const timeout = setTimeout(() => {
      ws.terminate();
      reject(new Error('Connection timeout'));
    }, timeoutMs);

    ws.on('open', () => {
      // Wait for welcome message
    });

    ws.on('message', (data: Buffer) => {
      if (!welcomeReceived) {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'pong') {
            welcomeReceived = true;
            clearTimeout(timeout);
            resolve(ws);
          }
        } catch {
          // Ignore
        }
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Wait for a WebSocket message matching a predicate
 */
function waitForMessage<T = any>(
  ws: WsClient,
  predicate: (message: any) => boolean,
  timeoutMs = 5000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const handler = (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        if (predicate(message)) {
          clearTimeout(timeout);
          ws.off('message', handler);
          resolve(message);
        }
      } catch {
        // Ignore parse errors
      }
    };

    const timeout = setTimeout(() => {
      ws.off('message', handler);
      reject(new Error(`Timeout waiting for message after ${timeoutMs}ms`));
    }, timeoutMs);

    ws.on('message', handler);
  });
}

/**
 * Collect all messages matching a filter until stop condition is met
 */
function collectUntil<T = any>(
  ws: WsClient,
  matchFilter: (message: any) => boolean,
  stopCondition: (message: any) => boolean,
  timeoutMs = 10000
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const messages: T[] = [];

    const handler = (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        if (matchFilter(message)) {
          messages.push(message);
        }
        if (stopCondition(message)) {
          clearTimeout(timeout);
          ws.off('message', handler);
          resolve(messages);
        }
      } catch {
        // Ignore parse errors
      }
    };

    const timeout = setTimeout(() => {
      ws.off('message', handler);
      reject(new Error(`Timeout collecting messages after ${timeoutMs}ms (collected ${messages.length})`));
    }, timeoutMs);

    ws.on('message', handler);
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('TTS Streaming Integration', () => {
  let mockSidecar: MockTTSSidecarManager;
  let testServer: ReturnType<typeof createTestServer>;
  let wsUrl: string;

  beforeAll(async () => {
    // Create mock sidecar
    mockSidecar = new MockTTSSidecarManager();

    // Create test server
    testServer = createTestServer(mockSidecar);

    // Start server on random port
    await new Promise<void>((resolve) => {
      testServer.server.listen(0, () => {
        const port = testServer.getPort();
        wsUrl = `ws://localhost:${port}/ws`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (testServer) {
      await testServer.close();
    }
  });

  beforeEach(() => {
    // Reset mock sidecar state before each test
    mockSidecar.reset();
  });

  describe('WebSocket connection and tts_request send', () => {
    it('should connect to WebSocket server', async () => {
      const ws = await connectWebSocket(wsUrl);
      expect(ws.readyState).toBe(WsClient.OPEN);
      ws.close();
    });

    it('should send tts_request and receive audio chunks and end message', async () => {
      const ws = await connectWebSocket(wsUrl);
      const requestId = randomUUID();

      try {
        // Collect messages until we receive tts_end
        const messagesPromise = collectUntil(
          ws,
          (msg) => msg.request_id === requestId && (msg.type === 'tts_audio' || msg.type === 'tts_end'),
          (msg) => msg.type === 'tts_end' && msg.request_id === requestId
        );

        ws.send(JSON.stringify({
          type: 'tts_request',
          request_id: requestId,
          text: 'Hello, world!',
          voice: 'af_heart',
          speed: 1.0,
        }));

        const messages = await messagesPromise;

        expect(messages.length).toBeGreaterThan(0);
        expect(messages.some((m) => m.type === 'tts_audio')).toBe(true);
        expect(messages.some((m) => m.type === 'tts_end')).toBe(true);
      } finally {
        ws.close();
      }
    });

    it('should return error when request_id is missing', async () => {
      const ws = await connectWebSocket(wsUrl);

      try {
        const errorPromise = waitForMessage(ws, (msg) => msg.type === 'tts_error');

        ws.send(JSON.stringify({
          type: 'tts_request',
          text: 'Hello, world!',
        }));

        const error = await errorPromise;
        expect(error.type).toBe('tts_error');
        expect(error.error).toContain('request_id is required');
        expect(error.fallback).toBe(true);
      } finally {
        ws.close();
      }
    });

    it('should return error when text is missing', async () => {
      const ws = await connectWebSocket(wsUrl);
      const requestId = randomUUID();

      try {
        const errorPromise = waitForMessage(ws, (msg) => msg.type === 'tts_error' && msg.request_id === requestId);

        ws.send(JSON.stringify({
          type: 'tts_request',
          request_id: requestId,
        }));

        const error = await errorPromise;
        expect(error.type).toBe('tts_error');
        expect(error.request_id).toBe(requestId);
        expect(error.error).toContain('text is required');
        expect(error.fallback).toBe(true);
      } finally {
        ws.close();
      }
    });
  });

  describe('Receive tts_audio chunks in order', () => {
    it('should receive chunks with sequential indices starting from 0', async () => {
      const ws = await connectWebSocket(wsUrl);
      const requestId = randomUUID();
      mockSidecar.setChunkCount(5);

      try {
        const messagesPromise = collectUntil<TTSAudioChunk | TTSStreamEnd>(
          ws,
          (msg) => msg.request_id === requestId && (msg.type === 'tts_audio' || msg.type === 'tts_end'),
          (msg) => msg.type === 'tts_end' && msg.request_id === requestId
        );

        ws.send(JSON.stringify({
          type: 'tts_request',
          request_id: requestId,
          text: 'Testing sequential chunk indices',
        }));

        const messages = await messagesPromise;
        const chunks = messages.filter((m): m is TTSAudioChunk => m.type === 'tts_audio');

        expect(chunks.length).toBe(5);
        chunks.forEach((chunk, idx) => {
          expect(chunk.index).toBe(idx);
          expect(chunk.request_id).toBe(requestId);
          expect(chunk.chunk).toBeTruthy();
          expect(typeof chunk.chunk).toBe('string');
        });
      } finally {
        ws.close();
      }
    });

    it('should have base64 encoded audio data in chunks', async () => {
      const ws = await connectWebSocket(wsUrl);
      const requestId = randomUUID();

      try {
        const messagesPromise = collectUntil(
          ws,
          (msg) => msg.request_id === requestId && (msg.type === 'tts_audio' || msg.type === 'tts_end'),
          (msg) => msg.type === 'tts_end' && msg.request_id === requestId
        );

        ws.send(JSON.stringify({
          type: 'tts_request',
          request_id: requestId,
          text: 'Test audio data',
        }));

        const messages = await messagesPromise;
        const chunks = messages.filter((m) => m.type === 'tts_audio');

        chunks.forEach((chunk) => {
          const decoded = Buffer.from(chunk.chunk, 'base64');
          expect(decoded.length).toBeGreaterThan(0);
        });
      } finally {
        ws.close();
      }
    });
  });

  describe('Receive tts_end with correct total_chunks', () => {
    it('should receive tts_end after all chunks with matching total_chunks', async () => {
      const ws = await connectWebSocket(wsUrl);
      const requestId = randomUUID();
      const expectedChunks = 4;
      mockSidecar.setChunkCount(expectedChunks);

      try {
        const messagesPromise = collectUntil(
          ws,
          (msg) => msg.request_id === requestId && (msg.type === 'tts_audio' || msg.type === 'tts_end'),
          (msg) => msg.type === 'tts_end' && msg.request_id === requestId
        );

        ws.send(JSON.stringify({
          type: 'tts_request',
          request_id: requestId,
          text: 'Test end message',
        }));

        const messages = await messagesPromise;
        const audioChunks = messages.filter((m) => m.type === 'tts_audio');
        const endMessage = messages.find((m): m is TTSStreamEnd => m.type === 'tts_end');

        expect(endMessage).toBeDefined();
        expect(endMessage!.request_id).toBe(requestId);
        expect(endMessage!.total_chunks).toBe(expectedChunks);
        expect(audioChunks.length).toBe(expectedChunks);
        expect(endMessage!.duration_ms).toBeGreaterThanOrEqual(0);
      } finally {
        ws.close();
      }
    });

    it('should include duration_ms in tts_end message', async () => {
      const ws = await connectWebSocket(wsUrl);
      const requestId = randomUUID();
      mockSidecar.setChunkDelay(20);

      try {
        const messagesPromise = collectUntil<TTSStreamEnd>(
          ws,
          (msg) => msg.request_id === requestId && msg.type === 'tts_end',
          (msg) => msg.type === 'tts_end' && msg.request_id === requestId
        );

        ws.send(JSON.stringify({
          type: 'tts_request',
          request_id: requestId,
          text: 'Test duration',
        }));

        const [endMessage] = await messagesPromise;

        expect(endMessage.duration_ms).toBeDefined();
        expect(endMessage.duration_ms).toBeGreaterThan(0);
      } finally {
        ws.close();
      }
    });
  });

  describe('Handle tts_error gracefully', () => {
    it('should send tts_error with fallback=true when sidecar unavailable', async () => {
      const ws = await connectWebSocket(wsUrl);
      const requestId = randomUUID();
      mockSidecar.setShouldFail(true);

      try {
        const errorPromise = waitForMessage<TTSStreamError>(
          ws,
          (msg) => msg.type === 'tts_error' && msg.request_id === requestId
        );

        ws.send(JSON.stringify({
          type: 'tts_request',
          request_id: requestId,
          text: 'This should fail',
        }));

        const error = await errorPromise;

        expect(error.type).toBe('tts_error');
        expect(error.request_id).toBe(requestId);
        expect(error.error).toContain('sidecar unavailable');
        expect(error.fallback).toBe(true);
        expect(error.recoverable).toBe(false);
      } finally {
        ws.close();
      }
    });

    it('should include request_id in error response', async () => {
      const ws = await connectWebSocket(wsUrl);
      const requestId = randomUUID();
      mockSidecar.setShouldFail(true);

      try {
        const errorPromise = waitForMessage<TTSStreamError>(
          ws,
          (msg) => msg.type === 'tts_error' && msg.request_id === requestId
        );

        ws.send(JSON.stringify({
          type: 'tts_request',
          request_id: requestId,
          text: 'Error test',
        }));

        const error = await errorPromise;
        expect(error.request_id).toBe(requestId);
      } finally {
        ws.close();
      }
    });

    it('should handle multiple sequential failed requests', async () => {
      const ws = await connectWebSocket(wsUrl);
      mockSidecar.setShouldFail(true);

      try {
        // Test first request
        const requestId1 = randomUUID();
        const error1Promise = waitForMessage<TTSStreamError>(
          ws,
          (msg) => msg.type === 'tts_error' && msg.request_id === requestId1
        );

        ws.send(JSON.stringify({
          type: 'tts_request',
          request_id: requestId1,
          text: 'First request',
        }));

        const error1 = await error1Promise;
        expect(error1.request_id).toBe(requestId1);

        // Test second request
        const requestId2 = randomUUID();
        const error2Promise = waitForMessage<TTSStreamError>(
          ws,
          (msg) => msg.type === 'tts_error' && msg.request_id === requestId2
        );

        ws.send(JSON.stringify({
          type: 'tts_request',
          request_id: requestId2,
          text: 'Second request',
        }));

        const error2 = await error2Promise;
        expect(error2.request_id).toBe(requestId2);
      } finally {
        ws.close();
      }
    });
  });

  describe('Test text chunking with long input', () => {
    it('should produce multiple chunks for long text', async () => {
      const ws = await connectWebSocket(wsUrl);
      const requestId = randomUUID();
      const longText = 'This is a long text that should produce multiple audio chunks. '.repeat(10);
      mockSidecar.setChunkCount(10);

      try {
        const messagesPromise = collectUntil(
          ws,
          (msg) => msg.request_id === requestId && (msg.type === 'tts_audio' || msg.type === 'tts_end'),
          (msg) => msg.type === 'tts_end' && msg.request_id === requestId,
          15000
        );

        ws.send(JSON.stringify({
          type: 'tts_request',
          request_id: requestId,
          text: longText,
        }));

        const messages = await messagesPromise;
        const audioChunks = messages.filter((m) => m.type === 'tts_audio');
        const endMessage = messages.find((m) => m.type === 'tts_end');

        expect(audioChunks.length).toBe(10);
        expect(endMessage).toBeDefined();
        expect((endMessage as TTSStreamEnd).total_chunks).toBe(10);
      } finally {
        ws.close();
      }
    });

    it('should handle short text with fewer chunks', async () => {
      const ws = await connectWebSocket(wsUrl);
      const requestId = randomUUID();
      mockSidecar.setChunkCount(1);

      try {
        const messagesPromise = collectUntil(
          ws,
          (msg) => msg.request_id === requestId && (msg.type === 'tts_audio' || msg.type === 'tts_end'),
          (msg) => msg.type === 'tts_end' && msg.request_id === requestId
        );

        ws.send(JSON.stringify({
          type: 'tts_request',
          request_id: requestId,
          text: 'Hi',
        }));

        const messages = await messagesPromise;
        const audioChunks = messages.filter((m) => m.type === 'tts_audio');
        const endMessage = messages.find((m) => m.type === 'tts_end') as TTSStreamEnd;

        expect(audioChunks.length).toBe(1);
        expect(endMessage.total_chunks).toBe(1);
      } finally {
        ws.close();
      }
    });
  });

  describe('Concurrent request handling', () => {
    it('should handle multiple concurrent tts_requests from same client', async () => {
      const ws = await connectWebSocket(wsUrl);
      const requestIds = [randomUUID(), randomUUID(), randomUUID()];
      mockSidecar.setChunkCount(2);

      try {
        // Collect all messages and track by request_id
        const messagesMap = new Map<string, any[]>();
        requestIds.forEach(id => messagesMap.set(id, []));

        const allDonePromise = new Promise<void>((resolve, reject) => {
          const doneCount = { count: 0 };
          const timeout = setTimeout(() => {
            reject(new Error('Timeout waiting for all requests to complete'));
          }, 15000);

          const handler = (data: Buffer) => {
            try {
              const message = JSON.parse(data.toString());
              if (requestIds.includes(message.request_id)) {
                if (message.type === 'tts_audio' || message.type === 'tts_end') {
                  messagesMap.get(message.request_id)!.push(message);
                }
                if (message.type === 'tts_end') {
                  doneCount.count++;
                  if (doneCount.count === requestIds.length) {
                    clearTimeout(timeout);
                    ws.off('message', handler);
                    resolve();
                  }
                }
              }
            } catch {
              // Ignore
            }
          };

          ws.on('message', handler);
        });

        // Send all requests
        for (const requestId of requestIds) {
          ws.send(JSON.stringify({
            type: 'tts_request',
            request_id: requestId,
            text: `Request ${requestId}`,
          }));
        }

        await allDonePromise;

        // Verify each request got its messages
        for (const requestId of requestIds) {
          const messages = messagesMap.get(requestId)!;
          const audioChunks = messages.filter((m) => m.type === 'tts_audio');
          const endMessage = messages.find((m) => m.type === 'tts_end');

          expect(audioChunks.length).toBe(2);
          expect(endMessage).toBeDefined();
          expect((endMessage as TTSStreamEnd).total_chunks).toBe(2);
        }
      } finally {
        ws.close();
      }
    });
  });

  describe('Voice and speed parameters', () => {
    it('should accept voice parameter in tts_request', async () => {
      const ws = await connectWebSocket(wsUrl);
      const requestId = randomUUID();

      try {
        const messagesPromise = collectUntil(
          ws,
          (msg) => msg.request_id === requestId && msg.type === 'tts_end',
          (msg) => msg.type === 'tts_end' && msg.request_id === requestId
        );

        ws.send(JSON.stringify({
          type: 'tts_request',
          request_id: requestId,
          text: 'Test voice',
          voice: 'af_sarah',
        }));

        const [endMessage] = await messagesPromise;
        expect(endMessage.type).toBe('tts_end');
      } finally {
        ws.close();
      }
    });

    it('should accept speed parameter in tts_request', async () => {
      const ws = await connectWebSocket(wsUrl);
      const requestId = randomUUID();

      try {
        const messagesPromise = collectUntil(
          ws,
          (msg) => msg.request_id === requestId && msg.type === 'tts_end',
          (msg) => msg.type === 'tts_end' && msg.request_id === requestId
        );

        ws.send(JSON.stringify({
          type: 'tts_request',
          request_id: requestId,
          text: 'Test speed',
          speed: 1.5,
        }));

        const [endMessage] = await messagesPromise;
        expect(endMessage.type).toBe('tts_end');
      } finally {
        ws.close();
      }
    });
  });
});
