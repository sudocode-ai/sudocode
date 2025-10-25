import { useParams, useNavigate } from 'react-router-dom'
import { useSpec } from '@/hooks/useSpecs'
import { SpecViewer } from '@/components/specs/SpecViewer'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

export default function SpecDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { spec, isLoading, isError } = useSpec(id || '')

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto"></div>
          <p className="text-muted-foreground">Loading spec...</p>
        </div>
      </div>
    )
  }

  if (isError || !spec) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">Spec not found</h2>
          <p className="text-muted-foreground mb-4">
            The spec you're looking for doesn't exist or has been deleted.
          </p>
          <Button onClick={() => navigate('/specs')}>Back to Specs</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 p-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/specs')}
          >
            ← Back
          </Button>
        </div>

        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <span className="font-mono text-sm text-muted-foreground">
                {spec.id}
              </span>
              {spec.priority !== undefined && (
                <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                  Priority {spec.priority}
                </span>
              )}
            </div>
            <h1 className="text-3xl font-bold mb-2">{spec.title}</h1>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" size="sm">
              Edit
            </Button>
            <Button variant="outline" size="sm">
              Delete
            </Button>
          </div>
        </div>

        {/* Metadata */}
        <div className="mt-4 flex flex-wrap gap-4 text-sm text-muted-foreground">
          {spec.file_path && (
            <div className="flex items-center gap-2">
              <span className="font-semibold">File:</span>
              <span className="font-mono">{spec.file_path}</span>
            </div>
          )}
          {spec.created_at && (
            <div className="flex items-center gap-2">
              <span className="font-semibold">Created:</span>
              <span>{new Date(spec.created_at).toLocaleDateString()}</span>
            </div>
          )}
          {spec.updated_at && (
            <div className="flex items-center gap-2">
              <span className="font-semibold">Updated:</span>
              <span>{new Date(spec.updated_at).toLocaleDateString()}</span>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      {spec.content ? (
        <SpecViewer content={spec.content} />
      ) : (
        <Card className="p-8 text-center">
          <p className="text-muted-foreground">No content available for this spec.</p>
        </Card>
      )}
    </div>
  )
}
