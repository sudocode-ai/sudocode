import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import express, { Express } from 'express'
import request from 'supertest'
import { createEditorsRouter } from '../../../src/routes/editors.js'
import { EditorType, EditorOpenError } from '../../../src/types/editor.js'
import { EditorService } from '../../../src/services/editor-service.js'

// Mock EditorService
vi.mock('../../../src/services/editor-service.js')

describe('Editors API Routes', () => {
  let app: Express
  let mockOpenWorktree: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // Setup mock for openWorktree method
    mockOpenWorktree = vi.fn()
    vi.mocked(EditorService).mockImplementation(
      () =>
        ({
          openWorktree: mockOpenWorktree,
        }) as any
    )

    // Setup Express app with editors router
    app = express()
    app.use(express.json())

    // Mock the project middleware by injecting project object
    app.use((req, _res, next) => {
      (req as any).project = {
        path: '/test/repo',
      }
      next()
    })

    app.use('/api', createEditorsRouter())
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('POST /api/open-in-ide', () => {
    it('should open worktree in IDE with default editor', async () => {
      mockOpenWorktree.mockResolvedValue(undefined)

      const response = await request(app)
        .post('/api/open-in-ide')
        .send({
          worktreePath: '/test/worktree',
        })

      expect(response.status).toBe(200)
      expect(response.body).toEqual({
        success: true,
        message: 'Opening worktree in IDE...',
      })

      expect(mockOpenWorktree).toHaveBeenCalledWith('/test/worktree', undefined)
    })

    it('should open worktree in IDE with editor type override', async () => {
      mockOpenWorktree.mockResolvedValue(undefined)

      const response = await request(app)
        .post('/api/open-in-ide')
        .send({
          worktreePath: '/test/worktree',
          editorType: 'cursor',
        })

      expect(response.status).toBe(200)
      expect(response.body).toEqual({
        success: true,
        message: 'Opening worktree in IDE...',
      })

      expect(mockOpenWorktree).toHaveBeenCalledWith('/test/worktree', 'cursor')
    })

    it('should return 400 if worktreePath is missing', async () => {
      const response = await request(app)
        .post('/api/open-in-ide')
        .send({})

      expect(response.status).toBe(400)
      expect(response.body).toEqual({
        success: false,
        message: 'worktreePath is required',
        error: {
          code: 'MISSING_WORKTREE_PATH',
          details: 'Request body must include worktreePath'
        }
      })
    })

    it('should return 400 if worktreePath is null', async () => {
      const response = await request(app)
        .post('/api/open-in-ide')
        .send({
          worktreePath: null
        })

      expect(response.status).toBe(400)
      expect(response.body).toEqual({
        success: false,
        message: 'worktreePath is required',
        error: {
          code: 'MISSING_WORKTREE_PATH',
          details: 'Request body must include worktreePath'
        }
      })
    })

    it('should return 400 if worktreePath is empty string', async () => {
      const response = await request(app)
        .post('/api/open-in-ide')
        .send({
          worktreePath: ''
        })

      expect(response.status).toBe(400)
      expect(response.body).toEqual({
        success: false,
        message: 'worktreePath is required',
        error: {
          code: 'MISSING_WORKTREE_PATH',
          details: 'Request body must include worktreePath'
        }
      })
    })

    it('should return 404 if editor is not found', async () => {
      const error = new EditorOpenError(
        'EDITOR_NOT_FOUND',
        EditorType.VS_CODE,
        'VS Code command not found',
        'Please install VS Code or add it to PATH'
      )

      mockOpenWorktree.mockRejectedValue(error)

      const response = await request(app)
        .post('/api/open-in-ide')
        .send({
          worktreePath: '/test/worktree',
        })

      expect(response.status).toBe(404)
      expect(response.body).toEqual({
        success: false,
        message: 'VS Code command not found',
        error: {
          code: 'EDITOR_NOT_FOUND',
          details: 'Please install VS Code or add it to PATH',
        },
      })
    })

    it('should return 400 if worktree is missing', async () => {
      const error = new EditorOpenError(
        'WORKTREE_MISSING',
        EditorType.VS_CODE,
        'Worktree directory not found',
        'The worktree may have been deleted'
      )

      mockOpenWorktree.mockRejectedValue(error)

      const response = await request(app)
        .post('/api/open-in-ide')
        .send({
          worktreePath: '/test/worktree',
        })

      expect(response.status).toBe(400)
      expect(response.body).toEqual({
        success: false,
        message: 'Worktree directory not found',
        error: {
          code: 'WORKTREE_MISSING',
          details: 'The worktree may have been deleted',
        },
      })
    })

    it('should return 500 if spawn fails', async () => {
      const error = new EditorOpenError(
        'SPAWN_FAILED',
        EditorType.VS_CODE,
        'Failed to spawn editor process',
        'Process exited with code 1'
      )

      mockOpenWorktree.mockRejectedValue(error)

      const response = await request(app)
        .post('/api/open-in-ide')
        .send({
          worktreePath: '/test/worktree',
        })

      expect(response.status).toBe(500)
      expect(response.body).toEqual({
        success: false,
        message: 'Failed to spawn editor process',
        error: {
          code: 'SPAWN_FAILED',
          details: 'Process exited with code 1',
        },
      })
    })

    it('should return 500 for generic errors', async () => {
      const error = new Error('Unexpected error')

      mockOpenWorktree.mockRejectedValue(error)

      const response = await request(app)
        .post('/api/open-in-ide')
        .send({
          worktreePath: '/test/worktree',
        })

      expect(response.status).toBe(500)
      expect(response.body).toEqual({
        success: false,
        message: 'Failed to open worktree in IDE',
        error: {
          code: 'INTERNAL_ERROR',
          details: 'Unexpected error',
        },
      })
    })

    it('should handle non-Error exceptions', async () => {
      const error = 'String error'

      mockOpenWorktree.mockRejectedValue(error)

      const response = await request(app)
        .post('/api/open-in-ide')
        .send({
          worktreePath: '/test/worktree',
        })

      expect(response.status).toBe(500)
      expect(response.body).toEqual({
        success: false,
        message: 'Failed to open worktree in IDE',
        error: {
          code: 'INTERNAL_ERROR',
          details: 'String error',
        },
      })
    })

    it('should handle EditorOpenError without details', async () => {
      const error = new EditorOpenError(
        'EDITOR_NOT_FOUND',
        EditorType.CURSOR,
        'Cursor not found'
        // No details provided
      )

      mockOpenWorktree.mockRejectedValue(error)

      const response = await request(app)
        .post('/api/open-in-ide')
        .send({
          worktreePath: '/test/worktree',
        })

      expect(response.status).toBe(404)
      expect(response.body).toEqual({
        success: false,
        message: 'Cursor not found',
        error: {
          code: 'EDITOR_NOT_FOUND',
          details: '',
        },
      })
    })

    it('should support all editor types via override', async () => {
      const editorTypes = [
        'vs-code',
        'cursor',
        'windsurf',
        'intellij',
        'zed',
        'xcode',
        'custom',
      ]

      mockOpenWorktree.mockResolvedValue(undefined)

      for (const editorType of editorTypes) {
        const response = await request(app)
          .post('/api/open-in-ide')
          .send({
            worktreePath: '/test/worktree',
            editorType,
          })

        expect(response.status).toBe(200)
        expect(mockOpenWorktree).toHaveBeenCalledWith('/test/worktree', editorType)
      }
    })
  })
})
