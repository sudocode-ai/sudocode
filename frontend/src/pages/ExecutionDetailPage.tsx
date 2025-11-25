import { useParams, useNavigate } from 'react-router-dom'
import { ExecutionView } from '@/components/executions/ExecutionView'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'

export default function ExecutionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  if (!id) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-center">
          <h2 className="mb-2 text-2xl font-bold">Invalid Execution</h2>
          <p className="mb-4 text-muted-foreground">No execution ID provided.</p>
          <Button onClick={() => navigate('/issues')}>Back to Issues</Button>
        </div>
      </div>
    )
  }

  // Follow-ups are now rendered inline in ExecutionView, no navigation needed
  // The URL stays on the root execution ID, and the chain is displayed inline

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-background p-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </div>
      </div>

      {/* Main content - scrollable area with padding bottom for sticky panel */}
      <div className="flex-1 overflow-auto">
        <ExecutionView executionId={id} />
      </div>
    </div>
  )
}
