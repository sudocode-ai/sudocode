import { useNavigate } from 'react-router-dom'
import { useProjectRoutes } from '@/hooks/useProjectRoutes'
import { SpecCard } from './SpecCard'
import type { Spec } from '@/types/api'
import type { Workflow } from '@/types/workflow'

interface SpecListProps {
  specs: Spec[]
  loading?: boolean
  emptyMessage?: string
  /** Map of spec ID to active workflow (if any) */
  activeWorkflows?: Map<string, Workflow>
}

export function SpecList({
  specs,
  loading = false,
  emptyMessage = 'No specs found',
  activeWorkflows,
}: SpecListProps) {
  const navigate = useNavigate()
  const { paths } = useProjectRoutes()

  const handleSpecClick = (spec: Spec) => {
    navigate(paths.spec(spec.id))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
          <p className="text-muted-foreground">Loading specs...</p>
        </div>
      </div>
    )
  }

  if (!specs || specs.length === 0) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-center">
          <p className="text-lg text-muted-foreground">{emptyMessage}</p>
          <p className="mt-2 text-sm text-muted-foreground">Create a new spec to get started</p>
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {specs.map((spec) => (
        <SpecCard
          key={spec.id}
          spec={spec}
          onClick={handleSpecClick}
          activeWorkflow={activeWorkflows?.get(spec.id)}
        />
      ))}
    </div>
  )
}
