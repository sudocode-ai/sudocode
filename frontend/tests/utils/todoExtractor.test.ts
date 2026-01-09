/**
 * Tests for todoExtractor utility functions
 *
 * Tests both legacy ToolCallTracking format (buildTodoHistory) and
 * ACP ToolCall format (buildTodoHistoryFromToolCalls) used for Claude Code.
 */

import { describe, it, expect } from 'vitest'
import {
  buildTodoHistory,
  buildTodoHistoryFromToolCalls,
  buildTodoHistoryFromPlanUpdates,
  planEntriesToTodoItems,
} from '@/utils/todoExtractor'
import type { ToolCallTracking } from '@/types/stream'
import type { ToolCall, PlanUpdateEvent, PlanEntry } from '@/hooks/useSessionUpdateStream'

describe('todoExtractor', () => {
  describe('buildTodoHistoryFromToolCalls (ACP format)', () => {
    it('should return empty array for no tool calls', () => {
      const result = buildTodoHistoryFromToolCalls([])
      expect(result).toEqual([])
    })

    it('should return empty array when no TodoWrite/TodoRead calls', () => {
      const toolCalls: ToolCall[] = [
        {
          id: 'tool-1',
          title: 'Bash',
          status: 'success',
          rawInput: { command: 'npm test' },
          timestamp: new Date(1000),
        },
      ]
      const result = buildTodoHistoryFromToolCalls(toolCalls)
      expect(result).toEqual([])
    })

    it('should extract todos from TodoWrite with rawInput as object', () => {
      const toolCalls: ToolCall[] = [
        {
          id: 'tool-1',
          title: 'TodoWrite',
          status: 'success',
          rawInput: {
            todos: [
              { content: 'Task 1', status: 'pending', activeForm: 'Task 1' },
              { content: 'Task 2', status: 'in_progress', activeForm: 'Working on Task 2' },
            ],
          },
          timestamp: new Date(1000),
          completedAt: new Date(1100),
        },
      ]

      const result = buildTodoHistoryFromToolCalls(toolCalls)

      expect(result).toHaveLength(2)
      expect(result[0].content).toBe('Task 1')
      expect(result[0].status).toBe('pending')
      expect(result[1].content).toBe('Task 2')
      expect(result[1].status).toBe('in_progress')
    })

    it('should extract todos from TodoWrite with rawInput as JSON string', () => {
      const toolCalls: ToolCall[] = [
        {
          id: 'tool-1',
          title: 'TodoWrite',
          status: 'success',
          rawInput: JSON.stringify({
            todos: [
              { content: 'Task A', status: 'completed', activeForm: 'Task A done' },
            ],
          }),
          timestamp: new Date(1000),
          completedAt: new Date(1100),
        },
      ]

      const result = buildTodoHistoryFromToolCalls(toolCalls)

      expect(result).toHaveLength(1)
      expect(result[0].content).toBe('Task A')
      expect(result[0].status).toBe('completed')
      expect(result[0].wasCompleted).toBe(true)
    })

    it('should handle nested args format from Claude Code', () => {
      // Claude Code sometimes sends: { args: { todos: [...] } }
      const toolCalls: ToolCall[] = [
        {
          id: 'tool-1',
          title: 'TodoWrite',
          status: 'success',
          rawInput: {
            args: {
              todos: [
                { content: 'Nested task', status: 'pending', activeForm: 'Nested task' },
              ],
            },
          },
          timestamp: new Date(1000),
          completedAt: new Date(1100),
        },
      ]

      const result = buildTodoHistoryFromToolCalls(toolCalls)

      expect(result).toHaveLength(1)
      expect(result[0].content).toBe('Nested task')
    })

    it('should extract todos from TodoRead result', () => {
      const toolCalls: ToolCall[] = [
        {
          id: 'tool-1',
          title: 'TodoRead',
          status: 'success',
          rawInput: {},
          result: {
            todos: [
              { content: 'Read task 1', status: 'pending' },
              { content: 'Read task 2', status: 'completed' },
            ],
          },
          timestamp: new Date(1000),
          completedAt: new Date(1100),
        },
      ]

      const result = buildTodoHistoryFromToolCalls(toolCalls)

      expect(result).toHaveLength(2)
      expect(result[0].content).toBe('Read task 1')
      expect(result[1].content).toBe('Read task 2')
      expect(result[1].wasCompleted).toBe(true)
    })

    it('should use rawOutput as fallback for TodoRead result', () => {
      const toolCalls: ToolCall[] = [
        {
          id: 'tool-1',
          title: 'TodoRead',
          status: 'success',
          rawInput: {},
          rawOutput: {
            todos: [{ content: 'From rawOutput', status: 'pending' }],
          },
          timestamp: new Date(1000),
        },
      ]

      const result = buildTodoHistoryFromToolCalls(toolCalls)

      expect(result).toHaveLength(1)
      expect(result[0].content).toBe('From rawOutput')
    })

    it('should only process completed (success) tool calls', () => {
      const toolCalls: ToolCall[] = [
        {
          id: 'tool-1',
          title: 'TodoWrite',
          status: 'pending', // Not success
          rawInput: { todos: [{ content: 'Pending task', status: 'pending' }] },
          timestamp: new Date(1000),
        },
        {
          id: 'tool-2',
          title: 'TodoWrite',
          status: 'running', // Not success
          rawInput: { todos: [{ content: 'Running task', status: 'pending' }] },
          timestamp: new Date(2000),
        },
        {
          id: 'tool-3',
          title: 'TodoWrite',
          status: 'success', // Only this should be processed
          rawInput: { todos: [{ content: 'Completed task', status: 'pending' }] },
          timestamp: new Date(3000),
          completedAt: new Date(3100),
        },
      ]

      const result = buildTodoHistoryFromToolCalls(toolCalls)

      expect(result).toHaveLength(1)
      expect(result[0].content).toBe('Completed task')
    })

    it('should track todo state changes across multiple writes', () => {
      const toolCalls: ToolCall[] = [
        {
          id: 'tool-1',
          title: 'TodoWrite',
          status: 'success',
          rawInput: {
            todos: [
              { content: 'Task 1', status: 'pending', activeForm: 'Task 1' },
              { content: 'Task 2', status: 'pending', activeForm: 'Task 2' },
            ],
          },
          timestamp: new Date(1000),
          completedAt: new Date(1100),
        },
        {
          id: 'tool-2',
          title: 'TodoWrite',
          status: 'success',
          rawInput: {
            todos: [
              { content: 'Task 1', status: 'completed', activeForm: 'Task 1 done' },
              { content: 'Task 2', status: 'in_progress', activeForm: 'Working on Task 2' },
            ],
          },
          timestamp: new Date(2000),
          completedAt: new Date(2100),
        },
      ]

      const result = buildTodoHistoryFromToolCalls(toolCalls)

      expect(result).toHaveLength(2)
      // Task 1 should be marked as completed
      const task1 = result.find((t) => t.content === 'Task 1')
      expect(task1?.status).toBe('completed')
      expect(task1?.wasCompleted).toBe(true)
      // Task 2 should be in_progress
      const task2 = result.find((t) => t.content === 'Task 2')
      expect(task2?.status).toBe('in_progress')
    })

    it('should mark todos as removed when they disappear from the list', () => {
      const toolCalls: ToolCall[] = [
        {
          id: 'tool-1',
          title: 'TodoWrite',
          status: 'success',
          rawInput: {
            todos: [
              { content: 'Task A', status: 'pending' },
              { content: 'Task B', status: 'pending' },
              { content: 'Task C', status: 'pending' },
            ],
          },
          timestamp: new Date(1000),
          completedAt: new Date(1100),
        },
        {
          id: 'tool-2',
          title: 'TodoWrite',
          status: 'success',
          rawInput: {
            todos: [
              // Task B removed
              { content: 'Task A', status: 'completed' },
              { content: 'Task C', status: 'in_progress' },
            ],
          },
          timestamp: new Date(2000),
          completedAt: new Date(2100),
        },
      ]

      const result = buildTodoHistoryFromToolCalls(toolCalls)

      expect(result).toHaveLength(3)
      const taskB = result.find((t) => t.content === 'Task B')
      expect(taskB?.wasRemoved).toBe(true)
    })

    it('should handle malformed rawInput gracefully', () => {
      const toolCalls: ToolCall[] = [
        {
          id: 'tool-1',
          title: 'TodoWrite',
          status: 'success',
          rawInput: 'not valid json {{',
          timestamp: new Date(1000),
        },
        {
          id: 'tool-2',
          title: 'TodoWrite',
          status: 'success',
          rawInput: { notTodos: [] }, // Missing todos array
          timestamp: new Date(2000),
        },
      ]

      // Should not throw, just return empty
      const result = buildTodoHistoryFromToolCalls(toolCalls)
      expect(result).toEqual([])
    })

    it('should sort tool calls by timestamp before processing', () => {
      const toolCalls: ToolCall[] = [
        {
          id: 'tool-2',
          title: 'TodoWrite',
          status: 'success',
          rawInput: {
            todos: [{ content: 'Task', status: 'completed' }],
          },
          timestamp: new Date(2000), // Later
          completedAt: new Date(2100),
        },
        {
          id: 'tool-1',
          title: 'TodoWrite',
          status: 'success',
          rawInput: {
            todos: [{ content: 'Task', status: 'pending' }],
          },
          timestamp: new Date(1000), // Earlier (but second in array)
          completedAt: new Date(1100),
        },
      ]

      const result = buildTodoHistoryFromToolCalls(toolCalls)

      // Should process in timestamp order, so final state is 'completed'
      expect(result).toHaveLength(1)
      expect(result[0].status).toBe('completed')
    })
  })

  describe('buildTodoHistory (legacy ToolCallTracking format)', () => {
    it('should extract todos from legacy format', () => {
      const toolCalls = new Map<string, ToolCallTracking>([
        [
          'tool-1',
          {
            toolCallId: 'tool-1',
            toolCallName: 'TodoWrite',
            args: JSON.stringify({
              todos: [{ content: 'Legacy task', status: 'pending', activeForm: 'Legacy task' }],
            }),
            status: 'completed',
            result: 'Success',
            startTime: 1000,
            endTime: 1100,
          },
        ],
      ])

      const result = buildTodoHistory(toolCalls)

      expect(result).toHaveLength(1)
      expect(result[0].content).toBe('Legacy task')
    })

    it('should handle nested args structure in legacy format', () => {
      const toolCalls = new Map<string, ToolCallTracking>([
        [
          'tool-1',
          {
            toolCallId: 'tool-1',
            toolCallName: 'TodoWrite',
            args: JSON.stringify({
              toolName: 'TodoWrite',
              args: {
                todos: [{ content: 'Nested legacy', status: 'completed' }],
              },
            }),
            status: 'completed',
            result: 'Success',
            startTime: 1000,
            endTime: 1100,
          },
        ],
      ])

      const result = buildTodoHistory(toolCalls)

      expect(result).toHaveLength(1)
      expect(result[0].content).toBe('Nested legacy')
      expect(result[0].wasCompleted).toBe(true)
    })
  })

  describe('buildTodoHistoryFromPlanUpdates (ACP plan session updates)', () => {
    it('should return empty array for no plan updates', () => {
      const result = buildTodoHistoryFromPlanUpdates([])
      expect(result).toEqual([])
    })

    it('should extract todos from a single plan update', () => {
      const planUpdates: PlanUpdateEvent[] = [
        {
          id: 'plan-1',
          entries: [
            { content: 'Task 1', status: 'pending', priority: 'high' },
            { content: 'Task 2', status: 'in_progress', priority: 'medium' },
            { content: 'Task 3', status: 'completed', priority: 'low' },
          ],
          timestamp: new Date(1000),
        },
      ]

      const result = buildTodoHistoryFromPlanUpdates(planUpdates)

      expect(result).toHaveLength(3)
      expect(result[0].content).toBe('Task 1')
      expect(result[0].status).toBe('pending')
      expect(result[1].content).toBe('Task 2')
      expect(result[1].status).toBe('in_progress')
      expect(result[2].content).toBe('Task 3')
      expect(result[2].status).toBe('completed')
      expect(result[2].wasCompleted).toBe(true)
    })

    it('should track todo state changes across multiple plan updates', () => {
      const planUpdates: PlanUpdateEvent[] = [
        {
          id: 'plan-1',
          entries: [
            { content: 'Task A', status: 'pending', priority: 'high' },
            { content: 'Task B', status: 'pending', priority: 'medium' },
          ],
          timestamp: new Date(1000),
        },
        {
          id: 'plan-2',
          entries: [
            { content: 'Task A', status: 'completed', priority: 'high' },
            { content: 'Task B', status: 'in_progress', priority: 'medium' },
          ],
          timestamp: new Date(2000),
        },
      ]

      const result = buildTodoHistoryFromPlanUpdates(planUpdates)

      expect(result).toHaveLength(2)
      const taskA = result.find((t) => t.content === 'Task A')
      expect(taskA?.status).toBe('completed')
      expect(taskA?.wasCompleted).toBe(true)
      const taskB = result.find((t) => t.content === 'Task B')
      expect(taskB?.status).toBe('in_progress')
    })

    it('should mark todos as removed when they disappear from plan', () => {
      const planUpdates: PlanUpdateEvent[] = [
        {
          id: 'plan-1',
          entries: [
            { content: 'Task X', status: 'pending', priority: 'high' },
            { content: 'Task Y', status: 'pending', priority: 'medium' },
            { content: 'Task Z', status: 'pending', priority: 'low' },
          ],
          timestamp: new Date(1000),
        },
        {
          id: 'plan-2',
          entries: [
            // Task Y removed
            { content: 'Task X', status: 'completed', priority: 'high' },
            { content: 'Task Z', status: 'in_progress', priority: 'low' },
          ],
          timestamp: new Date(2000),
        },
      ]

      const result = buildTodoHistoryFromPlanUpdates(planUpdates)

      expect(result).toHaveLength(3)
      const taskY = result.find((t) => t.content === 'Task Y')
      expect(taskY?.wasRemoved).toBe(true)
    })

    it('should un-mark todo as removed if it reappears', () => {
      const planUpdates: PlanUpdateEvent[] = [
        {
          id: 'plan-1',
          entries: [{ content: 'Task', status: 'pending', priority: 'high' }],
          timestamp: new Date(1000),
        },
        {
          id: 'plan-2',
          entries: [], // Task removed
          timestamp: new Date(2000),
        },
        {
          id: 'plan-3',
          entries: [{ content: 'Task', status: 'in_progress', priority: 'high' }], // Task reappears
          timestamp: new Date(3000),
        },
      ]

      const result = buildTodoHistoryFromPlanUpdates(planUpdates)

      expect(result).toHaveLength(1)
      expect(result[0].wasRemoved).toBe(false)
      expect(result[0].status).toBe('in_progress')
    })

    it('should sort plan updates by timestamp before processing', () => {
      const planUpdates: PlanUpdateEvent[] = [
        {
          id: 'plan-2',
          entries: [{ content: 'Task', status: 'completed', priority: 'high' }],
          timestamp: new Date(2000), // Later
        },
        {
          id: 'plan-1',
          entries: [{ content: 'Task', status: 'pending', priority: 'high' }],
          timestamp: new Date(1000), // Earlier (but second in array)
        },
      ]

      const result = buildTodoHistoryFromPlanUpdates(planUpdates)

      // Should process in timestamp order, so final state is 'completed'
      expect(result).toHaveLength(1)
      expect(result[0].status).toBe('completed')
    })

    it('should handle timestamp as string (from logs)', () => {
      const planUpdates = [
        {
          id: 'plan-1',
          entries: [{ content: 'Task', status: 'pending' as const, priority: 'high' as const }],
          timestamp: '2024-01-01T00:00:00.000Z', // String timestamp
        },
      ]

      // Cast via unknown since string timestamp is intentional for this test
      const result = buildTodoHistoryFromPlanUpdates(planUpdates as unknown as PlanUpdateEvent[])

      expect(result).toHaveLength(1)
      expect(result[0].content).toBe('Task')
    })

    it('should skip plan updates with empty entries', () => {
      const planUpdates: PlanUpdateEvent[] = [
        {
          id: 'plan-1',
          entries: [],
          timestamp: new Date(1000),
        },
        {
          id: 'plan-2',
          entries: [{ content: 'Task', status: 'pending', priority: 'high' }],
          timestamp: new Date(2000),
        },
      ]

      const result = buildTodoHistoryFromPlanUpdates(planUpdates)

      expect(result).toHaveLength(1)
      expect(result[0].content).toBe('Task')
    })
  })

  describe('planEntriesToTodoItems', () => {
    it('should return empty array for null input', () => {
      const result = planEntriesToTodoItems(null)
      expect(result).toEqual([])
    })

    it('should convert plan entries to todo items', () => {
      const entries: PlanEntry[] = [
        { content: 'Task 1', status: 'pending', priority: 'high' },
        { content: 'Task 2', status: 'completed', priority: 'low' },
      ]

      const result = planEntriesToTodoItems(entries)

      expect(result).toHaveLength(2)
      expect(result[0].content).toBe('Task 1')
      expect(result[0].status).toBe('pending')
      expect(result[0].wasCompleted).toBe(false)
      expect(result[1].content).toBe('Task 2')
      expect(result[1].status).toBe('completed')
      expect(result[1].wasCompleted).toBe(true)
    })
  })
})
