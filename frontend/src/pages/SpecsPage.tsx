import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSpecs } from '@/hooks/useSpecs'
import { SpecList } from '@/components/specs/SpecList'
import { SpecEditor } from '@/components/specs/SpecEditor'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Archive, Plus } from 'lucide-react'
import type { Spec } from '@/types/api'

export default function SpecsPage() {
  const { specs, isLoading } = useSpecs()
  const [showEditor, setShowEditor] = useState(false)
  const navigate = useNavigate()

  const handleSave = (spec: Spec) => {
    setShowEditor(false)
    navigate(`/specs/${spec.id}`)
  }

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
        <div className="flex gap-2">
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

      <SpecList specs={specs} loading={isLoading} />
    </div>
  )
}
