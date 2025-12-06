import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import type { WebSocketMessage, WebSocketSubscribeMessage } from '@/types/api'
import { useProjectContext } from './ProjectContext'

interface WebSocketContextValue {
  connected: boolean
  subscribe: (entityType: WebSocketSubscribeMessage['entity_type'], entityId?: string) => void
  unsubscribe: (entityType: WebSocketSubscribeMessage['entity_type'], entityId?: string) => void
  addMessageHandler: (id: string, handler: (message: WebSocketMessage) => void) => void
  removeMessageHandler: (id: string) => void
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null)

interface WebSocketProviderProps {
  children: React.ReactNode
  url?: string
  reconnect?: boolean
  reconnectInterval?: number
}

/**
 * WebSocket provider that manages a singleton WebSocket connection.
 */
export function WebSocketProvider({
  children,
  url = '',
  reconnect = true,
  reconnectInterval = 5000,
}: WebSocketProviderProps) {
  const ws = useRef<WebSocket | null>(null)
  const reconnectTimeout = useRef<NodeJS.Timeout | null>(null)
  const messageHandlers = useRef<Map<string, (message: WebSocketMessage) => void>>(new Map())
  const subscriptions = useRef<Set<string>>(new Set())
  const pendingSubscriptions = useRef<Set<string>>(new Set())

  const [connected, setConnected] = useState(false)

  // Get current project from context
  const { currentProjectId } = useProjectContext()

  // Track current project ID in a ref (always up-to-date for subscribe/unsubscribe)
  const currentProjectIdRef = useRef<string | null>(currentProjectId)
  currentProjectIdRef.current = currentProjectId

  // Track previous project ID for detecting changes
  const prevProjectIdRef = useRef<string | null>(currentProjectId)

  const connect = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      return
    }

    // Build WebSocket URL
    // wsBaseUrl should be the full WebSocket path (e.g., '/ws' or 'ws://localhost:3001/ws')
    const wsBaseUrl = import.meta.env.VITE_WS_URL || '/ws'
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'

    // If wsBaseUrl is a relative path, construct full URL; otherwise use it as-is
    const wsUrl = wsBaseUrl.startsWith('/')
      ? `${protocol}//${window.location.host}${wsBaseUrl}${url}`
      : `${wsBaseUrl}${url}`

    console.log('[WebSocket] Connecting to:', wsUrl)

    try {
      ws.current = new WebSocket(wsUrl)

      ws.current.onopen = () => {
        console.log('[WebSocket] Connected')
        setConnected(true)

        // Resubscribe to all previous subscriptions
        pendingSubscriptions.current.forEach((sub) => {
          if (ws.current?.readyState === WebSocket.OPEN) {
            const message = parseSubscriptionString(sub)
            if (message) {
              ws.current.send(JSON.stringify(message))
              console.log('[WebSocket] Resubscribed to:', sub)
            }
          }
        })
        subscriptions.current = new Set(pendingSubscriptions.current)
        pendingSubscriptions.current.clear()
      }

      ws.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage
          console.log('[WebSocket] Message received:', message.type, 'projectId:', message.projectId)

          // Filter messages by project ID
          // Only process messages that match current project or have no projectId (global messages)
          const currentProject = currentProjectIdRef.current
          if (message.projectId && currentProject && message.projectId !== currentProject) {
            console.log('[WebSocket] Ignoring message from different project:', message.projectId)
            return
          }

          // Notify all registered handlers
          messageHandlers.current.forEach((handler) => {
            try {
              handler(message)
            } catch (error) {
              console.error('[WebSocket] Handler error:', error)
            }
          })
        } catch (error) {
          console.error('[WebSocket] Failed to parse message:', error)
        }
      }

      ws.current.onerror = (error) => {
        console.error('[WebSocket] Error:', error)
      }

      ws.current.onclose = () => {
        console.log('[WebSocket] Disconnected')
        setConnected(false)

        // Store current subscriptions for reconnection
        pendingSubscriptions.current = new Set(subscriptions.current)

        // Reconnect if enabled
        if (reconnect) {
          reconnectTimeout.current = setTimeout(() => {
            console.log('[WebSocket] Attempting to reconnect...')
            connect()
          }, reconnectInterval)
        }
      }
    } catch (error) {
      console.error('[WebSocket] Connection failed:', error)
    }
  }, [url, reconnect, reconnectInterval])

  const disconnect = useCallback(() => {
    // Clear any pending reconnection attempts
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current)
      reconnectTimeout.current = null
    }

    // Close the WebSocket connection
    if (ws.current) {
      // Remove onclose handler to prevent reconnection on intentional disconnect
      ws.current.onclose = null
      ws.current.close()
      ws.current = null
    }

    setConnected(false)
    subscriptions.current.clear()
    pendingSubscriptions.current.clear()
  }, [])

  const subscribe = useCallback(
    (entityType: WebSocketSubscribeMessage['entity_type'], entityId?: string) => {
      const projectId = currentProjectIdRef.current
      if (!projectId) {
        console.warn('[WebSocket] Cannot subscribe: no project selected')
        return
      }

      const subscriptionKey = entityId
        ? `${projectId}:${entityType}:${entityId}`
        : `${projectId}:${entityType}:*`

      // Track subscription
      subscriptions.current.add(subscriptionKey)

      // Send subscription message if connected
      if (ws.current?.readyState === WebSocket.OPEN) {
        const message: WebSocketSubscribeMessage = {
          type: 'subscribe',
          project_id: projectId,
          entity_type: entityType,
          entity_id: entityId,
        }
        ws.current.send(JSON.stringify(message))
        console.log('[WebSocket] Subscribed to:', subscriptionKey)
      } else {
        // Queue for when connection is established
        pendingSubscriptions.current.add(subscriptionKey)
      }
    },
    []
  )

  const unsubscribe = useCallback(
    (entityType: WebSocketSubscribeMessage['entity_type'], entityId?: string) => {
      const projectId = currentProjectIdRef.current
      if (!projectId) {
        console.warn('[WebSocket] Cannot unsubscribe: no project selected')
        return
      }

      const subscriptionKey = entityId
        ? `${projectId}:${entityType}:${entityId}`
        : `${projectId}:${entityType}:*`

      // Remove from tracked subscriptions
      subscriptions.current.delete(subscriptionKey)
      pendingSubscriptions.current.delete(subscriptionKey)

      // Send unsubscribe message if connected
      if (ws.current?.readyState === WebSocket.OPEN) {
        const message: WebSocketSubscribeMessage = {
          type: 'unsubscribe',
          project_id: projectId,
          entity_type: entityType,
          entity_id: entityId,
        }
        ws.current.send(JSON.stringify(message))
        console.log('[WebSocket] Unsubscribed from:', subscriptionKey)
      }
    },
    []
  )

  const addMessageHandler = useCallback(
    (id: string, handler: (message: WebSocketMessage) => void) => {
      messageHandlers.current.set(id, handler)
    },
    []
  )

  const removeMessageHandler = useCallback((id: string) => {
    messageHandlers.current.delete(id)
  }, [])

  // Handle project switching: unsubscribe from old project, subscribe to new project
  useEffect(() => {
    const oldProjectId = prevProjectIdRef.current
    const newProjectId = currentProjectId

    // If project changed and we're connected
    if (oldProjectId !== newProjectId && ws.current?.readyState === WebSocket.OPEN) {
      console.log('[WebSocket] Project changed:', oldProjectId, '->', newProjectId)

      // Unsubscribe from all subscriptions of old project
      if (oldProjectId) {
        const oldProjectSubscriptions = Array.from(subscriptions.current).filter((sub) =>
          sub.startsWith(`${oldProjectId}:`)
        )

        oldProjectSubscriptions.forEach((sub) => {
          const message = parseSubscriptionString(sub)
          if (message) {
            message.type = 'unsubscribe'
            ws.current?.send(JSON.stringify(message))
            console.log('[WebSocket] Unsubscribed from old project:', sub)
          }
          subscriptions.current.delete(sub)
        })
      }

      // Clear pending subscriptions (they're for the old project)
      pendingSubscriptions.current.clear()

      console.log('[WebSocket] Ready for new project subscriptions')
    }

    // Update previous project ID
    prevProjectIdRef.current = newProjectId
  }, [currentProjectId])

  // Connect on mount
  useEffect(() => {
    connect()
    return () => {
      disconnect()
    }
  }, [connect, disconnect])

  const value: WebSocketContextValue = {
    connected,
    subscribe,
    unsubscribe,
    addMessageHandler,
    removeMessageHandler,
  }

  return <WebSocketContext.Provider value={value}>{children}</WebSocketContext.Provider>
}

export function useWebSocketContext() {
  const context = useContext(WebSocketContext)
  if (!context) {
    throw new Error('useWebSocketContext must be used within a WebSocketProvider')
  }
  return context
}

// Helper function to parse subscription string back to message format
// Format: projectId:entityType:entityId or projectId:entityType:*
function parseSubscriptionString(sub: string): WebSocketSubscribeMessage | null {
  const parts = sub.split(':')

  if (parts.length < 2) {
    return null
  }

  const [projectId, entityType, entityId] = parts

  if (entityType === 'all') {
    return {
      type: 'subscribe',
      project_id: projectId,
      entity_type: 'all',
    }
  }

  if (entityType === 'issue' || entityType === 'spec' || entityType === 'execution' || entityType === 'workflow') {
    return {
      type: 'subscribe',
      project_id: projectId,
      entity_type: entityType,
      entity_id: entityId === '*' ? undefined : entityId,
    }
  }

  return null
}
