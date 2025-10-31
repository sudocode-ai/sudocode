import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSpecs } from '@/hooks/useSpecs'
import { SpecList } from '@/components/specs/SpecList'
import { SpecEditor } from '@/components/specs/SpecEditor'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Archive, Plus, Search } from 'lucide-react'
import type { Spec } from '@/types/api'

export default function SpecsPage() {
  const { specs, isLoading } = useSpecs()
  const [showEditor, setShowEditor] = useState(false)
  const [filterText, setFilterText] = useState('')
  const navigate = useNavigate()

  const handleSave = (spec: Spec) => {
    setShowEditor(false)
    navigate(`/specs/${spec.id}`)
  }

  // Filter specs based on search text
  const filteredSpecs = filterText
    ? specs.filter((spec) => {
        const searchText = filterText.toLowerCase()
        return (
          spec.title.toLowerCase().includes(searchText) ||
          (spec.content && spec.content.toLowerCase().includes(searchText))
        )
      })
    : specs

  if (showEditor) {
    return (
      <div className="flex-1 p-8">
        <SpecEditor onSave={handleSave} onCancel={() => setShowEditor(false)} />
      </div>
    )
  }

  return (
    <div className="flex-1 p-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-bold">Specs</h1>
          {!isLoading && <Badge variant="secondary">{specs.length}</Badge>}
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
            variant="ghost"
            onClick={() => navigate('/specs/archived')}
            className="gap-1 text-muted-foreground hover:text-foreground"
          >
            <Archive className="mr-2 h-4 w-4" />
            Archived
          </Button>
          <Button
            onClick={() => setShowEditor(true)}
            variant="default"
            size="sm"
            className="text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-2 h-4 w-4" />
            New Spec
          </Button>
        </div>
      </div>

      <SpecList specs={filteredSpecs} loading={isLoading} />
    </div>
  )
}
