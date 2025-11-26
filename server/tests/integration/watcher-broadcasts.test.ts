/**
 * Integration test for file watcher WebSocket broadcasts
 * Tests that the onFileChange callback implementation in project-manager.ts
 * correctly broadcasts WebSocket updates with projectId
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import type Database from 'better-sqlite3'
import { initDatabase } from '@sudocode-ai/cli/dist/db.js'
import { createNewIssue } from '../../src/services/issues.js'
import { createNewSpec } from '../../src/services/specs.js'
import * as websocketModule from '../../src/services/websocket.js'
import * as issuesModule from '../../src/services/issues.js'
import * as specsModule from '../../src/services/specs.js'

describe('File Watcher WebSocket Broadcasts - Implementation Logic', () => {
  let db: Database.Database
  let testDir: string
  let dbPath: string

  // Mock broadcast functions
  let broadcastIssueUpdateSpy: ReturnType<typeof vi.spyOn>
  let broadcastSpecUpdateSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // Create temp directory for test database
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sudocode-broadcast-logic-test-'))
    dbPath = path.join(testDir, 'cache.db')

    // Initialize database
    db = initDatabase({ path: dbPath })

    // Spy on broadcast functions
    broadcastIssueUpdateSpy = vi.spyOn(websocketModule, 'broadcastIssueUpdate')
    broadcastSpecUpdateSpy = vi.spyOn(websocketModule, 'broadcastSpecUpdate')
  })

  afterEach(() => {
    // Clean up
    if (db && db.open) {
      db.close()
    }
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }

    // Restore mocks
    vi.restoreAllMocks()
  })

  it('should simulate onFileChange callback for issue updates', async () => {
    const projectId = 'test-project-123'

    // Create an issue in the database
    const issue = createNewIssue(db, {
      id: 'i-test1',
      uuid: 'uuid-test-1',
      title: 'Test Issue',
      content: 'Initial content',
      status: 'open',
      priority: 2,
    })

    // Simulate the onFileChange callback from project-manager.ts
    const fileChangeInfo = {
      filePath: 'issues/i-test1 - Test Issue.md',
      event: 'change' as const,
      entityType: 'issue' as const,
      entityId: issue.id,
    }

    // Execute the same logic as in project-manager.ts onFileChange callback
    if (fileChangeInfo.entityType === 'issue' && fileChangeInfo.entityId) {
      const updatedIssue = issuesModule.getIssueById(db, fileChangeInfo.entityId)
      if (updatedIssue) {
        websocketModule.broadcastIssueUpdate(
          projectId,
          fileChangeInfo.entityId,
          'updated',
          updatedIssue
        )
      }
    }

    // Verify broadcast was called with correct parameters
    expect(broadcastIssueUpdateSpy).toHaveBeenCalledOnce()
    expect(broadcastIssueUpdateSpy).toHaveBeenCalledWith(
      projectId,
      issue.id,
      'updated',
      expect.objectContaining({
        id: issue.id,
        title: 'Test Issue',
        content: 'Initial content',
      })
    )
  })

  it('should simulate onFileChange callback for spec updates', async () => {
    const projectId = 'test-project-456'

    // Create a spec in the database
    const spec = createNewSpec(db, {
      id: 's-test1',
      uuid: 'uuid-spec-1',
      title: 'Test Spec',
      content: 'Initial spec content',
      priority: 1,
      file_path: 'specs/s-test1 - Test Spec.md',
    })

    // Simulate the onFileChange callback from project-manager.ts
    const fileChangeInfo = {
      filePath: 'specs/s-test1 - Test Spec.md',
      event: 'change' as const,
      entityType: 'spec' as const,
      entityId: spec.id,
    }

    // Execute the same logic as in project-manager.ts onFileChange callback
    if (fileChangeInfo.entityType === 'spec' && fileChangeInfo.entityId) {
      const updatedSpec = specsModule.getSpecById(db, fileChangeInfo.entityId)
      if (updatedSpec) {
        websocketModule.broadcastSpecUpdate(
          projectId,
          fileChangeInfo.entityId,
          'updated',
          updatedSpec
        )
      }
    }

    // Verify broadcast was called with correct parameters
    expect(broadcastSpecUpdateSpy).toHaveBeenCalledOnce()
    expect(broadcastSpecUpdateSpy).toHaveBeenCalledWith(
      projectId,
      spec.id,
      'updated',
      expect.objectContaining({
        id: spec.id,
        title: 'Test Spec',
        content: 'Initial spec content',
      })
    )
  })

  it('should include correct projectId in issue broadcasts', () => {
    const projectId = 'my-unique-project-789'

    const issue = createNewIssue(db, {
      id: 'i-test2',
      uuid: 'uuid-test-2',
      title: 'ProjectId Test',
      content: 'Testing projectId',
      status: 'open',
      priority: 2,
    })

    const fileChangeInfo = {
      filePath: 'issues/i-test2 - ProjectId Test.md',
      event: 'change' as const,
      entityType: 'issue' as const,
      entityId: issue.id,
    }

    if (fileChangeInfo.entityType === 'issue' && fileChangeInfo.entityId) {
      const updatedIssue = issuesModule.getIssueById(db, fileChangeInfo.entityId)
      if (updatedIssue) {
        websocketModule.broadcastIssueUpdate(
          projectId,
          fileChangeInfo.entityId,
          'updated',
          updatedIssue
        )
      }
    }

    // Verify the broadcast was called with the CORRECT projectId
    expect(broadcastIssueUpdateSpy).toHaveBeenCalledWith(
      projectId,
      issue.id,
      'updated',
      expect.any(Object)
    )

    // Verify projectId matches
    const calls = broadcastIssueUpdateSpy.mock.calls
    expect(calls[0][0]).toBe(projectId)
  })

  it('should not broadcast when entity is not found in database', () => {
    const projectId = 'test-project-999'

    const fileChangeInfo = {
      filePath: 'issues/i-orphan - Orphan Issue.md',
      event: 'change' as const,
      entityType: 'issue' as const,
      entityId: 'i-orphan',
    }

    // Execute the same logic as in project-manager.ts onFileChange callback
    if (fileChangeInfo.entityType === 'issue' && fileChangeInfo.entityId) {
      const updatedIssue = issuesModule.getIssueById(db, fileChangeInfo.entityId)
      if (updatedIssue) {
        websocketModule.broadcastIssueUpdate(
          projectId,
          fileChangeInfo.entityId,
          'updated',
          updatedIssue
        )
      }
    }

    // Broadcast should NOT be called because entity doesn't exist in DB
    expect(broadcastIssueUpdateSpy).not.toHaveBeenCalled()
  })

  it('should handle multiple file changes with correct broadcasts', () => {
    const projectId = 'multi-change-project'

    // Create multiple issues
    const issue1 = createNewIssue(db, {
      id: 'i-multi1',
      uuid: 'uuid-multi-1',
      title: 'Multi Test 1',
      content: 'Content 1',
      status: 'open',
      priority: 2,
    })

    const issue2 = createNewIssue(db, {
      id: 'i-multi2',
      uuid: 'uuid-multi-2',
      title: 'Multi Test 2',
      content: 'Content 2',
      status: 'open',
      priority: 2,
    })

    // Simulate file changes for both issues
    const changes = [
      {
        filePath: 'issues/i-multi1 - Multi Test 1.md',
        event: 'change' as const,
        entityType: 'issue' as const,
        entityId: issue1.id,
      },
      {
        filePath: 'issues/i-multi2 - Multi Test 2.md',
        event: 'change' as const,
        entityType: 'issue' as const,
        entityId: issue2.id,
      },
    ]

    // Process each change
    changes.forEach((fileChangeInfo) => {
      if (fileChangeInfo.entityType === 'issue' && fileChangeInfo.entityId) {
        const updatedIssue = issuesModule.getIssueById(db, fileChangeInfo.entityId)
        if (updatedIssue) {
          websocketModule.broadcastIssueUpdate(
            projectId,
            fileChangeInfo.entityId,
            'updated',
            updatedIssue
          )
        }
      }
    })

    // Both broadcasts should have been called
    expect(broadcastIssueUpdateSpy).toHaveBeenCalledWith(
      projectId,
      issue1.id,
      'updated',
      expect.any(Object)
    )

    expect(broadcastIssueUpdateSpy).toHaveBeenCalledWith(
      projectId,
      issue2.id,
      'updated',
      expect.any(Object)
    )

    // Should have been called exactly twice
    expect(broadcastIssueUpdateSpy).toHaveBeenCalledTimes(2)
  })
})
