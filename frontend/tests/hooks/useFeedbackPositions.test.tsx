/**
 * Tests for useFeedbackPositions hook
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useFeedbackPositions } from '@/hooks/useFeedbackPositions'
import type { IssueFeedback } from '@/types/api'

describe('useFeedbackPositions', () => {
  let mockEditorElement: HTMLDivElement

  beforeEach(() => {
    // Create a mock editor element
    mockEditorElement = document.createElement('div')
    mockEditorElement.style.position = 'relative'
    mockEditorElement.style.height = '500px'
    mockEditorElement.style.overflow = 'auto'
    document.body.appendChild(mockEditorElement)

    // Mock getBoundingClientRect
    vi.spyOn(mockEditorElement, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      left: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 500,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    })
  })

  afterEach(() => {
    document.body.removeChild(mockEditorElement)
    vi.restoreAllMocks()
  })

  it('should return empty map when no feedback provided', async () => {
    const editorRef = { current: mockEditorElement }
    const { result } = renderHook(() => useFeedbackPositions([], editorRef))

    await waitFor(() => {
      expect(result.current.size).toBe(0)
    })
  })

  it('should return empty map when editor ref is null', async () => {
    const editorRef = { current: null }
    const feedback: IssueFeedback[] = [
      {
        id: 'FB-001',
        issue_id: 'ISSUE-001',
        spec_id: 'SPEC-001',
        feedback_type: 'comment',
        content: 'Test',
        anchor: JSON.stringify({
          line_number: 10,
          anchor_status: 'valid',
        }),
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ]

    const { result } = renderHook(() => useFeedbackPositions(feedback, editorRef))

    await waitFor(() => {
      expect(result.current.size).toBe(0)
    })
  })

  it('should skip feedback without anchors', async () => {
    const editorRef = { current: mockEditorElement }
    const feedback: IssueFeedback[] = [
      {
        id: 'FB-001',
        issue_id: 'ISSUE-001',
        spec_id: 'SPEC-001',
        feedback_type: 'comment',
        content: 'General comment',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ]

    const { result } = renderHook(() => useFeedbackPositions(feedback, editorRef))

    await waitFor(() => {
      expect(result.current.size).toBe(0)
    })
  })

  it('should calculate position for feedback with data-feedback-id', async () => {
    // Add element with data-feedback-id
    const markElement = document.createElement('mark')
    markElement.setAttribute('data-feedback-id', 'FB-001')
    markElement.textContent = 'Highlighted text'
    mockEditorElement.appendChild(markElement)

    vi.spyOn(markElement, 'getBoundingClientRect').mockReturnValue({
      top: 200, // 100px below editor top (100)
      left: 0,
      right: 800,
      bottom: 220,
      width: 800,
      height: 20,
      x: 0,
      y: 200,
      toJSON: () => ({}),
    })

    const editorRef = { current: mockEditorElement }
    const feedback: IssueFeedback[] = [
      {
        id: 'FB-001',
        issue_id: 'ISSUE-001',
        spec_id: 'SPEC-001',
        feedback_type: 'comment',
        content: 'Test',
        anchor: JSON.stringify({
          line_number: 10,
          anchor_status: 'valid',
        }),
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ]

    const { result } = renderHook(() => useFeedbackPositions(feedback, editorRef))

    await waitFor(() => {
      expect(result.current.get('FB-001')).toBe(100) // 200 (element top) - 100 (editor top) + 0 (scroll)
    })
  })

  it('should calculate position for feedback with line number', async () => {
    // Add paragraph elements
    const p1 = document.createElement('p')
    p1.textContent = 'Line 1'
    const p2 = document.createElement('p')
    p2.textContent = 'Line 2'
    p2.setAttribute('data-line', '2')
    mockEditorElement.appendChild(p1)
    mockEditorElement.appendChild(p2)

    vi.spyOn(p2, 'getBoundingClientRect').mockReturnValue({
      top: 150,
      left: 0,
      right: 800,
      bottom: 170,
      width: 800,
      height: 20,
      x: 0,
      y: 150,
      toJSON: () => ({}),
    })

    const editorRef = { current: mockEditorElement }
    const feedback: IssueFeedback[] = [
      {
        id: 'FB-002',
        issue_id: 'ISSUE-001',
        spec_id: 'SPEC-001',
        feedback_type: 'comment',
        content: 'Test',
        anchor: JSON.stringify({
          line_number: 2,
          anchor_status: 'valid',
        }),
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ]

    const { result } = renderHook(() => useFeedbackPositions(feedback, editorRef))

    await waitFor(() => {
      expect(result.current.get('FB-002')).toBe(50) // 150 - 100 + 0
    })
  })

  it('should approximate position by counting elements when line number has no match', async () => {
    // Add multiple paragraph elements
    const p1 = document.createElement('p')
    p1.textContent = 'Line 1'
    const p2 = document.createElement('p')
    p2.textContent = 'Line 2'
    const p3 = document.createElement('p')
    p3.textContent = 'Line 3'
    mockEditorElement.appendChild(p1)
    mockEditorElement.appendChild(p2)
    mockEditorElement.appendChild(p3)

    vi.spyOn(p2, 'getBoundingClientRect').mockReturnValue({
      top: 130, // Second element
      left: 0,
      right: 800,
      bottom: 150,
      width: 800,
      height: 20,
      x: 0,
      y: 130,
      toJSON: () => ({}),
    })

    const editorRef = { current: mockEditorElement }
    const feedback: IssueFeedback[] = [
      {
        id: 'FB-003',
        issue_id: 'ISSUE-001',
        spec_id: 'SPEC-001',
        feedback_type: 'comment',
        content: 'Test',
        anchor: JSON.stringify({
          line_number: 2, // Will use as index 1 (0-based)
          anchor_status: 'valid',
        }),
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ]

    const { result } = renderHook(() => useFeedbackPositions(feedback, editorRef))

    await waitFor(() => {
      expect(result.current.get('FB-003')).toBe(30) // 130 - 100 + 0
    })
  })

  it('should handle multiple feedback items', async () => {
    const mark1 = document.createElement('mark')
    mark1.setAttribute('data-feedback-id', 'FB-001')
    const mark2 = document.createElement('mark')
    mark2.setAttribute('data-feedback-id', 'FB-002')

    mockEditorElement.appendChild(mark1)
    mockEditorElement.appendChild(mark2)

    vi.spyOn(mark1, 'getBoundingClientRect').mockReturnValue({
      top: 120,
      left: 0,
      right: 800,
      bottom: 140,
      width: 800,
      height: 20,
      x: 0,
      y: 120,
      toJSON: () => ({}),
    })

    vi.spyOn(mark2, 'getBoundingClientRect').mockReturnValue({
      top: 180,
      left: 0,
      right: 800,
      bottom: 200,
      width: 800,
      height: 20,
      x: 0,
      y: 180,
      toJSON: () => ({}),
    })

    const editorRef = { current: mockEditorElement }
    const feedback: IssueFeedback[] = [
      {
        id: 'FB-001',
        issue_id: 'ISSUE-001',
        spec_id: 'SPEC-001',
        feedback_type: 'comment',
        content: 'Test 1',
        anchor: JSON.stringify({ line_number: 1, anchor_status: 'valid' }),
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
      {
        id: 'FB-002',
        issue_id: 'ISSUE-001',
        spec_id: 'SPEC-001',
        feedback_type: 'comment',
        content: 'Test 2',
        anchor: JSON.stringify({ line_number: 5, anchor_status: 'valid' }),
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ]

    const { result } = renderHook(() => useFeedbackPositions(feedback, editorRef))

    await waitFor(() => {
      expect(result.current.get('FB-001')).toBe(20) // 120 - 100
      expect(result.current.get('FB-002')).toBe(80) // 180 - 100
    })
  })

  it('should handle invalid anchor JSON gracefully', async () => {
    const editorRef = { current: mockEditorElement }
    const feedback: IssueFeedback[] = [
      {
        id: 'FB-001',
        issue_id: 'ISSUE-001',
        spec_id: 'SPEC-001',
        feedback_type: 'comment',
        content: 'Test',
        anchor: 'invalid json',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ]

    const { result } = renderHook(() => useFeedbackPositions(feedback, editorRef))

    await waitFor(() => {
      expect(result.current.size).toBe(0)
    })
  })

  it('should account for scroll offset', async () => {
    const mark = document.createElement('mark')
    mark.setAttribute('data-feedback-id', 'FB-001')
    mockEditorElement.appendChild(mark)
    mockEditorElement.scrollTop = 100 // Scrolled down 100px

    vi.spyOn(mark, 'getBoundingClientRect').mockReturnValue({
      top: 120, // Appears at 120 in viewport
      left: 0,
      right: 800,
      bottom: 140,
      width: 800,
      height: 20,
      x: 0,
      y: 120,
      toJSON: () => ({}),
    })

    const editorRef = { current: mockEditorElement }
    const feedback: IssueFeedback[] = [
      {
        id: 'FB-001',
        issue_id: 'ISSUE-001',
        spec_id: 'SPEC-001',
        feedback_type: 'comment',
        content: 'Test',
        anchor: JSON.stringify({ line_number: 10, anchor_status: 'valid' }),
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ]

    const { result } = renderHook(() => useFeedbackPositions(feedback, editorRef))

    await waitFor(() => {
      // Position = (120 - 100) + 100 (scroll) = 120
      expect(result.current.get('FB-001')).toBe(120)
    })
  })

  it('should update positions when feedback changes', async () => {
    const mark = document.createElement('mark')
    mark.setAttribute('data-feedback-id', 'FB-001')
    mockEditorElement.appendChild(mark)

    vi.spyOn(mark, 'getBoundingClientRect').mockReturnValue({
      top: 150,
      left: 0,
      right: 800,
      bottom: 170,
      width: 800,
      height: 20,
      x: 0,
      y: 150,
      toJSON: () => ({}),
    })

    const editorRef = { current: mockEditorElement }
    const initialFeedback: IssueFeedback[] = [
      {
        id: 'FB-001',
        issue_id: 'ISSUE-001',
        spec_id: 'SPEC-001',
        feedback_type: 'comment',
        content: 'Test',
        anchor: JSON.stringify({ line_number: 10, anchor_status: 'valid' }),
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ]

    const { result, rerender } = renderHook(
      ({ feedback }) => useFeedbackPositions(feedback, editorRef),
      { initialProps: { feedback: initialFeedback } }
    )

    await waitFor(() => {
      expect(result.current.get('FB-001')).toBe(50)
    })

    // Add another feedback item
    const mark2 = document.createElement('mark')
    mark2.setAttribute('data-feedback-id', 'FB-002')
    mockEditorElement.appendChild(mark2)

    vi.spyOn(mark2, 'getBoundingClientRect').mockReturnValue({
      top: 200,
      left: 0,
      right: 800,
      bottom: 220,
      width: 800,
      height: 20,
      x: 0,
      y: 200,
      toJSON: () => ({}),
    })

    const updatedFeedback: IssueFeedback[] = [
      ...initialFeedback,
      {
        id: 'FB-002',
        issue_id: 'ISSUE-001',
        spec_id: 'SPEC-001',
        feedback_type: 'comment',
        content: 'Test 2',
        anchor: JSON.stringify({ line_number: 20, anchor_status: 'valid' }),
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      },
    ]

    rerender({ feedback: updatedFeedback })

    await waitFor(() => {
      expect(result.current.size).toBe(2)
      expect(result.current.get('FB-001')).toBe(50)
      expect(result.current.get('FB-002')).toBe(100)
    })
  })

  it('should cleanup event listeners on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(mockEditorElement, 'removeEventListener')
    const windowRemoveEventListenerSpy = vi.spyOn(window, 'removeEventListener')

    const editorRef = { current: mockEditorElement }
    const { unmount } = renderHook(() => useFeedbackPositions([], editorRef))

    unmount()

    expect(removeEventListenerSpy).toHaveBeenCalledWith('scroll', expect.any(Function))
    expect(windowRemoveEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function))
  })
})
