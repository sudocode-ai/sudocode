/**
 * Worker IPC Tests
 *
 * Tests for IPC message type guards and validation between main process and workers.
 *
 * @module workers/tests/worker-ipc
 */

import { describe, it, expect } from 'vitest'
import {
  isWorkerMessage,
  isMainMessage,
  type WorkerToMainMessage,
  type MainToWorkerMessage,
} from '../../../src/workers/worker-ipc.js'

describe('Worker IPC', () => {
  describe('isWorkerMessage', () => {
    it('should validate ready message', () => {
      const message: WorkerToMainMessage = {
        type: 'ready',
        executionId: 'exec-123',
        workerId: 'worker-123',
      }

      expect(isWorkerMessage(message)).toBe(true)
    })

    it('should validate log message', () => {
      const message: WorkerToMainMessage = {
        type: 'log',
        executionId: 'exec-123',
        data: {
          type: 'log',
          data: 'Test log',
          timestamp: new Date().toISOString(),
        },
      }

      expect(isWorkerMessage(message)).toBe(true)
    })

    it('should validate status message', () => {
      const message: WorkerToMainMessage = {
        type: 'status',
        executionId: 'exec-123',
        status: 'running',
      }

      expect(isWorkerMessage(message)).toBe(true)
    })

    it('should validate complete message', () => {
      const message: WorkerToMainMessage = {
        type: 'complete',
        executionId: 'exec-123',
        result: {
          status: 'completed',
          exitCode: 0,
          completedAt: new Date().toISOString(),
        },
      }

      expect(isWorkerMessage(message)).toBe(true)
    })

    it('should validate error message without fatal flag', () => {
      const message: WorkerToMainMessage = {
        type: 'error',
        executionId: 'exec-123',
        error: 'Test error',
      }

      expect(isWorkerMessage(message)).toBe(true)
    })

    it('should validate error message with fatal flag', () => {
      const message: WorkerToMainMessage = {
        type: 'error',
        executionId: 'exec-123',
        error: 'Fatal error',
        fatal: true,
      }

      expect(isWorkerMessage(message)).toBe(true)
    })

    it('should reject null', () => {
      expect(isWorkerMessage(null)).toBeFalsy()
    })

    it('should reject undefined', () => {
      expect(isWorkerMessage(undefined)).toBeFalsy()
    })

    it('should reject non-object', () => {
      expect(isWorkerMessage('string')).toBe(false)
      expect(isWorkerMessage(123)).toBe(false)
      expect(isWorkerMessage(true)).toBe(false)
    })

    it('should reject object without type', () => {
      expect(isWorkerMessage({ executionId: 'exec-123' })).toBe(false)
    })

    it('should reject object with invalid type', () => {
      expect(
        isWorkerMessage({
          type: 'invalid',
          executionId: 'exec-123',
        })
      ).toBe(false)
    })

    it('should reject object with non-string type', () => {
      expect(
        isWorkerMessage({
          type: 123,
          executionId: 'exec-123',
        })
      ).toBe(false)
    })

    it('should reject MainToWorkerMessage', () => {
      const mainMessage: MainToWorkerMessage = {
        type: 'cancel',
        executionId: 'exec-123',
      }

      expect(isWorkerMessage(mainMessage)).toBe(false)
    })
  })

  describe('isMainMessage', () => {
    it('should validate cancel message', () => {
      const message: MainToWorkerMessage = {
        type: 'cancel',
        executionId: 'exec-123',
      }

      expect(isMainMessage(message)).toBe(true)
    })

    it('should validate ping message', () => {
      const message: MainToWorkerMessage = {
        type: 'ping',
      }

      expect(isMainMessage(message)).toBe(true)
    })

    it('should reject null', () => {
      expect(isMainMessage(null)).toBeFalsy()
    })

    it('should reject undefined', () => {
      expect(isMainMessage(undefined)).toBeFalsy()
    })

    it('should reject non-object', () => {
      expect(isMainMessage('string')).toBe(false)
      expect(isMainMessage(123)).toBe(false)
      expect(isMainMessage(true)).toBe(false)
    })

    it('should reject object without type', () => {
      expect(isMainMessage({ executionId: 'exec-123' })).toBe(false)
    })

    it('should reject object with invalid type', () => {
      expect(
        isMainMessage({
          type: 'invalid',
          executionId: 'exec-123',
        })
      ).toBe(false)
    })

    it('should reject object with non-string type', () => {
      expect(
        isMainMessage({
          type: 123,
          executionId: 'exec-123',
        })
      ).toBe(false)
    })

    it('should reject WorkerToMainMessage', () => {
      const workerMessage: WorkerToMainMessage = {
        type: 'ready',
        executionId: 'exec-123',
        workerId: 'worker-123',
      }

      expect(isMainMessage(workerMessage)).toBe(false)
    })
  })

  describe('type safety', () => {
    it('should ensure WorkerToMainMessage union is exhaustive', () => {
      const messages: WorkerToMainMessage[] = [
        {
          type: 'ready',
          executionId: 'exec-123',
          workerId: 'worker-123',
        },
        {
          type: 'log',
          executionId: 'exec-123',
          data: {
            type: 'log',
            data: 'Test',
            timestamp: new Date().toISOString(),
          },
        },
        {
          type: 'status',
          executionId: 'exec-123',
          status: 'running',
        },
        {
          type: 'complete',
          executionId: 'exec-123',
          result: {
            status: 'completed',
            exitCode: 0,
            completedAt: new Date().toISOString(),
          },
        },
        {
          type: 'error',
          executionId: 'exec-123',
          error: 'Test error',
          fatal: true,
        },
      ]

      messages.forEach((msg) => {
        expect(isWorkerMessage(msg)).toBe(true)
      })
    })

    it('should ensure MainToWorkerMessage union is exhaustive', () => {
      const messages: MainToWorkerMessage[] = [
        {
          type: 'cancel',
          executionId: 'exec-123',
        },
        {
          type: 'ping',
        },
      ]

      messages.forEach((msg) => {
        expect(isMainMessage(msg)).toBe(true)
      })
    })
  })

  describe('message structure validation', () => {
    it('should accept ready message with exact required fields', () => {
      expect(
        isWorkerMessage({
          type: 'ready',
          executionId: 'exec-123',
          workerId: 'worker-123',
        })
      ).toBe(true)
    })

    it('should accept ready message with extra fields', () => {
      expect(
        isWorkerMessage({
          type: 'ready',
          executionId: 'exec-123',
          workerId: 'worker-123',
          extraField: 'ignored',
        })
      ).toBe(true)
    })

    it('should accept log message with any data payload', () => {
      expect(
        isWorkerMessage({
          type: 'log',
          executionId: 'exec-123',
          data: {
            type: 'stdout',
            data: 'Output',
            timestamp: '2025-01-01T00:00:00.000Z',
          },
        })
      ).toBe(true)

      expect(
        isWorkerMessage({
          type: 'log',
          executionId: 'exec-123',
          data: {
            type: 'stderr',
            data: 'Error output',
            timestamp: '2025-01-01T00:00:00.000Z',
          },
        })
      ).toBe(true)
    })

    it('should accept status message with any ExecutionStatus', () => {
      const statuses = ['pending', 'running', 'completed', 'failed', 'cancelled', 'stopped']

      statuses.forEach((status) => {
        expect(
          isWorkerMessage({
            type: 'status',
            executionId: 'exec-123',
            status,
          })
        ).toBe(true)
      })
    })

    it('should accept complete message with minimal result', () => {
      expect(
        isWorkerMessage({
          type: 'complete',
          executionId: 'exec-123',
          result: {
            status: 'completed',
            completedAt: '2025-01-01T00:00:00.000Z',
          },
        })
      ).toBe(true)
    })

    it('should accept complete message with full result', () => {
      expect(
        isWorkerMessage({
          type: 'complete',
          executionId: 'exec-123',
          result: {
            status: 'failed',
            exitCode: 1,
            error: 'Execution error',
            completedAt: '2025-01-01T00:00:00.000Z',
          },
        })
      ).toBe(true)
    })

    it('should accept error message with just error string', () => {
      expect(
        isWorkerMessage({
          type: 'error',
          executionId: 'exec-123',
          error: 'Simple error',
        })
      ).toBe(true)
    })

    it('should accept cancel message with executionId', () => {
      expect(
        isMainMessage({
          type: 'cancel',
          executionId: 'exec-123',
        })
      ).toBe(true)
    })

    it('should accept ping message without additional fields', () => {
      expect(
        isMainMessage({
          type: 'ping',
        })
      ).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('should handle empty object', () => {
      expect(isWorkerMessage({})).toBe(false)
      expect(isMainMessage({})).toBe(false)
    })

    it('should handle array', () => {
      expect(isWorkerMessage([])).toBe(false)
      expect(isMainMessage([])).toBe(false)
    })

    it('should handle Date object', () => {
      expect(isWorkerMessage(new Date())).toBe(false)
      expect(isMainMessage(new Date())).toBe(false)
    })

    it('should handle RegExp object', () => {
      expect(isWorkerMessage(/test/)).toBe(false)
      expect(isMainMessage(/test/)).toBe(false)
    })

    it('should handle Error object', () => {
      expect(isWorkerMessage(new Error('test'))).toBe(false)
      expect(isMainMessage(new Error('test'))).toBe(false)
    })

    it('should handle function', () => {
      expect(isWorkerMessage(() => {})).toBe(false)
      expect(isMainMessage(() => {})).toBe(false)
    })
  })
})
