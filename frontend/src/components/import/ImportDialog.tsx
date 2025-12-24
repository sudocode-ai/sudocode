import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProjectRoutes } from '@/hooks/useProjectRoutes'
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
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertCircle,
  Loader2,
  Search,
  ExternalLink,
  FileText,
  CheckCircle2,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  useImportPreview,
  useImportProviders,
  useImportSearch,
  useBatchImport,
} from '@/hooks/useImport'
import { useRepositoryInfo } from '@/hooks/useRepositoryInfo'
import { ProviderIcon } from './ProviderIcon'
import type { ExternalEntity, ImportProviderInfo } from '@/lib/api'

interface ImportDialogProps {
  open: boolean
  onClose: () => void
  onImported?: (entityIds: string[]) => void
}

type DialogState = 'initial' | 'loading' | 'results' | 'error'

/**
 * Helper to detect if a string looks like a URL
 */
function isUrl(input: string): boolean {
  const trimmed = input.trim()
  if (!trimmed) return false

  // Check for common URL patterns
  return (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.match(/^github\.com\//) !== null
  )
}

/**
 * Unified import dialog for importing external entities as specs
 * Supports URL detection, search, and batch import with upsert behavior
 */
export function ImportDialog({ open, onClose, onImported }: ImportDialogProps) {
  const navigate = useNavigate()
  const { paths } = useProjectRoutes()

  // State
  const [state, setState] = useState<DialogState>('initial')
  const [error, setError] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [selectedProvider, setSelectedProvider] = useState<string>('')
  const [searchResults, setSearchResults] = useState<ExternalEntity[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [currentPage, setCurrentPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)

  // Hooks
  const { data: providers = [] } = useImportProviders()
  const { data: repoInfo } = useRepositoryInfo()
  const previewMutation = useImportPreview()
  const searchMutation = useImportSearch()
  const batchImportMutation = useBatchImport()

  // Filter to only providers that support search
  const searchableProviders = useMemo(
    () => providers.filter((p: ImportProviderInfo) => p.supportsSearch && p.configured),
    [providers]
  )

  // Auto-select first search provider when available
  useEffect(() => {
    if (searchableProviders.length > 0 && !selectedProvider) {
      setSelectedProvider(searchableProviders[0].name)
    }
  }, [searchableProviders, selectedProvider])

  // Check if we can browse without a query (need repo info for GitHub)
  const canBrowseRepo =
    selectedProvider === 'github' && repoInfo?.gitProvider === 'github' && repoInfo?.ownerRepo

  // Reset state when dialog opens and auto-load issues
  useEffect(() => {
    if (open) {
      // Reset state first
      setState('initial')
      setError(null)
      setInput('')
      setSearchResults([])
      setSelectedIds(new Set())
      setCurrentPage(1)
      setHasMore(false)
    }
  }, [open])

  // Auto-load issues after reset when we can browse
  // Uses a small delay to ensure reset has completed
  useEffect(() => {
    if (!open || !canBrowseRepo || !selectedProvider) return

    const timer = setTimeout(() => {
      handleSearch(false)
    }, 50)

    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, canBrowseRepo, selectedProvider])

  const handleClose = useCallback(() => {
    if (previewMutation.isPending || searchMutation.isPending || batchImportMutation.isPending) {
      return // Don't close while operations are in progress
    }
    onClose()
  }, [onClose, previewMutation.isPending, searchMutation.isPending, batchImportMutation.isPending])

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      handleClose()
    }
  }

  // Handle URL preview
  const handleUrlPreview = async (url: string) => {
    setState('loading')
    setError(null)

    try {
      const result = await previewMutation.mutateAsync(url)

      // Auto-select it
      setSelectedIds(new Set([result.entity.id]))
      setSearchResults([result.entity])
      setState('results')
    } catch (err) {
      setState('error')
      const message = err instanceof Error ? err.message : 'Failed to fetch preview'
      setError(message)
    }
  }

  // Handle search
  const handleSearch = async (loadMore = false) => {
    const trimmedInput = input.trim()
    const inputIsUrl = isUrl(trimmedInput)

    // If it looks like a URL, use preview instead
    if (inputIsUrl && !loadMore) {
      await handleUrlPreview(trimmedInput)
      return
    }

    // Need either a query or ability to browse repo
    if (!selectedProvider || (!trimmedInput && !canBrowseRepo)) {
      return
    }

    if (loadMore) {
      setIsLoadingMore(true)
    } else {
      setState('loading')
      setCurrentPage(1)
      setSelectedIds(new Set())
    }
    setError(null)

    try {
      const page = loadMore ? currentPage + 1 : 1

      // Build search params
      let searchQuery: string | undefined
      let repo: string | undefined

      if (trimmedInput) {
        // User provided a query
        searchQuery = trimmedInput
        // For GitHub, scope to current repo if not already specified
        if (
          selectedProvider === 'github' &&
          repoInfo?.gitProvider === 'github' &&
          repoInfo?.ownerRepo &&
          !searchQuery.toLowerCase().includes('repo:')
        ) {
          searchQuery = `repo:${repoInfo.ownerRepo} ${searchQuery}`
        }
      } else if (canBrowseRepo) {
        // No query, but can list from repo
        repo = repoInfo!.ownerRepo
      }

      const result = await searchMutation.mutateAsync({
        provider: selectedProvider,
        query: searchQuery,
        repo,
        page,
        perPage: 20,
      })

      if (loadMore) {
        setSearchResults((prev) => [...prev, ...result.results])
      } else {
        setSearchResults(result.results)
      }

      setCurrentPage(page)
      setHasMore(result.pagination?.hasMore ?? false)
      setState('results')
    } catch (err) {
      setState('error')
      const message = err instanceof Error ? err.message : 'Search failed'
      setError(message)
    } finally {
      setIsLoadingMore(false)
    }
  }

  const handleLoadMore = () => {
    handleSearch(true)
  }

  // Toggle selection
  const toggleSelection = (entityId: string) => {
    setSelectedIds((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(entityId)) {
        newSet.delete(entityId)
      } else {
        newSet.add(entityId)
      }
      return newSet
    })
  }

  // Select all
  const selectAll = () => {
    setSelectedIds(new Set(searchResults.map((e) => e.id)))
  }

  // Deselect all
  const deselectAll = () => {
    setSelectedIds(new Set())
  }

  // Handle batch import
  const handleImport = async () => {
    if (selectedIds.size === 0) {
      toast.error('Please select at least one item to import')
      return
    }

    try {
      const result = await batchImportMutation.mutateAsync({
        provider: selectedProvider,
        externalIds: Array.from(selectedIds),
      })

      const successCount = result.created + result.updated
      const entityIds = result.results
        .filter((r) => r.success && r.entityId)
        .map((r) => r.entityId!)

      if (successCount > 0) {
        toast.success(
          `Imported ${successCount} item${successCount !== 1 ? 's' : ''} (${result.created} created, ${result.updated} updated)`
        )
        onClose()
        onImported?.(entityIds)

        // Navigate to specs page if multiple, or to single spec if one
        if (entityIds.length === 1) {
          navigate(paths.spec(entityIds[0]))
        } else if (entityIds.length > 1) {
          navigate(paths.specs())
        }
      }

      if (result.failed > 0) {
        toast.error(`${result.failed} item${result.failed !== 1 ? 's' : ''} failed to import`)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed'
      toast.error(message)
      setError(message)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSearch(false)
    }
    if (e.key === 'Escape') {
      handleClose()
    }
  }

  const isLoading = previewMutation.isPending || searchMutation.isPending || state === 'loading'
  const isImporting = batchImportMutation.isPending
  const hasSearchableProviders = searchableProviders.length > 0

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[80vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>Import External Source</DialogTitle>
          <DialogDescription>
            Import issues or documents from an external system. Paste a URL or search for items.
            Already imported items will be updated.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-1 flex-col space-y-4 overflow-hidden px-1 pt-2">
          {/* Provider Selection */}
          {hasSearchableProviders && (
            <div className="flex gap-2">
              <div className="w-48">
                <Label htmlFor="provider" className="sr-only">
                  Source
                </Label>
                <Select
                  value={selectedProvider}
                  onValueChange={setSelectedProvider}
                  disabled={isLoading || isImporting}
                >
                  <SelectTrigger id="provider">
                    <SelectValue placeholder="Select source" />
                  </SelectTrigger>
                  <SelectContent>
                    {searchableProviders.map((p: ImportProviderInfo) => (
                      <SelectItem key={p.name} value={p.name}>
                        <div className="flex items-center gap-2">
                          <ProviderIcon provider={p.name} size="sm" />
                          <span>{p.displayName}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Input Field */}
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Paste URL or search..."
                className="flex-1"
                disabled={isLoading || isImporting}
                autoFocus
              />

              {/* Search Button */}
              <Button
                variant="outline"
                onClick={() => handleSearch(false)}
                disabled={isLoading || (!input.trim() && !canBrowseRepo)}
              >
                {isLoading && !isLoadingMore ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
              </Button>
            </div>
          )}

          {/* Helper text */}
          <p className="text-xs text-muted-foreground">
            {selectedProvider === 'github' ? (
              repoInfo?.gitProvider === 'github' && repoInfo?.ownerRepo ? (
                <>
                  Showing issues from <span className="font-medium">{repoInfo.ownerRepo}</span>.
                  Search with keywords or paste a full URL.
                </>
              ) : (
                'Paste a GitHub issue URL or search with keywords.'
              )
            ) : (
              'Paste a URL or search for items to import.'
            )}
          </p>

          {/* Error Display */}
          {error && state === 'error' && (
            <div className="rounded-lg border border-destructive bg-destructive/10 p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-destructive" />
                <div>
                  <p className="text-sm font-medium text-destructive">Error</p>
                  <p className="text-sm text-destructive/80">{error}</p>
                </div>
              </div>
            </div>
          )}

          {/* Results List */}
          {(state === 'results' || searchResults.length > 0) && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {/* Selection Controls */}
              {searchResults.length > 0 && (
                <div className="flex items-center justify-between border-b py-2">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="select-all"
                      checked={
                        selectedIds.size === searchResults.length && searchResults.length > 0
                      }
                      onCheckedChange={(checked) => {
                        if (checked) {
                          selectAll()
                        } else {
                          deselectAll()
                        }
                      }}
                    />
                    <Label htmlFor="select-all" className="text-sm text-muted-foreground">
                      {selectedIds.size} of {searchResults.length} selected
                    </Label>
                  </div>
                </div>
              )}

              {/* Results */}
              {searchResults.length === 0 && state === 'results' ? (
                <div className="rounded-lg border border-muted bg-muted/50 p-8 text-center">
                  <FileText className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No results found</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Try different search terms or paste a URL
                  </p>
                </div>
              ) : (
                <div className="flex-1 space-y-1 overflow-y-auto py-2">
                  {searchResults.map((entity) => (
                    <label
                      key={entity.id}
                      className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent"
                    >
                      <Checkbox
                        checked={selectedIds.has(entity.id)}
                        onCheckedChange={() => toggleSelection(entity.id)}
                        className="mt-1"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="line-clamp-1 text-sm font-medium">{entity.title}</h4>
                          <div className="flex flex-shrink-0 items-center gap-1">
                            {entity.status && (
                              <Badge
                                variant={entity.status === 'open' ? 'default' : 'secondary'}
                                className="text-xs"
                              >
                                {entity.status}
                              </Badge>
                            )}
                          </div>
                        </div>
                        {entity.description && (
                          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                            {entity.description}
                          </p>
                        )}
                        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-mono">{entity.id}</span>
                          {entity.url && (
                            <a
                              href={entity.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="hover:text-foreground"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    </label>
                  ))}

                  {/* Load More */}
                  {hasMore && (
                    <div className="flex justify-center pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleLoadMore}
                        disabled={isLoadingMore}
                      >
                        {isLoadingMore ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Loading...
                          </>
                        ) : (
                          'Load More'
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Loading State */}
          {isLoading && searchResults.length === 0 && (
            <div className="flex flex-1 items-center justify-center py-8">
              <div className="text-center">
                <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
                <p className="mt-2 text-sm text-muted-foreground">Loading...</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer with Import Button */}
        <div className="mt-4 flex items-center justify-between border-t pt-4">
          <Button variant="outline" onClick={handleClose} disabled={isImporting}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={selectedIds.size === 0 || isImporting}>
            {isImporting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Import {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
