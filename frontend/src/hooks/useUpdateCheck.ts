import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { updateApi, UpdateCheckResponse, UpdateInstallResponse } from '@/lib/api'
import { useState, useCallback, useRef, useEffect } from 'react'

/**
 * Hook for checking for updates
 *
 * Checks the npm registry for new versions of sudocode.
 * Results are cached for 4 hours client-side, with server-side
 * caching of npm registry calls for 24 hours.
 */
export function useUpdateCheck() {
  const query = useQuery({
    queryKey: ['update-check'],
    queryFn: updateApi.check,
    // Check every 4 hours - npm registry cache is 24 hours
    staleTime: 4 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    // Don't refetch on window focus for this
    refetchOnWindowFocus: false,
    // Retry once on failure
    retry: 1,
  })

  return {
    updateInfo: query.data ?? null,
    loading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  }
}

/**
 * Hook for update mutations (install, dismiss, restart)
 */
export function useUpdateMutations() {
  const queryClient = useQueryClient()
  const [restartState, setRestartState] = useState<'idle' | 'restarting' | 'polling'>('idle')
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollStartTimeRef = useRef<number>(0)

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [])

  const installUpdate = useMutation({
    mutationFn: updateApi.install,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['update-check'] })
    },
  })

  const dismissUpdate = useMutation({
    mutationFn: (version: string) => updateApi.dismiss(version),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['update-check'] })
    },
  })

  const restartServer = useMutation({
    mutationFn: updateApi.restart,
  })

  /**
   * Poll health endpoint until server is back up
   */
  const pollForServerRestart = useCallback(() => {
    const MAX_POLL_TIME = 30000 // 30 seconds max
    const POLL_INTERVAL = 500 // 500ms between checks

    setRestartState('polling')
    pollStartTimeRef.current = Date.now()

    pollIntervalRef.current = setInterval(async () => {
      const elapsed = Date.now() - pollStartTimeRef.current

      // Timeout after 30 seconds
      if (elapsed > MAX_POLL_TIME) {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current)
          pollIntervalRef.current = null
        }
        setRestartState('idle')
        // Reload anyway - server might be up
        window.location.reload()
        return
      }

      try {
        const response = await fetch('/health')
        if (response.ok) {
          // Server is back up!
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current)
            pollIntervalRef.current = null
          }
          setRestartState('idle')
          // Reload the page to get the new version
          window.location.reload()
        }
      } catch {
        // Server not ready yet, continue polling
      }
    }, POLL_INTERVAL)
  }, [])

  /**
   * Restart the server and poll until it's back up
   */
  const handleRestart = useCallback(async () => {
    setRestartState('restarting')
    try {
      await restartServer.mutateAsync()
      // Start polling for server to come back
      // Small delay to ensure the old process has started shutdown
      setTimeout(() => {
        pollForServerRestart()
      }, 300)
    } catch {
      // Request may fail as server shuts down - that's expected
      // Start polling anyway
      setTimeout(() => {
        pollForServerRestart()
      }, 300)
    }
  }, [restartServer, pollForServerRestart])

  return {
    installUpdate,
    dismissUpdate,
    restartServer: {
      ...restartServer,
      handleRestart,
      restartState,
    },
  }
}

/**
 * Return type for useUpdateCheck hook
 */
export interface UseUpdateCheckReturn {
  updateInfo: UpdateCheckResponse | null
  loading: boolean
  error: Error | null
  refetch: () => void
}

/**
 * Return type for useUpdateMutations hook
 */
export interface UseUpdateMutationsReturn {
  installUpdate: ReturnType<typeof useMutation<UpdateInstallResponse, Error, void>>
  dismissUpdate: ReturnType<typeof useMutation<{ message: string }, Error, string>>
  restartServer: {
    handleRestart: () => Promise<void>
    restartState: 'idle' | 'restarting' | 'polling'
    isPending: boolean
  }
}
