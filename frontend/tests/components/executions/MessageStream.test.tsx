/**
 * MessageStream Component Tests
 *
 * Tests for the message stream component
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MessageStream } from '@/components/executions/MessageStream'
import type { MessageBuffer } from '@/hooks/useAgUiStream'

describe('MessageStream', () => {
  describe('Empty State', () => {
    it('should return null when no messages', () => {
      const messages = new Map<string, MessageBuffer>()

      const { container } = render(<MessageStream messages={messages} />)

      expect(container.firstChild).toBeNull()
    })
  })

  describe('Message Display', () => {
    it('should display complete message', () => {
      const messages = new Map<string, MessageBuffer>()
      messages.set('msg-1', {
        messageId: 'msg-1',
        role: 'assistant',
        content: 'Hello, this is a test message!',
        complete: true,
      })

      render(<MessageStream messages={messages} />)

      expect(screen.getByText('Messages')).toBeInTheDocument()
      expect(screen.getByText('assistant')).toBeInTheDocument()
      expect(screen.getByText('Hello, this is a test message!')).toBeInTheDocument()
    })

    it('should display incomplete message with spinner', () => {
      const messages = new Map<string, MessageBuffer>()
      messages.set('msg-1', {
        messageId: 'msg-1',
        role: 'assistant',
        content: 'Streaming message...',
        complete: false,
      })

      const { container } = render(<MessageStream messages={messages} />)

      expect(screen.getByText('Streaming message...')).toBeInTheDocument()
      // Check for spinner by looking for animate-spin class
      const spinners = container.querySelectorAll('.animate-spin')
      expect(spinners.length).toBeGreaterThan(0)
    })

    it('should display multiple messages', () => {
      const messages = new Map<string, MessageBuffer>()
      messages.set('msg-1', {
        messageId: 'msg-1',
        role: 'user',
        content: 'First message',
        complete: true,
      })
      messages.set('msg-2', {
        messageId: 'msg-2',
        role: 'assistant',
        content: 'Second message',
        complete: true,
      })
      messages.set('msg-3', {
        messageId: 'msg-3',
        role: 'assistant',
        content: 'Third message',
        complete: false,
      })

      render(<MessageStream messages={messages} />)

      expect(screen.getByText('First message')).toBeInTheDocument()
      expect(screen.getByText('Second message')).toBeInTheDocument()
      expect(screen.getByText('Third message')).toBeInTheDocument()
      expect(screen.getByText('user')).toBeInTheDocument()
      const assistantBadges = screen.getAllByText('assistant')
      expect(assistantBadges.length).toBe(2)
    })

    it('should display different message roles', () => {
      const messages = new Map<string, MessageBuffer>()
      messages.set('msg-1', {
        messageId: 'msg-1',
        role: 'user',
        content: 'User message',
        complete: true,
      })
      messages.set('msg-2', {
        messageId: 'msg-2',
        role: 'assistant',
        content: 'Assistant message',
        complete: true,
      })
      messages.set('msg-3', {
        messageId: 'msg-3',
        role: 'system',
        content: 'System message',
        complete: true,
      })

      render(<MessageStream messages={messages} />)

      expect(screen.getByText('user')).toBeInTheDocument()
      expect(screen.getByText('assistant')).toBeInTheDocument()
      expect(screen.getByText('system')).toBeInTheDocument()
    })
  })

  describe('Markdown Rendering', () => {
    it('should render markdown when renderMarkdown is true', () => {
      const messages = new Map<string, MessageBuffer>()
      messages.set('msg-1', {
        messageId: 'msg-1',
        role: 'assistant',
        content: '**Bold text** and *italic text*',
        complete: true,
      })

      const { container } = render(<MessageStream messages={messages} renderMarkdown={true} />)

      // ReactMarkdown will render these as <strong> and <em> tags
      expect(container.querySelector('strong')).toBeInTheDocument()
      expect(container.querySelector('em')).toBeInTheDocument()
    })

    it('should render plain text when renderMarkdown is false', () => {
      const messages = new Map<string, MessageBuffer>()
      messages.set('msg-1', {
        messageId: 'msg-1',
        role: 'assistant',
        content: '**Bold text** and *italic text*',
        complete: true,
      })

      const { container } = render(<MessageStream messages={messages} renderMarkdown={false} />)

      // Should not have strong or em tags
      expect(container.querySelector('strong')).not.toBeInTheDocument()
      expect(container.querySelector('em')).not.toBeInTheDocument()
      // Should have the raw markdown text
      expect(screen.getByText('**Bold text** and *italic text*')).toBeInTheDocument()
    })

    it('should render markdown code blocks', () => {
      const messages = new Map<string, MessageBuffer>()
      messages.set('msg-1', {
        messageId: 'msg-1',
        role: 'assistant',
        content: '```typescript\nconst x = 1;\n```',
        complete: true,
      })

      const { container } = render(<MessageStream messages={messages} renderMarkdown={true} />)

      // Should have a pre tag for code block
      expect(container.querySelector('pre')).toBeInTheDocument()
      expect(screen.getByText('const x = 1;')).toBeInTheDocument()
    })

    it('should render inline code', () => {
      const messages = new Map<string, MessageBuffer>()
      messages.set('msg-1', {
        messageId: 'msg-1',
        role: 'assistant',
        content: 'Use the `useState` hook',
        complete: true,
      })

      const { container } = render(<MessageStream messages={messages} renderMarkdown={true} />)

      // Should have a code tag for inline code
      expect(container.querySelector('code')).toBeInTheDocument()
      expect(screen.getByText('useState')).toBeInTheDocument()
    })

    it('should render markdown lists', () => {
      const messages = new Map<string, MessageBuffer>()
      messages.set('msg-1', {
        messageId: 'msg-1',
        role: 'assistant',
        content: '- Item 1\n- Item 2\n- Item 3',
        complete: true,
      })

      const { container } = render(<MessageStream messages={messages} renderMarkdown={true} />)

      // Should have a ul tag for unordered list
      expect(container.querySelector('ul')).toBeInTheDocument()
      expect(screen.getByText('Item 1')).toBeInTheDocument()
      expect(screen.getByText('Item 2')).toBeInTheDocument()
      expect(screen.getByText('Item 3')).toBeInTheDocument()
    })

    it('should render markdown links', () => {
      const messages = new Map<string, MessageBuffer>()
      messages.set('msg-1', {
        messageId: 'msg-1',
        role: 'assistant',
        content: '[Click here](https://example.com)',
        complete: true,
      })

      const { container } = render(<MessageStream messages={messages} renderMarkdown={true} />)

      const link = container.querySelector('a')
      expect(link).toBeInTheDocument()
      expect(link?.getAttribute('href')).toBe('https://example.com')
      expect(link?.getAttribute('target')).toBe('_blank')
      expect(link?.getAttribute('rel')).toBe('noopener noreferrer')
      expect(screen.getByText('Click here')).toBeInTheDocument()
    })
  })

  describe('Auto-scroll', () => {
    it('should scroll to bottom when autoScroll is true', () => {
      const messages = new Map<string, MessageBuffer>()
      messages.set('msg-1', {
        messageId: 'msg-1',
        role: 'assistant',
        content: 'Test message',
        complete: true,
      })

      const scrollIntoViewMock = vi.fn()
      window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock

      render(<MessageStream messages={messages} autoScroll={true} />)

      // scrollIntoView should be called on the end ref
      expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth' })
    })

    it('should not scroll when autoScroll is false', () => {
      const messages = new Map<string, MessageBuffer>()
      messages.set('msg-1', {
        messageId: 'msg-1',
        role: 'assistant',
        content: 'Test message',
        complete: true,
      })

      const scrollIntoViewMock = vi.fn()
      window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock

      render(<MessageStream messages={messages} autoScroll={false} />)

      // scrollIntoView should not be called
      expect(scrollIntoViewMock).not.toHaveBeenCalled()
    })
  })

  describe('Custom Class Name', () => {
    it('should apply custom class name', () => {
      const messages = new Map<string, MessageBuffer>()
      messages.set('msg-1', {
        messageId: 'msg-1',
        role: 'assistant',
        content: 'Test message',
        complete: true,
      })

      const { container } = render(
        <MessageStream messages={messages} className="custom-class" />
      )

      const rootElement = container.querySelector('.custom-class')
      expect(rootElement).toBeInTheDocument()
    })
  })
})
