/**
 * AgentTrajectory Component Tests
 *
 * Tests for the unified agent trajectory visualization
 * Updated for ACP migration with SessionUpdate types
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AgentTrajectory } from '@/components/executions/AgentTrajectory'
import type { AgentMessage, ToolCall, AgentThought } from '@/hooks/useSessionUpdateStream'
import { ThemeProvider } from '@/contexts/ThemeContext'

// Helper to wrap component with ThemeProvider
const renderWithTheme = (ui: React.ReactElement) => {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

// Helper to create AgentMessage
const createMessage = (
  id: string,
  content: string,
  timestamp: Date | number = new Date(),
  isStreaming = false
): AgentMessage => ({
  id,
  content,
  timestamp: timestamp instanceof Date ? timestamp : new Date(timestamp),
  isStreaming,
})

// Helper to create ToolCall
const createToolCall = (
  id: string,
  title: string,
  status: ToolCall['status'] = 'success',
  timestamp: Date | number = new Date(),
  completedAt?: Date | number
): ToolCall => ({
  id,
  title,
  status,
  timestamp: timestamp instanceof Date ? timestamp : new Date(timestamp),
  completedAt: completedAt
    ? completedAt instanceof Date
      ? completedAt
      : new Date(completedAt)
    : undefined,
})

// Helper to create AgentThought
const createThought = (
  id: string,
  content: string,
  timestamp: Date | number = new Date(),
  isStreaming = false
): AgentThought => ({
  id,
  content,
  timestamp: timestamp instanceof Date ? timestamp : new Date(timestamp),
  isStreaming,
})

describe('AgentTrajectory', () => {
  describe('Empty State', () => {
    it('should return null when no messages or tool calls', () => {
      const { container } = renderWithTheme(
        <AgentTrajectory messages={[]} toolCalls={[]} />
      )

      expect(container.firstChild).toBeNull()
    })
  })

  describe('Message Display', () => {
    it('should display messages with colored dot indicator', () => {
      const messages = [createMessage('msg-1', 'Hello, this is a test message!')]

      renderWithTheme(<AgentTrajectory messages={messages} toolCalls={[]} />)

      // New terminal-style UI uses colored dots, not text badges
      expect(screen.getByText('⏺')).toBeInTheDocument()
      expect(screen.getByText('Hello, this is a test message!')).toBeInTheDocument()
    })

    it('should show blinking dot for streaming messages', () => {
      const messages = [createMessage('msg-1', 'Streaming...', new Date(), true)]

      const { container } = renderWithTheme(
        <AgentTrajectory messages={messages} toolCalls={[]} />
      )

      // Streaming messages use animate-pulse on the dot
      const blinkingDots = container.querySelectorAll('.animate-pulse')
      expect(blinkingDots.length).toBeGreaterThan(0)
    })
  })

  describe('Thought Display', () => {
    it('should display thoughts with purple dot indicator', () => {
      const thoughts = [createThought('thought-1', 'Let me think about this...')]

      renderWithTheme(
        <AgentTrajectory messages={[]} toolCalls={[]} thoughts={thoughts} />
      )

      // New terminal-style UI uses purple dot for thoughts, not text badge
      expect(screen.getByText('⏺')).toBeInTheDocument()
      expect(screen.getByText('Let me think about this...')).toBeInTheDocument()
    })

    it('should show blinking dot for streaming thoughts', () => {
      const thoughts = [createThought('thought-1', 'Thinking...', new Date(), true)]

      const { container } = renderWithTheme(
        <AgentTrajectory messages={[]} toolCalls={[]} thoughts={thoughts} />
      )

      // Streaming thoughts use animate-pulse on the dot
      const blinkingDots = container.querySelectorAll('.animate-pulse')
      expect(blinkingDots.length).toBeGreaterThan(0)
    })
  })

  describe('Tool Call Display', () => {
    it('should display tool calls with colored dot and duration', () => {
      const toolCalls = [
        {
          ...createToolCall('tool-1', 'Read', 'success', 1000, 2000),
          rawInput: { file: 'test.ts' },
          result: 'File contents here',
        },
      ]

      renderWithTheme(<AgentTrajectory messages={[]} toolCalls={toolCalls} />)

      // New terminal-style UI uses colored dots (green for success), not text badges
      expect(screen.getByText('Read')).toBeInTheDocument()
      expect(screen.getByText('1.00s')).toBeInTheDocument()
      // Green dot should be present (check via class name)
      const dots = screen.getAllByText('⏺')
      expect(dots.length).toBeGreaterThan(0)
    })

    it('should display tool call with error', () => {
      const toolCalls = [
        {
          ...createToolCall('tool-1', 'Write', 'failed', 1000, 2000),
          result: 'File not found',  // Error text as string
        },
      ]

      renderWithTheme(<AgentTrajectory messages={[]} toolCalls={toolCalls} />)

      expect(screen.getByText('Write')).toBeInTheDocument()
      expect(screen.getByText('File not found')).toBeInTheDocument()
    })
  })

  describe('Chronological Ordering', () => {
    it('should display messages and tool calls in chronological order', () => {
      const messages = [
        createMessage('msg-1', 'First message', 1000),
        createMessage('msg-2', 'Third message', 3000),
      ]

      const toolCalls = [createToolCall('tool-1', 'Read', 'success', 2000, 2500)]

      const { container } = renderWithTheme(
        <AgentTrajectory messages={messages} toolCalls={toolCalls} />
      )

      // Get all trajectory items in order (each wrapped in .group)
      const items = container.querySelectorAll('.group')
      expect(items.length).toBe(3)

      // Verify order: msg-1 (1000), tool-1 (2000), msg-2 (3000)
      expect(items[0].textContent).toContain('First message')
      expect(items[1].textContent).toContain('Read')
      expect(items[2].textContent).toContain('Third message')
    })

    it('should display messages, thoughts, and tool calls in chronological order', () => {
      const messages = [createMessage('msg-1', 'First message', 1000)]
      const thoughts = [createThought('thought-1', 'Thinking...', 2000)]
      const toolCalls = [createToolCall('tool-1', 'Read', 'success', 3000)]

      const { container } = renderWithTheme(
        <AgentTrajectory messages={messages} toolCalls={toolCalls} thoughts={thoughts} />
      )

      const items = container.querySelectorAll('.group')
      expect(items.length).toBe(3)

      expect(items[0].textContent).toContain('First message')
      expect(items[1].textContent).toContain('Thinking...')
      expect(items[2].textContent).toContain('Read')
    })

    it('should handle historical replay ordering correctly', () => {
      // Simulate a real historical replay scenario with tool calls between messages
      const messages = [
        createMessage('msg-1', 'Let me read the file', 1705320600000),
        createMessage('msg-2', 'I found the issue', 1705320602000),
      ]

      const toolCalls = [
        {
          ...createToolCall('tool-1', 'Read', 'success', 1705320601000, 1705320601500),
          rawInput: { path: 'src/index.ts' },
          result: 'file contents',
        },
      ]

      const { container } = renderWithTheme(
        <AgentTrajectory messages={messages} toolCalls={toolCalls} />
      )

      const items = container.querySelectorAll('.group')
      expect(items.length).toBe(3)

      // Verify correct chronological order
      expect(items[0].textContent).toContain('Let me read the file')
      expect(items[1].textContent).toContain('Read')
      expect(items[2].textContent).toContain('I found the issue')
    })
  })

  describe('Markdown Rendering', () => {
    it('should render markdown when renderMarkdown is true', () => {
      const messages = [createMessage('msg-1', '**Bold text** and *italic text*')]

      const { container } = renderWithTheme(
        <AgentTrajectory messages={messages} toolCalls={[]} renderMarkdown={true} />
      )

      // ReactMarkdown will render these as <strong> and <em> tags
      expect(container.querySelector('strong')).toBeInTheDocument()
      expect(container.querySelector('em')).toBeInTheDocument()
    })

    it('should render plain text when renderMarkdown is false', () => {
      const messages = [createMessage('msg-1', '**Bold text** and *italic text*')]

      const { container } = renderWithTheme(
        <AgentTrajectory messages={messages} toolCalls={[]} renderMarkdown={false} />
      )

      // Should not have strong or em tags
      expect(container.querySelector('strong')).not.toBeInTheDocument()
      expect(container.querySelector('em')).not.toBeInTheDocument()
      // Should have the raw markdown text
      expect(screen.getByText('**Bold text** and *italic text*')).toBeInTheDocument()
    })
  })

  describe('Mixed Content', () => {
    it('should handle multiple messages and tool calls together', () => {
      const messages = [
        createMessage('msg-1', 'First message', 1000),
        createMessage('msg-2', 'Second message', 3000),
      ]

      const toolCalls = [
        createToolCall('tool-1', 'Read', 'success', 2000, 2500),
        createToolCall('tool-2', 'Write', 'success', 4000, 4500),
      ]

      renderWithTheme(<AgentTrajectory messages={messages} toolCalls={toolCalls} />)

      // All items should be displayed
      expect(screen.getByText('First message')).toBeInTheDocument()
      expect(screen.getByText('Second message')).toBeInTheDocument()
      expect(screen.getByText('Read')).toBeInTheDocument()
      expect(screen.getByText('Write')).toBeInTheDocument()
    })
  })

  describe('System Message Filtering', () => {
    it('should hide system messages by default', () => {
      const messages = [
        createMessage('msg-1', '[System] This is a system message', 1000),
        createMessage('msg-2', 'This is a regular message', 2000),
      ]

      renderWithTheme(<AgentTrajectory messages={messages} toolCalls={[]} />)

      // Should not show system message
      expect(screen.queryByText(/This is a system message/)).not.toBeInTheDocument()
      // Should show regular message
      expect(screen.getByText(/This is a regular message/)).toBeInTheDocument()
    })

    it('should show system messages when hideSystemMessages is false', () => {
      const messages = [
        createMessage('msg-1', '[System] This is a system message', 1000),
        createMessage('msg-2', 'This is a regular message', 2000),
      ]

      renderWithTheme(
        <AgentTrajectory messages={messages} toolCalls={[]} hideSystemMessages={false} />
      )

      // Should show system message
      expect(screen.getByText(/This is a system message/)).toBeInTheDocument()
      // Should show regular message
      expect(screen.getByText(/This is a regular message/)).toBeInTheDocument()
    })
  })

  describe('Tool Status Variants', () => {
    it('should show blinking dot for running tool calls', () => {
      const toolCalls = [createToolCall('tool-1', 'Running Task', 'running')]

      const { container } = renderWithTheme(
        <AgentTrajectory messages={[]} toolCalls={toolCalls} />
      )

      // New UI shows yellow blinking dot for running status
      expect(screen.getByText('Running Task')).toBeInTheDocument()
      const blinkingDots = container.querySelectorAll('.animate-pulse')
      expect(blinkingDots.length).toBeGreaterThan(0)
    })

    it('should show blinking dot for pending tool calls', () => {
      const toolCalls = [createToolCall('tool-1', 'Pending Task', 'pending')]

      const { container } = renderWithTheme(
        <AgentTrajectory messages={[]} toolCalls={toolCalls} />
      )

      // New UI shows yellow blinking dot for pending status
      expect(screen.getByText('Pending Task')).toBeInTheDocument()
      const blinkingDots = container.querySelectorAll('.animate-pulse')
      expect(blinkingDots.length).toBeGreaterThan(0)
    })
  })
})
