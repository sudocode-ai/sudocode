import { useState, useMemo } from 'react'
import { X, Plus, Filter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { FeedbackCard } from './FeedbackCard'
import { FeedbackForm } from './FeedbackForm'
import { useSpecFeedback } from '@/hooks/useSpecs'
import { useFeedback } from '@/hooks/useFeedback'
import type { FeedbackType, IssueFeedback } from '@/types/api'

interface SpecFeedbackPanelProps {
  specId: string
  issueId?: string
  selectedLineNumber?: number | null
  selectedText?: string | null
  onClose?: () => void
  onFeedbackClick?: (feedback: IssueFeedback) => void
  className?: string
}

/**
 * Sidebar panel displaying all feedback for a spec
 */
export function SpecFeedbackPanel({
  specId,
  issueId,
  selectedLineNumber,
  selectedText,
  onClose,
  onFeedbackClick,
  className = '',
}: SpecFeedbackPanelProps) {
  const [showForm, setShowForm] = useState(false)
  const [filterType, setFilterType] = useState<FeedbackType | 'all'>('all')
  const [showDismissed, setShowDismissed] = useState(false)

  const { feedback, isLoading } = useSpecFeedback(specId)
  const { createFeedback, updateFeedback, deleteFeedback } = useFeedback(specId)

  // Filter feedback based on current filters
  const filteredFeedback = useMemo(() => {
    let filtered = feedback

    // Filter by type
    if (filterType !== 'all') {
      filtered = filtered.filter((f) => f.feedback_type === filterType)
    }

    // Filter dismissed
    if (!showDismissed) {
      filtered = filtered.filter((f) => !f.dismissed)
    }

    // Sort by created_at desc
    return filtered.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
  }, [feedback, filterType, showDismissed])

  // Note: feedbackByLine removed as it's not currently used in the panel
  // It can be re-added if needed for future features

  const handleCreateFeedback = async (data: {
    type: FeedbackType
    content: string
    anchor?: any
  }) => {
    if (!issueId) {
      console.error('Cannot create feedback without issue ID')
      return
    }

    await createFeedback({
      to_id: specId,
      issue_id: issueId,
      feedback_type: data.type,
      content: data.content,
      anchor: data.anchor,
    })

    setShowForm(false)
  }

  const handleDismiss = (id: string) => {
    const fb = feedback.find((f) => f.id === id)
    if (fb) {
      updateFeedback({
        id,
        data: { dismissed: !fb.dismissed },
      })
    }
  }

  const handleDelete = (id: string) => {
    if (window.confirm('Are you sure you want to delete this feedback?')) {
      deleteFeedback(id)
    }
  }

  return (
    <div className={`flex h-full flex-col border-l bg-background ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between border-b p-4">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">Feedback</h3>
          <span className="text-sm text-muted-foreground">({filteredFeedback.length})</span>
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowForm(!showForm)}
            disabled={!issueId}
            title={!issueId ? 'Link an issue first' : 'Add feedback'}
          >
            <Plus className="h-4 w-4" />
          </Button>
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="border-b p-4">
        <div className="mb-2 flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Filter</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={filterType === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilterType('all')}
          >
            All
          </Button>
          <Button
            variant={filterType === 'comment' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilterType('comment')}
          >
            Comments
          </Button>
          <Button
            variant={filterType === 'suggestion' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilterType('suggestion')}
          >
            Suggestions
          </Button>
          <Button
            variant={filterType === 'request' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilterType('request')}
          >
            Requests
          </Button>
        </div>
        <div className="mt-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showDismissed}
              onChange={(e) => setShowDismissed(e.target.checked)}
              className="rounded border-gray-300"
            />
            Show dismissed
          </label>
        </div>
      </div>

      {/* Feedback list or form */}
      <div className="flex-1 overflow-y-auto p-4">
        {showForm && (
          <Card className="mb-4 p-4">
            <FeedbackForm
              issueId={issueId}
              lineNumber={selectedLineNumber || undefined}
              textSnippet={selectedText || undefined}
              onSubmit={handleCreateFeedback}
              onCancel={() => setShowForm(false)}
            />
          </Card>
        )}

        {isLoading && (
          <div className="text-center text-sm text-muted-foreground">Loading feedback...</div>
        )}

        {!isLoading && filteredFeedback.length === 0 && (
          <div className="text-center text-sm text-muted-foreground">
            No feedback yet. Click + to add feedback.
          </div>
        )}

        <div className="space-y-2">
          {filteredFeedback.map((fb) => (
            <FeedbackCard
              key={fb.id}
              feedback={fb}
              onDismiss={handleDismiss}
              onDelete={handleDelete}
              onClick={() => onFeedbackClick?.(fb)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
