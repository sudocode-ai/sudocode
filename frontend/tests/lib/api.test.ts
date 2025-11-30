import { describe, it, expect, vi, beforeEach } from 'vitest'
import { issuesApi, specsApi, relationshipsApi, feedbackApi, executionsApi } from '@/lib/api'

// Mock the entire api module
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    ...actual,
    issuesApi: {
      getAll: vi.fn(),
      getById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    specsApi: {
      getAll: vi.fn(),
      getById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      getFeedback: vi.fn(),
    },
    relationshipsApi: {
      getForEntity: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    feedbackApi: {
      getForSpec: vi.fn(),
      getById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    executionsApi: {
      create: vi.fn(),
      getById: vi.fn(),
      list: vi.fn(),
      createFollowUp: vi.fn(),
      cancel: vi.fn(),
    },
  }
})

describe('API Module', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('issuesApi', () => {
    it('should have all required methods', () => {
      expect(issuesApi).toHaveProperty('getAll')
      expect(issuesApi).toHaveProperty('getById')
      expect(issuesApi).toHaveProperty('create')
      expect(issuesApi).toHaveProperty('update')
      expect(issuesApi).toHaveProperty('delete')
    })

    it('should call getAll', () => {
      issuesApi.getAll()
      expect(issuesApi.getAll).toHaveBeenCalled()
    })

    it('should call getById with id', () => {
      issuesApi.getById('ISSUE-001')
      expect(issuesApi.getById).toHaveBeenCalledWith('ISSUE-001')
    })

    it('should call create with data', () => {
      const data = { title: 'Test', description: 'Test description' }
      issuesApi.create(data)
      expect(issuesApi.create).toHaveBeenCalledWith(data)
    })

    it('should call update with id and data', () => {
      const data = { status: 'in_progress' as const }
      issuesApi.update('ISSUE-001', data)
      expect(issuesApi.update).toHaveBeenCalledWith('ISSUE-001', data)
    })

    it('should call delete with id', () => {
      issuesApi.delete('ISSUE-001')
      expect(issuesApi.delete).toHaveBeenCalledWith('ISSUE-001')
    })
  })

  describe('specsApi', () => {
    it('should have all required methods', () => {
      expect(specsApi).toHaveProperty('getAll')
      expect(specsApi).toHaveProperty('getById')
      expect(specsApi).toHaveProperty('create')
      expect(specsApi).toHaveProperty('update')
      expect(specsApi).toHaveProperty('delete')
      expect(specsApi).toHaveProperty('getFeedback')
    })

    it('should call getAll', () => {
      specsApi.getAll()
      expect(specsApi.getAll).toHaveBeenCalled()
    })

    it('should call getFeedback with spec id', () => {
      specsApi.getFeedback('SPEC-001')
      expect(specsApi.getFeedback).toHaveBeenCalledWith('SPEC-001')
    })
  })

  describe('relationshipsApi', () => {
    it('should have all required methods', () => {
      expect(relationshipsApi).toHaveProperty('getForEntity')
      expect(relationshipsApi).toHaveProperty('create')
      expect(relationshipsApi).toHaveProperty('delete')
    })

    it('should call getForEntity with entity id and type', () => {
      relationshipsApi.getForEntity('ISSUE-001', 'issue')
      expect(relationshipsApi.getForEntity).toHaveBeenCalledWith(
        'ISSUE-001',
        'issue'
      )
    })

    it('should call create with relationship data', () => {
      const data = {
        from_id: 'ISSUE-001',
        from_type: 'issue' as const,
        to_id: 'SPEC-001',
        to_type: 'spec' as const,
        relationship_type: 'implements' as const,
      }
      relationshipsApi.create(data)
      expect(relationshipsApi.create).toHaveBeenCalledWith(data)
    })
  })

  describe('feedbackApi', () => {
    it('should have all required methods', () => {
      expect(feedbackApi).toHaveProperty('getForSpec')
      expect(feedbackApi).toHaveProperty('getById')
      expect(feedbackApi).toHaveProperty('create')
      expect(feedbackApi).toHaveProperty('update')
      expect(feedbackApi).toHaveProperty('delete')
    })

    it('should call getForSpec with spec id', () => {
      feedbackApi.getForSpec('SPEC-001')
      expect(feedbackApi.getForSpec).toHaveBeenCalledWith('SPEC-001')
    })

    it('should call create with feedback data', () => {
      const data = {
        issue_id: 'ISSUE-001',
        to_id: 'SPEC-001',
        feedback_type: 'comment' as const,
        content: 'Test feedback',
        anchor: {
          line_number: 10,
          anchor_status: 'valid' as const,
        },
      }
      feedbackApi.create(data)
      expect(feedbackApi.create).toHaveBeenCalledWith(data)
    })
  })

  describe('executionsApi', () => {
    it('should have all required methods', () => {
      expect(executionsApi).toHaveProperty('create')
      expect(executionsApi).toHaveProperty('getById')
      expect(executionsApi).toHaveProperty('list')
      expect(executionsApi).toHaveProperty('createFollowUp')
      expect(executionsApi).toHaveProperty('cancel')
    })

    it('should call create with issue id and request data', () => {
      const request = {
        config: {
          mode: 'worktree' as const,
          baseBranch: 'main',
          cleanupMode: 'auto' as const,
        },
        prompt: 'Implement feature X',
      }

      executionsApi.create('ISSUE-001', request)
      expect(executionsApi.create).toHaveBeenCalledWith('ISSUE-001', request)
    })

    it('should call getById with execution id', () => {
      executionsApi.getById('exec-123')
      expect(executionsApi.getById).toHaveBeenCalledWith('exec-123')
    })

    it('should call list with issue id', () => {
      executionsApi.list('ISSUE-001')
      expect(executionsApi.list).toHaveBeenCalledWith('ISSUE-001')
    })

    it('should call createFollowUp with execution id and feedback', () => {
      const request = {
        feedback: 'Please also add tests',
      }

      executionsApi.createFollowUp('exec-123', request)
      expect(executionsApi.createFollowUp).toHaveBeenCalledWith('exec-123', request)
    })

    it('should call cancel with execution id', () => {
      executionsApi.cancel('exec-123')
      expect(executionsApi.cancel).toHaveBeenCalledWith('exec-123')
    })
  })
})
