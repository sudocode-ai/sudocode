import { useCallback } from 'react'
import { Card } from '@/components/ui/card'
import type { Spec } from '@/types/api'

// Priority badge colors
const priorityColors: Record<number, string> = {
  0: 'bg-red-500',
  1: 'bg-orange-500',
  2: 'bg-yellow-500',
  3: 'bg-blue-500',
  4: 'bg-gray-500',
}

const priorityLabels: Record<number, string> = {
  0: 'Critical',
  1: 'High',
  2: 'Medium',
  3: 'Low',
  4: 'None',
}

interface SpecCardProps {
  spec: Spec
  onClick?: (spec: Spec) => void
}

export function SpecCard({ spec, onClick }: SpecCardProps) {
  const handleClick = useCallback(() => {
    onClick?.(spec)
  }, [spec, onClick])

  // Extract preview text from content (first 200 chars)
  const preview = spec.content
    ? spec.content.slice(0, 200) + (spec.content.length > 200 ? '...' : '')
    : ''

  return (
    <Card
      className="p-4 cursor-pointer hover:shadow-md transition-shadow"
      onClick={handleClick}
    >
      <div className="flex flex-col gap-3">
        {/* Header with ID and priority */}
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs text-muted-foreground">
            {spec.id}
          </span>
          {spec.priority !== undefined && spec.priority <= 3 && (
            <span
              className={`text-xs px-2 py-0.5 rounded-full text-white shrink-0 ${priorityColors[spec.priority]}`}
            >
              {priorityLabels[spec.priority]}
            </span>
          )}
        </div>

        {/* Title */}
        <h3 className="font-semibold text-lg line-clamp-2">{spec.title}</h3>

        {/* Preview */}
        {preview && (
          <p className="text-sm text-muted-foreground line-clamp-3">
            {preview}
          </p>
        )}

        {/* Footer with file path */}
        <div className="flex flex-col gap-2">
          {spec.file_path && (
            <p className="font-mono text-xs text-muted-foreground truncate">
              {spec.file_path}
            </p>
          )}
        </div>
      </div>
    </Card>
  )
}
