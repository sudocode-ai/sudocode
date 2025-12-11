import { useState, useMemo } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Spec } from '@/types/api'

interface SpecSelectorProps {
  specs: Spec[]
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  className?: string
  /** Set to true when used inside a Dialog/Modal to enable proper scrolling */
  inModal?: boolean
}

export function SpecSelector({
  specs,
  value,
  onChange,
  disabled = false,
  placeholder = 'Select spec...',
  className,
  inModal = false,
}: SpecSelectorProps) {
  const [open, setOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  const filteredSpecs = useMemo(() => {
    if (!searchTerm.trim()) {
      return specs
    }
    const search = searchTerm.toLowerCase()
    return specs.filter(
      (spec) =>
        spec.id.toLowerCase().includes(search) ||
        spec.title.toLowerCase().includes(search)
    )
  }, [specs, searchTerm])

  const selectedSpec = specs.find((s) => s.id === value)

  return (
    <Popover open={open} onOpenChange={setOpen} modal={inModal}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('w-full justify-between font-normal', className)}
          disabled={disabled}
        >
          {selectedSpec ? (
            <span className="truncate">
              <span className="font-medium">{selectedSpec.id}</span>
              <span className="text-muted-foreground"> - {selectedSpec.title}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <div className="flex flex-col">
          <div className="border-b p-2">
            <Input
              placeholder="Search specs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-8"
              autoFocus
            />
          </div>
          <div className="max-h-60 overflow-auto">
            {filteredSpecs.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                No specs found
              </div>
            ) : (
              filteredSpecs.map((spec) => (
                <button
                  key={spec.id}
                  type="button"
                  className={cn(
                    'flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                    value === spec.id && 'bg-accent text-accent-foreground'
                  )}
                  onClick={() => {
                    onChange(spec.id)
                    setOpen(false)
                    setSearchTerm('')
                  }}
                >
                  <Check
                    className={cn(
                      'mt-0.5 h-4 w-4 shrink-0',
                      value === spec.id ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <div className="flex-1 overflow-hidden">
                    <div className="font-medium">{spec.id}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {spec.title}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
