import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSpecs } from '@/hooks/useSpecs'
import { SpecList } from '@/components/specs/SpecList'
import { SpecEditor } from '@/components/specs/SpecEditor'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Archive, Plus, Search } from 'lucide-react'
import type { Spec } from '@/types/api'

type SortOption = 'priority' | 'newest' | 'last-updated'

const SORT_STORAGE_KEY = 'sudocode:specs:sortOption'

export default function SpecsPage() {
  const { specs, isLoading } = useSpecs()
  const [showEditor, setShowEditor] = useState(false)
  const [filterText, setFilterText] = useState('')
  const [sortOption, setSortOption] = useState<SortOption>(() => {
    // Initialize from localStorage if available
    try {
      const stored = localStorage.getItem(SORT_STORAGE_KEY)
      if (stored && ['priority', 'newest', 'last-updated'].includes(stored)) {
        return stored as SortOption
      }
    } catch (error) {
      console.error('Failed to load sort preference from localStorage:', error)
    }
    return 'priority'
  })
  const navigate = useNavigate()

  const handleSave = (spec: Spec) => {
    setShowEditor(false)
    navigate(`/specs/${spec.id}`)
  }

  // Save sort preference to localStorage when it changes
  const handleSortChange = (value: string) => {
    const newSortOption = value as SortOption
    setSortOption(newSortOption)
    try {
      localStorage.setItem(SORT_STORAGE_KEY, newSortOption)
    } catch (error) {
      console.error('Failed to save sort preference to localStorage:', error)
    }
  }

  // Filter and sort specs
  const filteredAndSortedSpecs = useMemo(() => {
    // First filter specs based on search text
    const filtered = filterText
      ? specs.filter((spec) => {
          const searchText = filterText.toLowerCase()
          return (
            spec.title.toLowerCase().includes(searchText) ||
            (spec.content && spec.content.toLowerCase().includes(searchText))
          )
        })
      : specs

    // Then sort the filtered specs
    const sorted = [...filtered].sort((a, b) => {
      switch (sortOption) {
        case 'priority':
          // Sort by priority (low to high, 0 is P0) then by created_at descending
          if (a.priority !== b.priority) {
            return a.priority - b.priority
          }
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()

        case 'newest':
          // Sort by created_at descending
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()

        case 'last-updated':
          // Sort by updated_at descending
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()

        default:
          return 0
      }
    })

    return sorted
  }, [specs, filterText, sortOption])

  if (showEditor) {
    return (
      <div className="flex-1 p-8">
        <SpecEditor onSave={handleSave} onCancel={() => setShowEditor(false)} />
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-background p-4">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Specs</h1>
          <Badge variant="secondary">{specs.length}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Filter specs..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="h-9 w-64 pl-8"
            />
          </div>
          <Button
            onClick={() => navigate('/specs/archived')}
            variant="ghost"
            size="sm"
            className="gap-1 text-muted-foreground hover:text-foreground"
          >
            <Archive className="h-4 w-4" />
            Archived
          </Button>
          <Button
            onClick={() => setShowEditor(true)}
            variant="default"
            size="sm"
            className="text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-2 h-4 w-4" />
            Create Spec
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden px-8 py-4">
        <div className="mb-4 flex justify-end">
          <Select value={sortOption} onValueChange={handleSortChange}>
            <SelectTrigger className="h-9 w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="priority">Priority</SelectItem>
              <SelectItem value="newest">Newest</SelectItem>
              <SelectItem value="last-updated">Last Updated</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 overflow-auto">
          <SpecList specs={filteredAndSortedSpecs} loading={isLoading} />
        </div>
      </div>
    </div>
  )
}
