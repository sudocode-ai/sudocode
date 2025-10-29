import { useNavigate } from 'react-router-dom'
import { useSpecs } from '@/hooks/useSpecs'
import { SpecList } from '@/components/specs/SpecList'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'

export default function ArchivedSpecsPage() {
  const { specs, isLoading } = useSpecs(true)
  const navigate = useNavigate()

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
      </div>

      <SpecList specs={specs} loading={isLoading} />
    </div>
  )
}
