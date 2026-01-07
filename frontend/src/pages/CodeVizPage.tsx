import { useProject } from '@/hooks/useProject'
import { useProjectById } from '@/hooks/useProjects'
import { useRepositoryInfo } from '@/hooks/useRepositoryInfo'
import { Badge } from '@/components/ui/badge'
import { GitBranch } from 'lucide-react'
import { CodeMapContainer } from '@/components/codeviz/CodeMapContainer'

export default function CodeVizPage() {
  const { currentProjectId } = useProject()
  const { data: currentProject } = useProjectById(currentProjectId)
  const { data: repoInfo } = useRepositoryInfo()

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-background px-4 py-2">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">CodeViz</h1>
          {currentProject && (
            <Badge variant="outline" className="text-xs">
              {currentProject.name}
            </Badge>
          )}
          {repoInfo && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <GitBranch className="h-3 w-3" />
              {repoInfo.branch}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Zoom controls placeholder */}
        </div>
      </div>

      {/* Full-screen map container */}
      <div className="flex-1">
        <CodeMapContainer />
      </div>
    </div>
  )
}
