import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { SpecViewerTiptap } from '@/components/specs/SpecViewerTiptap'
import { renderWithProviders } from '@/test/test-utils'
import { IssueFeedback } from '@/types/api'

describe('SpecViewerTiptap', () => {
  const sampleContent = `# Test Spec\n\nThis is the content.`

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render spec content in formatted view by default', () => {
    renderWithProviders(<SpecViewerTiptap content={sampleContent} />)

    // Should render tiptap editor in formatted mode
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('should not show edit/view toggle buttons since it is always editable', () => {
    renderWithProviders(<SpecViewerTiptap content={sampleContent} />)

    // Should not have Edit or View buttons
    expect(screen.queryByRole('button', { name: /Edit/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /View/i })).not.toBeInTheDocument()
  })

  it('should render in source view when viewMode is set to source', async () => {
    renderWithProviders(<SpecViewerTiptap content={sampleContent} viewMode="source" />)

    // Should show source view content with line numbers
    await waitFor(() => {
      expect(screen.getByText(/Test Spec/)).toBeInTheDocument()
    })
  })

  it('should accept onChange callback for auto-save functionality', () => {
    const onChange = vi.fn()

    renderWithProviders(<SpecViewerTiptap content={sampleContent} onChange={onChange} />)

    // Component should render without errors when onChange is provided
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('should render feedback in source view', async () => {
    const feedback: IssueFeedback[] = [
      {
        id: 'fb1',
        from_id: 'ISSUE-001',
        from_uuid: 'uuid-issue-001',
        to_id: 'SPEC-001',
        to_uuid: 'uuid-spec-001',
        feedback_type: 'comment' as const,
        content: 'Test feedback',
        agent: 'Test Agent',
        anchor: JSON.stringify({ line_number: 1 }),
        dismissed: false,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      },
    ]

    renderWithProviders(
      <SpecViewerTiptap content={sampleContent} feedback={feedback} viewMode="source" />
    )

    // Should render source view with feedback
    await waitFor(() => {
      expect(screen.getByText(/Test Spec/)).toBeInTheDocument()
    })
  })
})
