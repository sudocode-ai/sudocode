import { useState, useMemo } from 'react'
import type { EntityType } from '@/types/api'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Entity {
  id: string
  title: string
}

interface EntityComboboxProps {
  entities: Entity[]
  value: string
  onChange: (value: string) => void
  entityType: EntityType
  onEntityTypeChange: (type: EntityType) => void
  disabled?: boolean
  placeholder?: string
}

export function EntityCombobox({
  entities,
  value,
  onChange,
  entityType,
  onEntityTypeChange,
  disabled = false,
  placeholder,
}: EntityComboboxProps) {
  const [open, setOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  // Filter entities based on search term
  const filteredEntities = useMemo(() => {
    if (!searchTerm.trim()) {
      return entities
    }
    const search = searchTerm.toLowerCase()
    return entities.filter(
      (entity) =>
        entity.id.toLowerCase().includes(search) ||
        entity.title.toLowerCase().includes(search)
    )
  }, [entities, searchTerm])

  // Find the selected entity to display its title
  const selectedEntity = entities.find((e) => e.id === value)

  return (
    <div className="space-y-2">
      <Label htmlFor="target-id">Target Entity</Label>
      <div className="flex gap-2">
        <Select
          value={entityType}
          onValueChange={(value) => {
            onEntityTypeChange(value as EntityType)
            // Clear selection when changing entity type
            onChange('')
            setSearchTerm('')
          }}
          disabled={disabled}
        >
          <SelectTrigger className="w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="issue">Issue</SelectItem>
            <SelectItem value="spec">Spec</SelectItem>
          </SelectContent>
        </Select>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="flex-1 justify-between font-normal"
              disabled={disabled}
            >
              {selectedEntity ? (
                <span className="truncate">
                  <span className="font-medium">{selectedEntity.id}</span>
                  <span className="text-muted-foreground"> - {selectedEntity.title}</span>
                </span>
              ) : (
                <span className="text-muted-foreground">
                  {placeholder || (entityType === 'issue' ? 'Select issue...' : 'Select spec...')}
                </span>
              )}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
            <div className="flex flex-col">
              <div className="border-b p-2">
                <Input
                  placeholder={`Search ${entityType === 'issue' ? 'issues' : 'specs'}...`}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="h-8"
                  autoFocus
                />
              </div>
              <div className="max-h-60 overflow-auto">
                {filteredEntities.length === 0 ? (
                  <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                    No {entityType === 'issue' ? 'issues' : 'specs'} found
                  </div>
                ) : (
                  filteredEntities.map((entity) => (
                    <button
                      key={entity.id}
                      type="button"
                      className={cn(
                        'flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                        value === entity.id && 'bg-accent text-accent-foreground'
                      )}
                      onClick={() => {
                        onChange(entity.id)
                        setOpen(false)
                        setSearchTerm('')
                      }}
                    >
                      <Check
                        className={cn(
                          'mt-0.5 h-4 w-4 shrink-0',
                          value === entity.id ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      <div className="flex-1 overflow-hidden">
                        <div className="font-medium">{entity.id}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {entity.title}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}
