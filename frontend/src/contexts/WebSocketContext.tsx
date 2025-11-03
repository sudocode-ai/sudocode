import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import type { WebSocketMessage, WebSocketSubscribeMessage } from '@/types/api'

interface WebSocketContextValue {
  connected: boolean
  lastMessage: WebSocketMessage | null
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
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null)

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
          console.log('[WebSocket] Message received:', message.type)
          setLastMessage(message)

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
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current)
      reconnectTimeout.current = null
    }
    if (ws.current) {
      ws.current.close()
      ws.current = null
    }
    setConnected(false)
    subscriptions.current.clear()
    pendingSubscriptions.current.clear()
  }, [])

  const subscribe = useCallback(
    (entityType: WebSocketSubscribeMessage['entity_type'], entityId?: string) => {
      const subscriptionKey = entityId ? `${entityType}:${entityId}` : `${entityType}:*`

      // Track subscription
      subscriptions.current.add(subscriptionKey)

      // Send subscription message if connected
      if (ws.current?.readyState === WebSocket.OPEN) {
        const message: WebSocketSubscribeMessage = {
          type: 'subscribe',
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
      const subscriptionKey = entityId ? `${entityType}:${entityId}` : `${entityType}:*`

      // Remove from tracked subscriptions
      subscriptions.current.delete(subscriptionKey)
      pendingSubscriptions.current.delete(subscriptionKey)

      // Send unsubscribe message if connected
      if (ws.current?.readyState === WebSocket.OPEN) {
        const message = {
          type: 'unsubscribe' as const,
          entity_type: entityType,
          entity_id: entityId,
        }
        ws.current.send(JSON.stringify(message))
        console.log('[WebSocket] Unsubscribed from:', subscriptionKey)
      }
    },
    []
  )

  const addMessageHandler = useCallback((id: string, handler: (message: WebSocketMessage) => void) => {
    messageHandlers.current.set(id, handler)
  }, [])

  const removeMessageHandler = useCallback((id: string) => {
    messageHandlers.current.delete(id)
  }, [])

  // Connect on mount
  useEffect(() => {
    connect()
    return () => {
      disconnect()
    }
  }, [connect, disconnect])

  const value: WebSocketContextValue = {
    connected,
    lastMessage,
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
function parseSubscriptionString(sub: string): WebSocketSubscribeMessage | null {
  if (sub === 'all') {
    return { type: 'subscribe', entity_type: 'all' }
  }

  const [entityType, entityId] = sub.split(':')
  if (entityType === 'issue' || entityType === 'spec') {
    return {
      type: 'subscribe',
      entity_type: entityType,
      entity_id: entityId === '*' ? undefined : entityId,
    }
  }

  return null
}
