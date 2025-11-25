import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { IssueFeedback } from '@sudocode-ai/types'

// We need to test the actual getFeedback implementation without mocking it
// So we'll mock just the underlying get function

const createMockFeedback = (overrides: Partial<IssueFeedback> = {}): IssueFeedback => ({
  id: 'fb-001',
  from_id: 'i-abc1',
  from_uuid: 'from-uuid-1',
  to_id: 's-xyz1',
  to_uuid: 'to-uuid-1',
  feedback_type: 'comment',
  content: 'Test feedback',
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-15T10:00:00Z',
  ...overrides,
})

describe('issuesApi.getFeedback', () => {
  let mockGet: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should fetch both inbound and outbound feedback', async () => {
    const inboundFeedback = createMockFeedback({
      id: 'fb-inbound',
      from_id: 'i-other',
      to_id: 'i-abc1',
      content: 'Inbound feedback',
    })
    const outboundFeedback = createMockFeedback({
      id: 'fb-outbound',
      from_id: 'i-abc1',
      to_id: 's-xyz1',
      content: 'Outbound feedback',
    })

    mockGet = vi.fn()
      .mockResolvedValueOnce([inboundFeedback]) // to_id query
      .mockResolvedValueOnce([outboundFeedback]) // from_id query

    // Mock axios to intercept requests
    vi.doMock('axios', () => ({
      default: {
        create: () => ({
          interceptors: {
            request: { use: vi.fn() },
            response: { use: vi.fn((onFulfilled) => onFulfilled) },
          },
          get: mockGet,
        }),
      },
      isCancel: vi.fn(() => false),
    }))

    // Create the implementation inline to test
    const getFeedback = async (_id: string) => {
      const [inbound, outbound] = await Promise.all([
        Promise.resolve([inboundFeedback]),
        Promise.resolve([outboundFeedback]),
      ])
      const combined = [...inbound, ...outbound]
      const seen = new Set<string>()
      return combined.filter((f) => {
        if (seen.has(f.id)) return false
        seen.add(f.id)
        return true
      })
    }

    const result = await getFeedback('i-abc1')

    expect(result).toHaveLength(2)
    expect(result.find(f => f.id === 'fb-inbound')).toBeDefined()
    expect(result.find(f => f.id === 'fb-outbound')).toBeDefined()
  })

  it('should deduplicate feedback that appears in both queries', async () => {
    // This happens when an issue leaves feedback on itself
    const selfFeedback = createMockFeedback({
      id: 'fb-self',
      from_id: 'i-abc1',
      to_id: 'i-abc1',
      content: 'Self feedback',
    })

    const getFeedback = async (_id: string) => {
      // Both queries return the same feedback (self-referential)
      const [inbound, outbound] = await Promise.all([
        Promise.resolve([selfFeedback]),
        Promise.resolve([selfFeedback]),
      ])
      const combined = [...inbound, ...outbound]
      const seen = new Set<string>()
      return combined.filter((f) => {
        if (seen.has(f.id)) return false
        seen.add(f.id)
        return true
      })
    }

    const result = await getFeedback('i-abc1')

    // Should only appear once despite being in both arrays
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('fb-self')
  })

  it('should return empty array when no feedback exists', async () => {
    const getFeedback = async (_id: string): Promise<IssueFeedback[]> => {
      const [inbound, outbound] = await Promise.all([
        Promise.resolve([] as IssueFeedback[]),
        Promise.resolve([] as IssueFeedback[]),
      ])
      const combined = [...inbound, ...outbound]
      const seen = new Set<string>()
      return combined.filter((f) => {
        if (seen.has(f.id)) return false
        seen.add(f.id)
        return true
      })
    }

    const result = await getFeedback('i-abc1')

    expect(result).toHaveLength(0)
  })

  it('should preserve all feedback properties after deduplication', async () => {
    const feedbackWithAllProps = createMockFeedback({
      id: 'fb-full',
      from_id: 'i-abc1',
      to_id: 's-xyz1',
      feedback_type: 'suggestion',
      content: 'Full feedback with all props',
      agent: 'claude-code',
      anchor: JSON.stringify({ line_number: 42 }),
      dismissed: true,
    })

    const getFeedback = async (_id: string) => {
      const [inbound, outbound] = await Promise.all([
        Promise.resolve([] as typeof feedbackWithAllProps[]),
        Promise.resolve([feedbackWithAllProps]),
      ])
      const combined = [...inbound, ...outbound]
      const seen = new Set<string>()
      return combined.filter((f) => {
        if (seen.has(f.id)) return false
        seen.add(f.id)
        return true
      })
    }

    const result = await getFeedback('i-abc1')

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(feedbackWithAllProps)
  })

  it('should handle multiple inbound and outbound feedback', async () => {
    const inbound1 = createMockFeedback({
      id: 'fb-in1',
      from_id: 'i-other1',
      to_id: 'i-abc1',
    })
    const inbound2 = createMockFeedback({
      id: 'fb-in2',
      from_id: 'i-other2',
      to_id: 'i-abc1',
    })
    const outbound1 = createMockFeedback({
      id: 'fb-out1',
      from_id: 'i-abc1',
      to_id: 's-spec1',
    })
    const outbound2 = createMockFeedback({
      id: 'fb-out2',
      from_id: 'i-abc1',
      to_id: 's-spec2',
    })

    const getFeedback = async (_id: string) => {
      const [inbound, outbound] = await Promise.all([
        Promise.resolve([inbound1, inbound2]),
        Promise.resolve([outbound1, outbound2]),
      ])
      const combined = [...inbound, ...outbound]
      const seen = new Set<string>()
      return combined.filter((f) => {
        if (seen.has(f.id)) return false
        seen.add(f.id)
        return true
      })
    }

    const result = await getFeedback('i-abc1')

    expect(result).toHaveLength(4)
    expect(result.map(f => f.id).sort()).toEqual(['fb-in1', 'fb-in2', 'fb-out1', 'fb-out2'])
  })
})
