import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertCircle, Loader2, Link as LinkIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useImportPreview, useImport } from '@/hooks/useImport'
import { ImportPreview } from './ImportPreview'
import { AlreadyImportedState } from './AlreadyImportedState'
import type { ImportOptions, ImportPreviewResponse } from '@/lib/api'

interface ImportDialogProps {
  open: boolean
  onClose: () => void
  onImported?: (entityId: string) => void
}

type DialogState = 'initial' | 'loading' | 'preview' | 'already-imported' | 'error'

/**
 * Main import dialog for importing external entities as specs
 */
export function ImportDialog({ open, onClose, onImported }: ImportDialogProps) {
  const navigate = useNavigate()
  const [url, setUrl] = useState('')
  const [state, setState] = useState<DialogState>('initial')
  const [error, setError] = useState<string | null>(null)
  const [previewData, setPreviewData] = useState<ImportPreviewResponse | null>(null)

  const previewMutation = useImportPreview()
  const importMutation = useImport()

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (open) {
      setUrl('')
      setState('initial')
      setError(null)
      setPreviewData(null)
    }
  }, [open])

  const handleClose = useCallback(() => {
    if (previewMutation.isPending || importMutation.isPending) {
      return // Don't close while operations are in progress
    }
    onClose()
  }, [onClose, previewMutation.isPending, importMutation.isPending])

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      handleClose()
    }
  }

  const handlePreview = async () => {
    if (!url.trim()) {
      setError('Please enter a URL')
      return
    }

    // Basic URL validation
    try {
      new URL(url.trim())
    } catch {
      setError('Please enter a valid URL')
      return
    }

    setState('loading')
    setError(null)

    try {
      const result = await previewMutation.mutateAsync(url.trim())
      setPreviewData(result)

      if (result.alreadyLinked) {
        setState('already-imported')
      } else {
        setState('preview')
      }
    } catch (err) {
      setState('error')
      const message = err instanceof Error ? err.message : 'Failed to fetch preview'
      setError(message)
    }
  }

  const handleImport = async (options: ImportOptions) => {
    if (!url.trim()) {
      return
    }

    try {
      const result = await importMutation.mutateAsync({
        url: url.trim(),
        options,
      })

      toast.success(`Imported as spec ${result.entityId}`)
      onClose()
      onImported?.(result.entityId)

      // Navigate to the newly created spec
      navigate(`/specs/${result.entityId}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to import'
      toast.error(message)
      setError(message)
    }
  }

  const handleViewEntity = () => {
    if (!previewData?.alreadyLinked) return

    const { entityId, entityType } = previewData.alreadyLinked
    onClose()

    if (entityType === 'spec') {
      navigate(`/specs/${entityId}`)
    } else {
      navigate(`/issues/${entityId}`)
    }
  }

  const handleRefresh = async () => {
    // Re-fetch preview to check for updates
    await handlePreview()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !previewMutation.isPending) {
      e.preventDefault()
      handlePreview()
    }
    if (e.key === 'Escape') {
      handleClose()
    }
  }

  const handleBackToInput = () => {
    setState('initial')
    setError(null)
    setPreviewData(null)
  }

  const isLoading = previewMutation.isPending || state === 'loading'
  const isImporting = importMutation.isPending

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import from URL</DialogTitle>
          <DialogDescription>
            Import an issue or document from an external system as a spec.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* URL Input - always visible but disabled during preview/import */}
          <div className="space-y-2">
            <Label htmlFor="import-url">URL</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <LinkIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="import-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="https://github.com/owner/repo/issues/123"
                  className="pl-9"
                  disabled={isLoading || isImporting || state !== 'initial'}
                  autoFocus
                />
              </div>
              {state === 'initial' && (
                <Button onClick={handlePreview} disabled={isLoading || !url.trim()}>
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    'Preview'
                  )}
                </Button>
              )}
              {(state === 'preview' || state === 'already-imported' || state === 'error') && (
                <Button variant="outline" onClick={handleBackToInput} disabled={isImporting}>
                  Change
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Supports GitHub Issues, Discussions, and other configured integrations
            </p>
          </div>

          {/* Error Display */}
          {error && (state === 'error' || state === 'initial') && (
            <div className="rounded-lg border border-destructive bg-destructive/10 p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-destructive" />
                <div>
                  {state === 'error' && (
                    <p className="text-sm font-medium text-destructive">Import Failed</p>
                  )}
                  <p className={`text-sm ${state === 'error' ? 'mt-1 text-destructive/80' : 'text-destructive'}`}>
                    {error}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Already Imported State */}
          {state === 'already-imported' && previewData?.alreadyLinked && (
            <AlreadyImportedState
              entityId={previewData.alreadyLinked.entityId}
              entityType={previewData.alreadyLinked.entityType}
              lastSyncedAt={previewData.alreadyLinked.lastSyncedAt}
              onViewEntity={handleViewEntity}
              onRefresh={handleRefresh}
              isRefreshing={previewMutation.isPending}
            />
          )}

          {/* Preview State */}
          {state === 'preview' && previewData && (
            <ImportPreview
              provider={previewData.provider}
              entity={previewData.entity}
              commentsCount={previewData.commentsCount}
              onImport={handleImport}
              onCancel={handleClose}
              isImporting={isImporting}
            />
          )}

          {/* Initial state - show cancel button */}
          {state === 'initial' && (
            <div className="flex justify-end pt-2">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
