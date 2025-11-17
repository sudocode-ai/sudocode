/**
 * Tests for CRDTContext
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { CRDTProvider, useCRDT, useCRDTExecution, useCRDTIssue } from '@/contexts/CRDTContext'

// Mock y-websocket
vi.mock('y-websocket', () => {
  const WebsocketProvider = vi.fn().mockImplementation((_url, _room, _doc) => {
    const eventHandlers = new Map<string, Function>()
    let timeout: NodeJS.Timeout | null = null

    const provider = {
      awareness: null,
      on: (event: string, handler: Function) => {
        eventHandlers.set(event, handler)

        // Simulate connection synchronously to avoid timing issues
        if (event === 'status') {
          // Use queueMicrotask to simulate async but avoid orphaned timers
          queueMicrotask(() => {
            if (eventHandlers.has('status')) {
              handler({ status: 'connected' })
            }
          })
        }
      },
      destroy: vi.fn(() => {
        if (timeout) {
          clearTimeout(timeout)
        }
        eventHandlers.clear()
      }),
      connect: vi.fn(),
      disconnect: vi.fn(),
    }

    return provider
  })

  return {
    WebsocketProvider,
  }
})

describe('CRDTContext', () => {
  beforeEach(() => {
    // Don't call vi.clearAllMocks() as it breaks the mock implementation
  })

  afterEach(() => {
    // Don't call vi.restoreAllMocks() as it breaks the mock implementation
  })

  describe('CRDTProvider', () => {
    it('should initialize correctly', () => {
      const TestComponent = () => {
        const { connected } = useCRDT()
        return <div>Connected: {connected ? 'yes' : 'no'}</div>
      }

      render(
        <CRDTProvider enabled={true}>
          <TestComponent />
        </CRDTProvider>
      )

      expect(screen.getByText(/Connected:/)).toBeInTheDocument()
    })

    it('should not connect when disabled', () => {
      const TestComponent = () => {
        const { connected } = useCRDT()
        return <div>Connected: {connected ? 'yes' : 'no'}</div>
      }

      render(
        <CRDTProvider enabled={false}>
          <TestComponent />
        </CRDTProvider>
      )

      expect(screen.getByText(/Connected: no/)).toBeInTheDocument()
    })

    it('should update connection status', async () => {
      const TestComponent = () => {
        const { connected } = useCRDT()
        return <div data-testid="status">Connected: {connected ? 'yes' : 'no'}</div>
      }

      render(
        <CRDTProvider enabled={true}>
          <TestComponent />
        </CRDTProvider>
      )

      // Initially disconnected
      expect(screen.getByTestId('status')).toHaveTextContent('Connected: no')

      // Should become connected after provider initializes
      await waitFor(
        () => {
          expect(screen.getByTestId('status')).toHaveTextContent('Connected: yes')
        },
        { timeout: 500 }
      )
    })
  })

  describe('useCRDT hook', () => {
    it('should provide CRDT context', () => {
      const TestComponent = () => {
        const context = useCRDT()
        return (
          <div>
            <div data-testid="has-context">{context ? 'yes' : 'no'}</div>
            <div data-testid="issues-count">{context.issues.size}</div>
            <div data-testid="specs-count">{context.specs.size}</div>
            <div data-testid="executions-count">{context.executions.size}</div>
          </div>
        )
      }

      render(
        <CRDTProvider enabled={true}>
          <TestComponent />
        </CRDTProvider>
      )

      expect(screen.getByTestId('has-context')).toHaveTextContent('yes')
      expect(screen.getByTestId('issues-count')).toHaveTextContent('0')
      expect(screen.getByTestId('specs-count')).toHaveTextContent('0')
      expect(screen.getByTestId('executions-count')).toHaveTextContent('0')
    })

    it('should throw error when used outside provider', () => {
      const TestComponent = () => {
        useCRDT()
        return <div>Should not render</div>
      }

      // Suppress console.error for this test
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

      expect(() => {
        render(<TestComponent />)
      }).toThrow('useCRDT must be used within a CRDTProvider')

      consoleError.mockRestore()
    })
  })

  describe('useExecution hook', () => {
    it('should return undefined for non-existent execution', () => {
      const TestComponent = () => {
        const execution = useCRDTExecution('non-existent-id')
        return <div data-testid="execution">{execution ? 'found' : 'not found'}</div>
      }

      render(
        <CRDTProvider enabled={true}>
          <TestComponent />
        </CRDTProvider>
      )

      expect(screen.getByTestId('execution')).toHaveTextContent('not found')
    })

    it('should return undefined when no ID provided', () => {
      const TestComponent = () => {
        const execution = useCRDTExecution(undefined)
        return <div data-testid="execution">{execution ? 'found' : 'not found'}</div>
      }

      render(
        <CRDTProvider enabled={true}>
          <TestComponent />
        </CRDTProvider>
      )

      expect(screen.getByTestId('execution')).toHaveTextContent('not found')
    })
  })

  describe('useIssue hook', () => {
    it('should return undefined for non-existent issue', () => {
      const TestComponent = () => {
        const issue = useCRDTIssue('non-existent-id')
        return <div data-testid="issue">{issue ? 'found' : 'not found'}</div>
      }

      render(
        <CRDTProvider enabled={true}>
          <TestComponent />
        </CRDTProvider>
      )

      expect(screen.getByTestId('issue')).toHaveTextContent('not found')
    })

    it('should return undefined when no ID provided', () => {
      const TestComponent = () => {
        const issue = useCRDTIssue(undefined)
        return <div data-testid="issue">{issue ? 'found' : 'not found'}</div>
      }

      render(
        <CRDTProvider enabled={true}>
          <TestComponent />
        </CRDTProvider>
      )

      expect(screen.getByTestId('issue')).toHaveTextContent('not found')
    })
  })

  describe('State synchronization', () => {
    it('should provide getter functions', () => {
      const TestComponent = () => {
        const { getIssue, getSpec, getExecution, getAgent, getFeedback } = useCRDT()
        const hasAllGetters =
          typeof getIssue === 'function' &&
          typeof getSpec === 'function' &&
          typeof getExecution === 'function' &&
          typeof getAgent === 'function' &&
          typeof getFeedback === 'function'
        return (
          <div>
            <div data-testid="has-getters">
              {hasAllGetters ? 'yes' : 'no'}
            </div>
          </div>
        )
      }

      render(
        <CRDTProvider enabled={true}>
          <TestComponent />
        </CRDTProvider>
      )

      expect(screen.getByTestId('has-getters')).toHaveTextContent('yes')
    })

    it('should return empty maps initially', () => {
      const TestComponent = () => {
        const { issues, specs, executions, agents, feedback } = useCRDT()
        return (
          <div>
            <div data-testid="issues">{issues.size}</div>
            <div data-testid="specs">{specs.size}</div>
            <div data-testid="executions">{executions.size}</div>
            <div data-testid="agents">{agents.size}</div>
            <div data-testid="feedback">{feedback.size}</div>
          </div>
        )
      }

      render(
        <CRDTProvider enabled={true}>
          <TestComponent />
        </CRDTProvider>
      )

      expect(screen.getByTestId('issues')).toHaveTextContent('0')
      expect(screen.getByTestId('specs')).toHaveTextContent('0')
      expect(screen.getByTestId('executions')).toHaveTextContent('0')
      expect(screen.getByTestId('agents')).toHaveTextContent('0')
      expect(screen.getByTestId('feedback')).toHaveTextContent('0')
    })
  })
})
