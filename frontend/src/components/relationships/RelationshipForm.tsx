import { useState } from 'react'
import type { EntityType, RelationshipType } from '@/types/api'
import { RELATIONSHIP_LABELS } from '@/lib/relationships'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card } from '@/components/ui/card'
import { EntityCombobox } from '@/components/ui/entity-combobox'
import { useIssues } from '@/hooks/useIssues'
import { useSpecs } from '@/hooks/useSpecs'

interface RelationshipFormProps {
  fromId?: string
  fromType?: EntityType
  onSubmit: (toId: string, toType: EntityType, relationshipType: RelationshipType) => void
  onCancel?: () => void
  inline?: boolean
}

const RELATIONSHIP_TYPES: RelationshipType[] = [
  'blocks',
  'related',
  'discovered-from',
  'implements',
  'references',
  'depends-on',
]

export function RelationshipForm({
  fromId,
  fromType: _fromType,
  onSubmit,
  onCancel,
  inline = false,
}: RelationshipFormProps) {
  const [toId, setToId] = useState('')
  const [toType, setToType] = useState<EntityType>('issue')
  const [relationshipType, setRelationshipType] = useState<RelationshipType>('related')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Fetch all issues and specs for the dropdown
  const { issues, isLoading: isLoadingIssues } = useIssues(false)
  const { specs, isLoading: isLoadingSpecs } = useSpecs(false)

  // Filter out the current entity from the list
  const filteredIssues = issues.filter((issue) => issue.id !== fromId)
  const filteredSpecs = specs.filter((spec) => spec.id !== fromId)

  // Prepare entities for the combobox based on selected type
  const entities = toType === 'issue'
    ? filteredIssues.map((issue) => ({ id: issue.id, title: issue.title }))
    : filteredSpecs.map((spec) => ({ id: spec.id, title: spec.title }))

  const isLoadingEntities = toType === 'issue' ? isLoadingIssues : isLoadingSpecs

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!toId.trim()) {
      return
    }

    setIsSubmitting(true)
    try {
      await onSubmit(toId.trim(), toType, relationshipType)
      // Reset form
      setToId('')
      setToType('issue')
      setRelationshipType('related')
    } finally {
      setIsSubmitting(false)
    }
  }

  const content = (
    <form
      onSubmit={handleSubmit}
      className="space-y-4"
      onMouseDown={(e) => {
        // Prevent clicks inside the form from bubbling up and closing parent panels
        e.stopPropagation()
      }}
    >
      {/* Target Entity */}
      <EntityCombobox
        entities={entities}
        value={toId}
        onChange={setToId}
        entityType={toType}
        onEntityTypeChange={setToType}
        disabled={isSubmitting || isLoadingEntities}
        placeholder={isLoadingEntities
          ? 'Loading...'
          : toType === 'issue'
            ? 'Search issues...'
            : 'Search specs...'}
      />

      {/* Relationship Type */}
      <div className="space-y-2">
        <Label htmlFor="relationship-type">Relationship Type</Label>
        <Select
          value={relationshipType}
          onValueChange={(value) => setRelationshipType(value as RelationshipType)}
        >
          <SelectTrigger id="relationship-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RELATIONSHIP_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {RELATIONSHIP_LABELS[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={!toId.trim() || isSubmitting}>
          Create
        </Button>
      </div>
    </form>
  )

  if (inline) {
    return content
  }

  return <Card className="p-4">{content}</Card>
}
