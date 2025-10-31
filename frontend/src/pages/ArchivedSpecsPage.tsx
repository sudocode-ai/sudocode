import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSpecs } from '@/hooks/useSpecs'
import { SpecList } from '@/components/specs/SpecList'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowLeft, Search } from 'lucide-react'

export default function ArchivedSpecsPage() {
  const { specs, isLoading } = useSpecs(true)
  const navigate = useNavigate()
  const [filterText, setFilterText] = useState('')

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

  return (
    <div className="flex-1 p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/specs')}
              className="h-8 w-8 p-0"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-3xl font-bold">Archived Specs</h1>
          </div>
          <p className="text-muted-foreground ml-10">
            {isLoading ? 'Loading...' : `${specs.length} archived spec${specs.length !== 1 ? 's' : ''}`}
          </p>
        </div>
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
      </div>

      <SpecList specs={filteredSpecs} loading={isLoading} />
    </div>
  )
}
