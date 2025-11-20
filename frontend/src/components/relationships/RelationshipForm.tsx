import { useState } from 'react'
import type { EntityType, RelationshipType } from '@/types/api'
import { RELATIONSHIP_LABELS } from '@/lib/relationships'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card } from '@/components/ui/card'

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
  fromId: _fromId,
  fromType: _fromType,
  onSubmit,
  onCancel,
  inline = false,
}: RelationshipFormProps) {
  const [toId, setToId] = useState('')
  const [toType, setToType] = useState<EntityType>('issue')
  const [relationshipType, setRelationshipType] = useState<RelationshipType>('related')
  const [isSubmitting, setIsSubmitting] = useState(false)

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
      <div className="space-y-2">
        <Label htmlFor="target-id">Target Entity</Label>
        <div className="flex gap-2">
          <Select value={toType} onValueChange={(value) => setToType(value as EntityType)}>
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="issue">Issue</SelectItem>
              <SelectItem value="spec">Spec</SelectItem>
            </SelectContent>
          </Select>
          <Input
            id="target-id"
            placeholder={toType === 'issue' ? 'i-x7k9' : 's-14sh'}
            value={toId}
            onChange={(e) => setToId(e.target.value)}
            className="flex-1"
            disabled={isSubmitting}
          />
        </div>
      </div>

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
