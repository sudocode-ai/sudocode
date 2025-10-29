import { useEffect, useRef, useState, useCallback } from 'react'
import type { WebSocketMessage, WebSocketSubscribeMessage } from '@/types/api'

interface UseWebSocketOptions {
  onMessage?: (message: WebSocketMessage) => void
  onOpen?: () => void
  onClose?: () => void
  onError?: (error: Event) => void
  reconnect?: boolean
  reconnectInterval?: number
}

export function useWebSocket(baseUrl: string, options: UseWebSocketOptions = {}) {
  const {
    onMessage,
    onOpen,
    onClose,
    onError,
    reconnect = true,
    reconnectInterval = 5000,
  } = options

  const ws = useRef<WebSocket | null>(null)
  const reconnectTimeout = useRef<NodeJS.Timeout | null>(null)
  const [connected, setConnected] = useState(false)
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null)

  // Use refs to avoid recreating connect callback when handlers change
  const onMessageRef = useRef(onMessage)
  const onOpenRef = useRef(onOpen)
  const onCloseRef = useRef(onClose)
  const onErrorRef = useRef(onError)

  // Update refs when callbacks change
  useEffect(() => {
    onMessageRef.current = onMessage
    onOpenRef.current = onOpen
    onCloseRef.current = onClose
    onErrorRef.current = onError
  }, [onMessage, onOpen, onClose, onError])

  const connect = useCallback(() => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      return
    }

    // Build WebSocket URL
    // In development with Vite proxy: ws://localhost:3001/ws (proxy forwards to backend)
    // In production: use current host
    const wsBaseUrl = import.meta.env.VITE_WS_URL || '/ws'
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = wsBaseUrl.startsWith('/')
      ? `${protocol}//${window.location.host}${wsBaseUrl}${baseUrl}`
      : `${wsBaseUrl}${baseUrl}`

    console.log('[WebSocket] Connecting to:', wsUrl)
    console.log('[WebSocket] Current host:', window.location.host)
    console.log('[WebSocket] Base URL:', wsBaseUrl)

    try {
      ws.current = new WebSocket(wsUrl)

      ws.current.onopen = () => {
        console.log('[WebSocket] Connected:', baseUrl)
        setConnected(true)
        onOpenRef.current?.()
      }

      ws.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage
          console.log('[WebSocket] Message received:', message.type)
          setLastMessage(message)
          onMessageRef.current?.(message)
        } catch (error) {
          console.error('[WebSocket] Failed to parse message:', error)
        }
      }

      ws.current.onerror = (error) => {
        console.error('[WebSocket] Error:', error)
        onErrorRef.current?.(error)
      }

      ws.current.onclose = () => {
        console.log('[WebSocket] Disconnected:', baseUrl)
        setConnected(false)
        onCloseRef.current?.()

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
  }, [baseUrl, reconnect, reconnectInterval])

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
  }, [])

  const send = useCallback((message: WebSocketSubscribeMessage | any) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(message))
      console.log('[WebSocket] Message sent:', message.type)
    } else {
      console.warn('[WebSocket] Cannot send message: not connected or still connecting')
    }
  }, [])

  const subscribe = useCallback(
    (entityType: WebSocketSubscribeMessage['entity_type'], entityId?: string) => {
      send({
        type: 'subscribe',
        entity_type: entityType,
        entity_id: entityId,
      } as WebSocketSubscribeMessage)
    },
    [send]
  )

  useEffect(() => {
    connect()

    return () => {
      disconnect()
    }
  }, [connect, disconnect])

  return {
    connected,
    lastMessage,
    send,
    subscribe,
    reconnect: connect,
    disconnect,
  }
}
