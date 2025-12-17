import { CheckCircle, ExternalLink, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDistanceToNow } from 'date-fns'

interface AlreadyImportedStateProps {
  entityId: string
  entityType: 'spec' | 'issue'
  lastSyncedAt?: string
  onViewEntity: () => void
  onRefresh: () => void
  isRefreshing?: boolean
}

/**
 * Component shown when a URL has already been imported
 */
export function AlreadyImportedState({
  entityId,
  entityType,
  lastSyncedAt,
  onViewEntity,
  onRefresh,
  isRefreshing = false,
}: AlreadyImportedStateProps) {
  return (
    <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950/30">
      <div className="flex items-start gap-3">
        <CheckCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-600 dark:text-green-500" />
        <div className="flex-1 space-y-2">
          <div>
            <h4 className="font-medium text-green-900 dark:text-green-100">
              Already Imported
            </h4>
            <p className="mt-1 text-sm text-green-700 dark:text-green-300">
              This URL has already been imported as{' '}
              <span className="font-medium">
                {entityType === 'spec' ? 'spec' : 'issue'} {entityId}
              </span>
              {lastSyncedAt && (
                <>
                  {' '}
                  (last synced{' '}
                  {formatDistanceToNow(new Date(lastSyncedAt), { addSuffix: true })})
                </>
              )}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onViewEntity}
              className="gap-1.5 border-green-300 bg-white text-green-700 hover:bg-green-100 dark:border-green-800 dark:bg-green-950 dark:text-green-300 dark:hover:bg-green-900"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              View {entityType === 'spec' ? 'Spec' : 'Issue'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="gap-1.5 border-green-300 bg-white text-green-700 hover:bg-green-100 dark:border-green-800 dark:bg-green-950 dark:text-green-300 dark:hover:bg-green-900"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
