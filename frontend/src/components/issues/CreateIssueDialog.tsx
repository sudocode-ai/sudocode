import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProjectRoutes } from '@/hooks/useProjectRoutes'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { AlertCircle, Sparkles, FileText } from 'lucide-react'
import { IssueEditor } from './IssueEditor'
import { executionsApi } from '@/lib/api'
import { toast } from 'sonner'
import type { Issue, IssueStatus } from '@sudocode-ai/types'

const CREATE_MODE_STORAGE_KEY = 'sudocode:createIssue:mode'

interface CreateIssueDialogProps {
  isOpen: boolean
  onClose: () => void
  onCreate: (data: Partial<Issue>) => void
  isCreating?: boolean
  defaultStatus?: IssueStatus
}

export function CreateIssueDialog({
  isOpen,
  onClose,
  onCreate,
  isCreating = false,
  defaultStatus,
}: CreateIssueDialogProps) {
  const navigate = useNavigate()
  const { paths } = useProjectRoutes()
  const [hasChanges, setHasChanges] = useState(false)
  const [activeTab, setActiveTab] = useState<'manual' | 'cowrite'>(() => {
    const stored = localStorage.getItem(CREATE_MODE_STORAGE_KEY)
    return stored === 'cowrite' ? 'cowrite' : 'manual'
  })

  // Save tab preference to localStorage
  useEffect(() => {
    localStorage.setItem(CREATE_MODE_STORAGE_KEY, activeTab)
  }, [activeTab])

  // Co-write state
  const [cowriteDescription, setCowriteDescription] = useState('')
  const [isStartingCowrite, setIsStartingCowrite] = useState(false)
  const [cowriteError, setCowriteError] = useState<string | null>(null)

  const handleSave = (data: Partial<Issue>) => {
    onCreate(data)
    setHasChanges(false)
  }

  const handleCancel = () => {
    if (hasChanges || cowriteDescription.trim()) {
      const confirmed = window.confirm('You have unsaved changes. Are you sure you want to close?')
      if (!confirmed) return
    }
    resetState()
    onClose()
  }

  const resetState = () => {
    setHasChanges(false)
    setActiveTab('manual')
    setCowriteDescription('')
    setCowriteError(null)
  }

  const handleStartCowrite = async () => {
    if (!cowriteDescription.trim()) {
      setCowriteError('Please describe the issue you want to create')
      return
    }

    setIsStartingCowrite(true)
    setCowriteError(null)

    try {
      const prompt = `Help me create a new issue in this project. Here's what I want:

${cowriteDescription.trim()}

Please:
1. Analyze the codebase to understand the context
2. If the request is unclear, ask clarifying questions before proceeding
3. Create a well-structured issue with a clear title and detailed description
4. Set appropriate priority and status
5. Use the sudocode MCP tools to create the issue (upsert_issue)

After creating the issue, summarize what you created.`

      const execution = await executionsApi.createAdhoc({
        config: {
          mode: 'local',
        },
        prompt,
        agentType: 'claude-code',
      })

      toast.success('Started co-writing issue')
      resetState()
      onClose()
      navigate(paths.execution(execution.id))
    } catch (err) {
      console.error('Failed to start co-write:', err)
      setCowriteError(err instanceof Error ? err.message : 'Failed to start co-write session')
      toast.error('Failed to start co-write session')
    } finally {
      setIsStartingCowrite(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      if (cowriteDescription.trim() && !isStartingCowrite) {
        handleStartCowrite()
      }
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleCancel}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Issue</DialogTitle>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(v: string) => setActiveTab(v as 'manual' | 'cowrite')}
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="manual" className="gap-2">
              <FileText className="h-4 w-4" />
              Manual
            </TabsTrigger>
            <TabsTrigger value="cowrite" className="gap-2">
              <Sparkles className="h-4 w-4" />
              Co-write with Agent
            </TabsTrigger>
          </TabsList>

          <TabsContent value="manual" className="mt-4">
            <IssueEditor
              issue={defaultStatus ? ({ status: defaultStatus, priority: 2 } as Issue) : null}
              onSave={handleSave}
              onCancel={handleCancel}
              isLoading={isCreating}
            />
          </TabsContent>

          <TabsContent value="cowrite" className="mt-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              Describe the issue you want to create and an AI agent will help draft it.
            </p>

            {cowriteError && (
              <div className="rounded-lg border border-destructive bg-destructive/10 p-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-destructive" />
                  <p className="text-sm text-destructive">{cowriteError}</p>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="cowrite-description">What issue do you want to create?</Label>
              <Textarea
                id="cowrite-description"
                value={cowriteDescription}
                onChange={(e) => setCowriteDescription(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Describe the issue you want to create...

Examples:
• "Create an issue to add dark mode support to the settings page"
• "Bug fix needed: the login form doesn't validate email addresses"
• "Refactor the authentication module to use JWT tokens"`}
                rows={8}
                className="resize-none"
                disabled={isStartingCowrite}
                autoFocus={activeTab === 'cowrite'}
              />
              <p className="text-xs text-muted-foreground">
                Press Cmd+Enter (or Ctrl+Enter) to start
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={handleCancel} disabled={isStartingCowrite}>
                Cancel
              </Button>
              <Button
                onClick={handleStartCowrite}
                disabled={!cowriteDescription.trim() || isStartingCowrite}
              >
                {isStartingCowrite ? (
                  'Starting...'
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Start Co-writing
                  </>
                )}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
