import { describe, it, expect } from 'vitest'
import { findLatestExecutionInChain } from '@/utils/executions'
import type { Execution } from '@/types/execution'

// Helper to create a mock execution
const createExecution = (
  id: string,
  parent_execution_id: string | null = null,
  created_at: string = new Date().toISOString()
): Partial<Execution> => ({
  id,
  parent_execution_id,
  created_at,
  status: 'completed',
  issue_id: 'i-test',
  mode: 'worktree',
  target_branch: 'main',
})

describe('findLatestExecutionInChain', () => {
  it('should return null for empty array', () => {
    const result = findLatestExecutionInChain([] as Execution[])
    expect(result).toBeNull()
  })

  it('should return single execution when only one exists', () => {
    const exec = createExecution('exec-1')
    const result = findLatestExecutionInChain([exec as Execution])
    expect(result).toEqual(exec)
  })

  it('should return most recent root execution when multiple roots exist', () => {
    const exec1 = createExecution('exec-1', null, '2024-01-01T10:00:00Z')
    const exec2 = createExecution('exec-2', null, '2024-01-01T11:00:00Z')
    const exec3 = createExecution('exec-3', null, '2024-01-01T09:00:00Z')

    const result = findLatestExecutionInChain([exec1, exec2, exec3] as Execution[])
    expect(result?.id).toBe('exec-2')
  })

  it('should follow a simple chain to the end (A -> B)', () => {
    const execA = createExecution('exec-a', null, '2024-01-01T10:00:00Z')
    const execB = createExecution('exec-b', 'exec-a', '2024-01-01T11:00:00Z')

    const result = findLatestExecutionInChain([execA, execB] as Execution[])
    expect(result?.id).toBe('exec-b')
  })

  it('should follow a deep chain to the end (A -> B -> C)', () => {
    const execA = createExecution('exec-a', null, '2024-01-01T10:00:00Z')
    const execB = createExecution('exec-b', 'exec-a', '2024-01-01T11:00:00Z')
    const execC = createExecution('exec-c', 'exec-b', '2024-01-01T12:00:00Z')

    const result = findLatestExecutionInChain([execA, execB, execC] as Execution[])
    expect(result?.id).toBe('exec-c')
  })

  it('should follow a very deep chain (A -> B -> C -> D -> E)', () => {
    const execA = createExecution('exec-a', null, '2024-01-01T10:00:00Z')
    const execB = createExecution('exec-b', 'exec-a', '2024-01-01T11:00:00Z')
    const execC = createExecution('exec-c', 'exec-b', '2024-01-01T12:00:00Z')
    const execD = createExecution('exec-d', 'exec-c', '2024-01-01T13:00:00Z')
    const execE = createExecution('exec-e', 'exec-d', '2024-01-01T14:00:00Z')

    const result = findLatestExecutionInChain([execA, execB, execC, execD, execE] as Execution[])
    expect(result?.id).toBe('exec-e')
  })

  it('should handle multiple independent chains and return the latest overall', () => {
    // Chain 1: A -> B (B created at 11:00)
    const execA = createExecution('exec-a', null, '2024-01-01T10:00:00Z')
    const execB = createExecution('exec-b', 'exec-a', '2024-01-01T11:00:00Z')

    // Chain 2: C -> D (D created at 13:00, latest)
    const execC = createExecution('exec-c', null, '2024-01-01T10:30:00Z')
    const execD = createExecution('exec-d', 'exec-c', '2024-01-01T13:00:00Z')

    // Chain 3: E -> F (F created at 12:00)
    const execE = createExecution('exec-e', null, '2024-01-01T09:00:00Z')
    const execF = createExecution('exec-f', 'exec-e', '2024-01-01T12:00:00Z')

    const result = findLatestExecutionInChain([
      execA,
      execB,
      execC,
      execD,
      execE,
      execF,
    ] as Execution[])
    expect(result?.id).toBe('exec-d')
  })

  it('should follow most recent child when execution has multiple children', () => {
    // A has two children: B (11:00) and C (12:00)
    // Should follow C since it's more recent
    const execA = createExecution('exec-a', null, '2024-01-01T10:00:00Z')
    const execB = createExecution('exec-b', 'exec-a', '2024-01-01T11:00:00Z')
    const execC = createExecution('exec-c', 'exec-a', '2024-01-01T12:00:00Z')

    const result = findLatestExecutionInChain([execA, execB, execC] as Execution[])
    expect(result?.id).toBe('exec-c')
  })

  it('should follow most recent child in branching chain (A -> B/C, C -> D)', () => {
    // A has two children: B (11:00) and C (12:00)
    // C has child D (13:00)
    // Should follow A -> C -> D
    const execA = createExecution('exec-a', null, '2024-01-01T10:00:00Z')
    const execB = createExecution('exec-b', 'exec-a', '2024-01-01T11:00:00Z')
    const execC = createExecution('exec-c', 'exec-a', '2024-01-01T12:00:00Z')
    const execD = createExecution('exec-d', 'exec-c', '2024-01-01T13:00:00Z')

    const result = findLatestExecutionInChain([execA, execB, execC, execD] as Execution[])
    expect(result?.id).toBe('exec-d')
  })

  it('should handle complex branching with multiple paths', () => {
    // Root A has two branches:
    //   A -> B -> D
    //   A -> C -> E -> F (most recent at 15:00)
    const execA = createExecution('exec-a', null, '2024-01-01T10:00:00Z')
    const execB = createExecution('exec-b', 'exec-a', '2024-01-01T11:00:00Z')
    const execC = createExecution('exec-c', 'exec-a', '2024-01-01T11:30:00Z')
    const execD = createExecution('exec-d', 'exec-b', '2024-01-01T12:00:00Z')
    const execE = createExecution('exec-e', 'exec-c', '2024-01-01T13:00:00Z')
    const execF = createExecution('exec-f', 'exec-e', '2024-01-01T15:00:00Z')

    const result = findLatestExecutionInChain([
      execA,
      execB,
      execC,
      execD,
      execE,
      execF,
    ] as Execution[])
    expect(result?.id).toBe('exec-f')
  })

  it('should handle unordered input array', () => {
    // Input array is not in chronological order
    const execC = createExecution('exec-c', 'exec-b', '2024-01-01T12:00:00Z')
    const execA = createExecution('exec-a', null, '2024-01-01T10:00:00Z')
    const execB = createExecution('exec-b', 'exec-a', '2024-01-01T11:00:00Z')

    const result = findLatestExecutionInChain([execC, execA, execB] as Execution[])
    expect(result?.id).toBe('exec-c')
  })

  it('should handle execution with same timestamps by picking one consistently', () => {
    const timestamp = '2024-01-01T10:00:00Z'
    const exec1 = createExecution('exec-1', null, timestamp)
    const exec2 = createExecution('exec-2', null, timestamp)

    const result = findLatestExecutionInChain([exec1, exec2] as Execution[])
    // Should return one of them consistently (either is valid)
    expect(result?.id).toBeTruthy()
    expect(['exec-1', 'exec-2']).toContain(result?.id)
  })

  it('should return the latest leaf node across multiple chains with different depths', () => {
    // Chain 1: A -> B -> C (3 levels, C at 14:00)
    const execA = createExecution('exec-a', null, '2024-01-01T10:00:00Z')
    const execB = createExecution('exec-b', 'exec-a', '2024-01-01T12:00:00Z')
    const execC = createExecution('exec-c', 'exec-b', '2024-01-01T14:00:00Z')

    // Chain 2: D (1 level, D at 15:00, latest)
    const execD = createExecution('exec-d', null, '2024-01-01T15:00:00Z')

    // Chain 3: E -> F (2 levels, F at 13:00)
    const execE = createExecution('exec-e', null, '2024-01-01T11:00:00Z')
    const execF = createExecution('exec-f', 'exec-e', '2024-01-01T13:00:00Z')

    const result = findLatestExecutionInChain([
      execA,
      execB,
      execC,
      execD,
      execE,
      execF,
    ] as Execution[])
    expect(result?.id).toBe('exec-d')
  })

  it('should preserve execution properties when returning result', () => {
    const exec = createExecution('exec-1', null, '2024-01-01T10:00:00Z')
    exec.status = 'failed'
    exec.mode = 'local'

    const result = findLatestExecutionInChain([exec as Execution])
    expect(result?.status).toBe('failed')
    expect(result?.mode).toBe('local')
    expect(result?.issue_id).toBe('i-test')
  })
})
