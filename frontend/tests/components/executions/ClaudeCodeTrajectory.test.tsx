/**
 * Tests for ClaudeCodeTrajectory component
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ClaudeCodeTrajectory } from '@/components/executions/ClaudeCodeTrajectory'
import type { MessageBuffer, ToolCallTracking } from '@/hooks/useAgUiStream'

describe('ClaudeCodeTrajectory', () => {
  it('should render messages in chronological order', () => {
    const messages = new Map<string, MessageBuffer>([
      [
        'msg-1',
        {
          messageId: 'msg-1',
          role: 'assistant',
          content: 'First message',
          complete: true,
          timestamp: 1000,
          index: 0,
        },
      ],
      [
        'msg-2',
        {
          messageId: 'msg-2',
          role: 'assistant',
          content: 'Second message',
          complete: true,
          timestamp: 2000,
          index: 1,
        },
      ],
    ])

    render(<ClaudeCodeTrajectory messages={messages} toolCalls={new Map()} />)

    const messageElements = screen.getAllByText(/message/)
    expect(messageElements[0].textContent).toContain('First')
    expect(messageElements[1].textContent).toContain('Second')
  })

  it('should render messages with dot indicator', () => {
    const messages = new Map<string, MessageBuffer>([
      [
        'msg-1',
        {
          messageId: 'msg-1',
          role: 'assistant',
          content: "Let me think about this problem...",
          complete: true,
          timestamp: 1000,
          index: 0,
        },
      ],
    ])

    const { container } = render(<ClaudeCodeTrajectory messages={messages} toolCalls={new Map()} />)

    // Should have the message content
    expect(screen.getByText(/Let me think/)).toBeInTheDocument()
    // Should have the dot indicator (⏺)
    expect(container.textContent).toContain('⏺')
  })

  it('should render tool calls in terminal style', () => {
    const toolCalls = new Map<string, ToolCallTracking>([
      [
        'tool-1',
        {
          toolCallId: 'tool-1',
          toolCallName: 'Bash',
          args: JSON.stringify({ command: 'npm test', description: 'Running tests' }),
          status: 'completed',
          result: 'Tests passed',
          startTime: 1000,
          endTime: 2000,
          index: 0,
        },
      ],
    ])

    const { container } = render(<ClaudeCodeTrajectory messages={new Map()} toolCalls={toolCalls} />)

    expect(screen.getByText('Bash')).toBeInTheDocument()
    expect(screen.getByText('1.00s')).toBeInTheDocument()
    // Should have green dot for completed tool (⏺)
    expect(container.querySelector('.text-green-600')).toBeInTheDocument()
    // Should have branch character (∟)
    expect(container.textContent).toContain('∟')
    // Result should show preview (first 2 lines) by default
    expect(screen.getByText('Tests passed')).toBeInTheDocument()
  })

  it('should show tool args inline with preview', () => {
    const toolCalls = new Map<string, ToolCallTracking>([
      [
        'tool-1',
        {
          toolCallId: 'tool-1',
          toolCallName: 'Read',
          args: JSON.stringify({ file_path: '/test.ts', description: 'Reading test file' }, null, 2),
          status: 'completed',
          result: 'file contents...',
          startTime: 1000,
          endTime: 1500,
          index: 0,
        },
      ],
    ])

    const { container } = render(<ClaudeCodeTrajectory messages={new Map()} toolCalls={toolCalls} />)

    expect(screen.getByText('Read')).toBeInTheDocument()
    // Should show inline args summary
    expect(screen.getAllByText(/\/test\.ts/)[0]).toBeInTheDocument()
    // Should show preview of args (first 2 lines) in pre element
    const preElements = container.querySelectorAll('pre')
    expect(preElements.length).toBeGreaterThan(0)
    expect(preElements[0].textContent).toContain('file_path')
    // Should have expand button for remaining lines
    expect(screen.getByText(/\+2 more lines/)).toBeInTheDocument()
  })

  it('should interleave messages and tool calls chronologically', () => {
    const messages = new Map<string, MessageBuffer>([
      [
        'msg-1',
        {
          messageId: 'msg-1',
          role: 'assistant',
          content: 'First message',
          complete: true,
          timestamp: 1000,
          index: 0,
        },
      ],
      [
        'msg-2',
        {
          messageId: 'msg-2',
          role: 'assistant',
          content: 'Third item',
          complete: true,
          timestamp: 3000,
          index: 2,
        },
      ],
    ])

    const toolCalls = new Map<string, ToolCallTracking>([
      [
        'tool-1',
        {
          toolCallId: 'tool-1',
          toolCallName: 'Bash',
          args: '{"command":"echo test"}',
          status: 'completed',
          startTime: 2000,
          endTime: 2500,
          index: 1,
        },
      ],
    ])

    const { container } = render(
      <ClaudeCodeTrajectory messages={messages} toolCalls={toolCalls} />
    )

    // Verify they appear in timestamp order by checking group divs
    const items = container.querySelectorAll('.group')
    expect(items).toHaveLength(3)
  })

  it('should handle streaming messages', () => {
    const messages = new Map<string, MessageBuffer>([
      [
        'msg-1',
        {
          messageId: 'msg-1',
          role: 'assistant',
          content: 'Streaming...',
          complete: false, // Still streaming
          timestamp: 1000,
          index: 0,
        },
      ],
    ])

    const { container } = render(<ClaudeCodeTrajectory messages={messages} toolCalls={new Map()} />)

    // Should show loading indicator (Loader2 spinner) for incomplete messages
    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('should render markdown in messages by default', () => {
    const messages = new Map<string, MessageBuffer>([
      [
        'msg-1',
        {
          messageId: 'msg-1',
          role: 'assistant',
          content: '# Heading\n\nThis is **bold** text with `code`.',
          complete: true,
          timestamp: 1000,
          index: 0,
        },
      ],
    ])

    const { container } = render(
      <ClaudeCodeTrajectory messages={messages} toolCalls={new Map()} />
    )

    // Check for markdown elements
    expect(container.querySelector('h1')).toBeInTheDocument()
    expect(container.querySelector('strong')).toBeInTheDocument()
    expect(container.querySelector('code')).toBeInTheDocument()
  })

  it('should disable markdown rendering when renderMarkdown=false', () => {
    const messages = new Map<string, MessageBuffer>([
      [
        'msg-1',
        {
          messageId: 'msg-1',
          role: 'assistant',
          content: '# Heading\n\nThis is **bold** text.',
          complete: true,
          timestamp: 1000,
          index: 0,
        },
      ],
    ])

    const { container } = render(
      <ClaudeCodeTrajectory messages={messages} toolCalls={new Map()} renderMarkdown={false} />
    )

    // Should not have markdown elements
    expect(container.querySelector('h1')).not.toBeInTheDocument()
    expect(container.querySelector('strong')).not.toBeInTheDocument()
  })

  it('should handle empty trajectory', () => {
    const { container } = render(
      <ClaudeCodeTrajectory messages={new Map()} toolCalls={new Map()} />
    )

    expect(container.firstChild).toBeNull()
  })

  it('should show tool errors with proper styling', () => {
    const toolCalls = new Map<string, ToolCallTracking>([
      [
        'tool-1',
        {
          toolCallId: 'tool-1',
          toolCallName: 'Bash',
          args: '{"command":"bad-command"}',
          status: 'error',
          error: 'Command not found',
          startTime: 1000,
          endTime: 1100,
          index: 0,
        },
      ],
    ])

    const { container } = render(<ClaudeCodeTrajectory messages={new Map()} toolCalls={toolCalls} />)

    expect(screen.getByText(/Command not found/)).toBeInTheDocument()
    // Should have red dot for error (⏺)
    expect(container.querySelector('.text-red-600')).toBeInTheDocument()
  })

  it('should render all message patterns with terminal style', () => {
    const messages = new Map<string, MessageBuffer>([
      [
        'msg-1',
        {
          messageId: 'msg-1',
          role: 'assistant',
          content: "Let me think about this...",
          complete: true,
          timestamp: 1000,
          index: 0,
        },
      ],
      [
        'msg-2',
        {
          messageId: 'msg-2',
          role: 'assistant',
          content: "I'll start by checking the files",
          complete: true,
          timestamp: 2000,
          index: 1,
        },
      ],
    ])

    const { container } = render(
      <ClaudeCodeTrajectory messages={messages} toolCalls={new Map()} />
    )

    // Both messages should have dot indicators (⏺)
    expect(container.textContent?.match(/⏺/g)?.length).toBeGreaterThanOrEqual(2)

    // Both message contents should be present
    expect(screen.getByText(/Let me think/)).toBeInTheDocument()
    expect(screen.getByText(/I'll start by checking/)).toBeInTheDocument()
  })

  it('should show Read tool result summary', () => {
    const toolCalls = new Map<string, ToolCallTracking>([
      [
        'tool-1',
        {
          toolCallId: 'tool-1',
          toolCallName: 'Read',
          args: JSON.stringify({ file_path: '/test.ts' }),
          status: 'completed',
          result: 'line 1\nline 2\nline 3\nline 4\nline 5',
          startTime: 1000,
          endTime: 1500,
          index: 0,
        },
      ],
    ])

    render(<ClaudeCodeTrajectory messages={new Map()} toolCalls={toolCalls} />)

    // Should show "Read N lines" summary
    expect(screen.getByText(/Read 5 lines/)).toBeInTheDocument()
  })

  it('should show Search tool result summary', () => {
    const toolCalls = new Map<string, ToolCallTracking>([
      [
        'tool-1',
        {
          toolCallId: 'tool-1',
          toolCallName: 'Search',
          args: JSON.stringify({ pattern: 'test', path: '/src', output_mode: 'files' }),
          status: 'completed',
          result: 'file1.ts\nfile2.ts\nfile3.ts',
          startTime: 1000,
          endTime: 1500,
          index: 0,
        },
      ],
    ])

    render(<ClaudeCodeTrajectory messages={new Map()} toolCalls={toolCalls} />)

    // Should show Search args inline
    expect(screen.getByText(/pattern: "test"/)).toBeInTheDocument()

    // Should show "Found N matches" summary
    expect(screen.getByText(/Found 3 matches/)).toBeInTheDocument()
  })

  it('should show Grep tool result summary', () => {
    const toolCalls = new Map<string, ToolCallTracking>([
      [
        'tool-1',
        {
          toolCallId: 'tool-1',
          toolCallName: 'Grep',
          args: JSON.stringify({ pattern: 'function', path: '/src/app.ts', output_mode: 'content' }),
          status: 'completed',
          result: 'function foo() {}\nfunction bar() {}',
          startTime: 1000,
          endTime: 1500,
          index: 0,
        },
      ],
    ])

    render(<ClaudeCodeTrajectory messages={new Map()} toolCalls={toolCalls} />)

    // Should show Grep args inline with all fields
    expect(screen.getByText(/pattern: "function"/)).toBeInTheDocument()
    expect(screen.getByText(/path: "\/src\/app\.ts"/)).toBeInTheDocument()
    expect(screen.getByText(/output_mode: "content"/)).toBeInTheDocument()

    // Should show "Found N matches" summary
    expect(screen.getByText(/Found 2 matches/)).toBeInTheDocument()
  })

  it('should show Bash success indicators in results', () => {
    const toolCalls = new Map<string, ToolCallTracking>([
      [
        'tool-1',
        {
          toolCallId: 'tool-1',
          toolCallName: 'Bash',
          args: JSON.stringify({ command: 'npm test' }),
          status: 'completed',
          result: 'Running tests...\n✓ All tests passed\nTests:  10 passed, 10 total',
          startTime: 1000,
          endTime: 2000,
          index: 0,
        },
      ],
    ])

    render(<ClaudeCodeTrajectory messages={new Map()} toolCalls={toolCalls} />)

    // Should show the success line with checkmark
    expect(screen.getByText(/✓ All tests passed/)).toBeInTheDocument()
  })

  it('should show Write tool formatting', () => {
    const toolCalls = new Map<string, ToolCallTracking>([
      [
        'tool-1',
        {
          toolCallId: 'tool-1',
          toolCallName: 'Write',
          args: JSON.stringify({ file_path: '/src/app.ts', content: 'console.log("hello")' }),
          status: 'completed',
          result: 'File written successfully',
          startTime: 1000,
          endTime: 1200,
          index: 0,
        },
      ],
    ])

    render(<ClaudeCodeTrajectory messages={new Map()} toolCalls={toolCalls} />)

    // Should show file path inline (appears in both the inline summary and args preview)
    const filePathElements = screen.getAllByText(/\/src\/app\.ts/)
    expect(filePathElements.length).toBeGreaterThan(0)
    // Should show success summary
    expect(screen.getByText(/File written successfully/)).toBeInTheDocument()
  })

  it('should show Edit tool formatting', () => {
    const toolCalls = new Map<string, ToolCallTracking>([
      [
        'tool-1',
        {
          toolCallId: 'tool-1',
          toolCallName: 'Edit',
          args: JSON.stringify({ file_path: '/src/utils.ts', old_string: 'foo', new_string: 'bar' }),
          status: 'completed',
          result: 'File edited successfully',
          startTime: 1000,
          endTime: 1200,
          index: 0,
        },
      ],
    ])

    render(<ClaudeCodeTrajectory messages={new Map()} toolCalls={toolCalls} />)

    // Should show file path inline (appears in both the inline summary and args preview)
    const filePathElements = screen.getAllByText(/\/src\/utils\.ts/)
    expect(filePathElements.length).toBeGreaterThan(0)
    // Should show success summary
    expect(screen.getByText(/File edited successfully/)).toBeInTheDocument()
  })

  it('should show Glob tool formatting', () => {
    const toolCalls = new Map<string, ToolCallTracking>([
      [
        'tool-1',
        {
          toolCallId: 'tool-1',
          toolCallName: 'Glob',
          args: JSON.stringify({ pattern: '**/*.ts', path: '/src' }),
          status: 'completed',
          result: 'file1.ts\nfile2.ts\nfile3.ts\nfile4.ts\nfile5.ts',
          startTime: 1000,
          endTime: 1200,
          index: 0,
        },
      ],
    ])

    render(<ClaudeCodeTrajectory messages={new Map()} toolCalls={toolCalls} />)

    // Should show pattern inline
    expect(screen.getByText(/pattern: "\*\*\/\*\.ts"/)).toBeInTheDocument()
    // Should show file count summary
    expect(screen.getByText(/Found 5 files/)).toBeInTheDocument()
  })

  it('should show WebSearch tool formatting', () => {
    const toolCalls = new Map<string, ToolCallTracking>([
      [
        'tool-1',
        {
          toolCallId: 'tool-1',
          toolCallName: 'WebSearch',
          args: JSON.stringify({ query: 'TypeScript best practices' }),
          status: 'completed',
          result: 'Search result 1\nSearch result 2\nSearch result 3',
          startTime: 1000,
          endTime: 2000,
          index: 0,
        },
      ],
    ])

    render(<ClaudeCodeTrajectory messages={new Map()} toolCalls={toolCalls} />)

    // Should show query inline
    expect(screen.getByText(/query: "TypeScript best practices"/)).toBeInTheDocument()
    // Should show search completed
    expect(screen.getByText(/Search completed/)).toBeInTheDocument()
  })

  it('should show TodoWrite tool formatting', () => {
    const toolCalls = new Map<string, ToolCallTracking>([
      [
        'tool-1',
        {
          toolCallId: 'tool-1',
          toolCallName: 'TodoWrite',
          args: JSON.stringify({
            todos: [
              { content: 'Task 1', status: 'pending', activeForm: 'Task 1' },
              { content: 'Task 2', status: 'in_progress', activeForm: 'Task 2' },
              { content: 'Task 3', status: 'completed', activeForm: 'Task 3' },
            ],
          }),
          status: 'completed',
          result: JSON.stringify({
            todos: [
              { content: 'Task 1', status: 'pending' },
              { content: 'Task 2', status: 'in_progress' },
              { content: 'Task 3', status: 'completed' },
            ],
          }),
          startTime: 1000,
          endTime: 1200,
          index: 0,
        },
      ],
    ])

    render(<ClaudeCodeTrajectory messages={new Map()} toolCalls={toolCalls} />)

    // Should show todo count inline
    expect(screen.getByText(/3 todos, 1 in progress, 1 completed/)).toBeInTheDocument()
    // Should show update confirmation
    expect(screen.getByText(/Updated 3 todos/)).toBeInTheDocument()
  })

  it('should show TodoRead tool formatting', () => {
    const toolCalls = new Map<string, ToolCallTracking>([
      [
        'tool-1',
        {
          toolCallId: 'tool-1',
          toolCallName: 'TodoRead',
          args: JSON.stringify({}),
          status: 'completed',
          result: JSON.stringify({
            todos: [
              { content: 'Task 1', status: 'pending' },
              { content: 'Task 2', status: 'in_progress' },
              { content: 'Task 3', status: 'in_progress' },
              { content: 'Task 4', status: 'completed' },
            ],
          }),
          startTime: 1000,
          endTime: 1100,
          index: 0,
        },
      ],
    ])

    render(<ClaudeCodeTrajectory messages={new Map()} toolCalls={toolCalls} />)

    // Should show reading todo list
    expect(screen.getByText(/reading todo list/)).toBeInTheDocument()
    // Should show todo breakdown
    expect(screen.getByText(/1 pending, 2 in progress, 1 completed/)).toBeInTheDocument()
  })

  it('should hide system messages by default', () => {
    const messages = new Map<string, MessageBuffer>([
      [
        'msg-1',
        {
          messageId: 'msg-1',
          role: 'assistant',
          content: '[System] This is a system message',
          complete: true,
          timestamp: 1000,
          index: 0,
        },
      ],
      [
        'msg-2',
        {
          messageId: 'msg-2',
          role: 'assistant',
          content: 'This is a regular message',
          complete: true,
          timestamp: 2000,
          index: 1,
        },
      ],
    ])

    render(<ClaudeCodeTrajectory messages={messages} toolCalls={new Map()} />)

    // Should not show system message
    expect(screen.queryByText(/This is a system message/)).not.toBeInTheDocument()
    // Should show regular message
    expect(screen.getByText(/This is a regular message/)).toBeInTheDocument()
  })

  it('should show system messages when hideSystemMessages is false', () => {
    const messages = new Map<string, MessageBuffer>([
      [
        'msg-1',
        {
          messageId: 'msg-1',
          role: 'assistant',
          content: '[System] This is a system message',
          complete: true,
          timestamp: 1000,
          index: 0,
        },
      ],
      [
        'msg-2',
        {
          messageId: 'msg-2',
          role: 'assistant',
          content: 'This is a regular message',
          complete: true,
          timestamp: 2000,
          index: 1,
        },
      ],
    ])

    render(
      <ClaudeCodeTrajectory
        messages={messages}
        toolCalls={new Map()}
        hideSystemMessages={false}
      />
    )

    // Should show system message
    expect(screen.getByText(/This is a system message/)).toBeInTheDocument()
    // Should show regular message
    expect(screen.getByText(/This is a regular message/)).toBeInTheDocument()
  })

  describe('TodoTracker Integration', () => {
    it('should show TodoTracker by default for Claude Code', () => {
      const toolCalls = new Map<string, ToolCallTracking>([
        [
          'tool-1',
          {
            toolCallId: 'tool-1',
            toolCallName: 'TodoWrite',
            args: JSON.stringify({
              toolName: 'TodoWrite',
              args: {
                todos: [
                  { content: 'Task 1', status: 'pending', activeForm: 'Task 1' }
                ]
              }
            }),
            status: 'completed',
            result: 'Success',
            startTime: 1000,
            endTime: 1100,
            index: 0,
          },
        ],
      ])

      render(<ClaudeCodeTrajectory messages={new Map()} toolCalls={toolCalls} />)

      // TodoTracker should be visible by default for Claude Code
      expect(screen.getByText(/0\/1 completed/)).toBeInTheDocument()
      expect(screen.getByText('Task 1')).toBeInTheDocument()
    })

    it('should hide TodoTracker when showTodoTracker is false', () => {
      const toolCalls = new Map<string, ToolCallTracking>([
        [
          'tool-1',
          {
            toolCallId: 'tool-1',
            toolCallName: 'TodoWrite',
            args: JSON.stringify({
              toolName: 'TodoWrite',
              args: {
                todos: [
                  { content: 'Task 1', status: 'pending', activeForm: 'Task 1' }
                ]
              }
            }),
            status: 'completed',
            result: 'Success',
            startTime: 1000,
            endTime: 1100,
            index: 0,
          },
        ],
      ])

      render(
        <ClaudeCodeTrajectory
          messages={new Map()}
          toolCalls={toolCalls}
          showTodoTracker={false}
        />
      )

      // TodoTracker should not be visible when explicitly disabled
      expect(screen.queryByText(/\/.*completed/)).not.toBeInTheDocument()
    })

    it('should show TodoTracker with proper summary stats', () => {
      const toolCalls = new Map<string, ToolCallTracking>([
        [
          'tool-1',
          {
            toolCallId: 'tool-1',
            toolCallName: 'TodoWrite',
            args: JSON.stringify({
              toolName: 'TodoWrite',
              args: {
                todos: [
                  { content: 'Task 1', status: 'pending', activeForm: 'Task 1' },
                  { content: 'Task 2', status: 'in_progress', activeForm: 'Task 2' },
                  { content: 'Task 3', status: 'completed', activeForm: 'Task 3' },
                ]
              }
            }),
            status: 'completed',
            result: 'Success',
            startTime: 1000,
            endTime: 1100,
            index: 0,
          },
        ],
      ])

      render(
        <ClaudeCodeTrajectory
          messages={new Map()}
          toolCalls={toolCalls}
          
        />
      )

      // Should show summary stats
      expect(screen.getByText(/1\/3 completed/)).toBeInTheDocument()
    })

    it('should update TodoTracker when todos change', () => {
      const toolCalls1 = new Map<string, ToolCallTracking>([
        [
          'tool-1',
          {
            toolCallId: 'tool-1',
            toolCallName: 'TodoWrite',
            args: JSON.stringify({
              toolName: 'TodoWrite',
              args: {
                todos: [
                  { content: 'Task 1', status: 'pending', activeForm: 'Task 1' }
                ]
              }
            }),
            status: 'completed',
            result: 'Success',
            startTime: 1000,
            endTime: 1100,
            index: 0,
          },
        ],
      ])

      const { rerender } = render(
        <ClaudeCodeTrajectory
          messages={new Map()}
          toolCalls={toolCalls1}
          
        />
      )

      expect(screen.getByText('Task 1')).toBeInTheDocument()
      expect(screen.getByText(/0\/1 completed/)).toBeInTheDocument()

      // Add a second todo
      const toolCalls2 = new Map<string, ToolCallTracking>([
        [
          'tool-1',
          {
            toolCallId: 'tool-1',
            toolCallName: 'TodoWrite',
            args: JSON.stringify({
              toolName: 'TodoWrite',
              args: {
                todos: [
                  { content: 'Task 1', status: 'completed', activeForm: 'Task 1' },
                  { content: 'Task 2', status: 'pending', activeForm: 'Task 2' }
                ]
              }
            }),
            status: 'completed',
            result: 'Success',
            startTime: 2000,
            endTime: 2100,
            index: 1,
          },
        ],
      ])

      rerender(
        <ClaudeCodeTrajectory
          messages={new Map()}
          toolCalls={toolCalls2}
          
        />
      )

      expect(screen.getByText('Task 1')).toBeInTheDocument()
      expect(screen.getByText('Task 2')).toBeInTheDocument()
      expect(screen.getByText(/1\/2 completed/)).toBeInTheDocument()
    })

    it('should not show TodoTracker when no todos exist', () => {
      const toolCalls = new Map<string, ToolCallTracking>([
        [
          'tool-1',
          {
            toolCallId: 'tool-1',
            toolCallName: 'Bash',
            args: JSON.stringify({ command: 'npm test' }),
            status: 'completed',
            result: 'Tests passed',
            startTime: 1000,
            endTime: 1100,
            index: 0,
          },
        ],
      ])

      render(
        <ClaudeCodeTrajectory
          messages={new Map()}
          toolCalls={toolCalls}
          
        />
      )

      // Should not show TodoTracker when there are no todos
      expect(screen.queryByText(/\/.*completed/)).not.toBeInTheDocument()
    })

    it('should render TodoTracker below trajectory items', () => {
      const messages = new Map<string, MessageBuffer>([
        [
          'msg-1',
          {
            messageId: 'msg-1',
            role: 'assistant',
            content: 'Starting task',
            complete: true,
            timestamp: 900,
            index: 0,
          },
        ],
      ])

      const toolCalls = new Map<string, ToolCallTracking>([
        [
          'tool-1',
          {
            toolCallId: 'tool-1',
            toolCallName: 'TodoWrite',
            args: JSON.stringify({
              toolName: 'TodoWrite',
              args: {
                todos: [
                  { content: 'Task 1', status: 'in_progress', activeForm: 'Working on Task 1' }
                ]
              }
            }),
            status: 'completed',
            result: 'Success',
            startTime: 1000,
            endTime: 1100,
            index: 1,
          },
        ],
      ])

      const { container } = render(
        <ClaudeCodeTrajectory
          messages={messages}
          toolCalls={toolCalls}
          
        />
      )

      // Get all major sections
      const message = screen.getByText('Starting task')
      const tracker = screen.getByText(/0\/1 completed/)

      // TodoTracker should appear after the message in DOM
      const messagePosition = Array.from(container.querySelectorAll('*')).indexOf(
        message.closest('.group') as Element
      )
      const trackerPosition = Array.from(container.querySelectorAll('*')).indexOf(
        tracker.closest('div') as Element
      )

      expect(trackerPosition).toBeGreaterThan(messagePosition)
    })
  })
})
