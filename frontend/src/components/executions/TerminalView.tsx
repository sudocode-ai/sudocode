/**
 * TerminalView Component
 *
 * Interactive terminal view using xterm.js for executions in interactive or hybrid mode.
 * Provides a full terminal emulator with bidirectional I/O over WebSocket.
 */

import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { AlertCircle, Loader2 } from 'lucide-react'

export interface TerminalViewProps {
  /**
   * Execution ID to connect to
   */
  executionId: string

  /**
   * Callback when terminal connects successfully
   */
  onConnect?: () => void

  /**
   * Callback when terminal disconnects
   */
  onDisconnect?: () => void

  /**
   * Callback when an error occurs
   */
  onError?: (error: Error) => void

  /**
   * Custom class name
   */
  className?: string
}

/**
 * Connection status for the terminal WebSocket
 */
type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

/**
 * WebSocket message types for terminal communication
 */
interface TerminalMessage {
  type: 'terminal:data' | 'terminal:exit' | 'terminal:input' | 'terminal:resize'
  data?: string
  exitCode?: number
  signal?: number
  cols?: number
  rows?: number
}

/**
 * VS Code dark theme colors for xterm
 */
const VSCODE_THEME = {
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  cursor: '#aeafad',
  cursorAccent: '#1e1e1e',
  selection: '#264f78',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#e5e5e5',
}

/**
 * TerminalView Component
 *
 * @example
 * ```tsx
 * <TerminalView
 *   executionId="exec-123"
 *   onConnect={() => console.log('Connected')}
 *   onError={(err) => console.error(err)}
 * />
 * ```
 */
export function TerminalView({
  executionId,
  onConnect,
  onDisconnect,
  onError,
  className = '',
}: TerminalViewProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const terminal = useRef<Terminal | null>(null)
  const fitAddon = useRef<FitAddon | null>(null)
  const ws = useRef<WebSocket | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [exitCode, setExitCode] = useState<number | null>(null)

  useEffect(() => {
    if (!terminalRef.current) return

    // Initialize terminal
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: VSCODE_THEME,
      scrollback: 10000,
      allowProposedApi: true,
    })

    terminal.current = term

    // Initialize addons
    const fit = new FitAddon()
    fitAddon.current = fit
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())

    // Attach terminal to DOM
    term.open(terminalRef.current)

    // Fit terminal to container
    fit.fit()

    // Handle user input - will be connected to WebSocket in separate effect
    term.onData((data) => {
      if (ws.current?.readyState === WebSocket.OPEN) {
        const message: TerminalMessage = {
          type: 'terminal:input',
          data,
        }
        ws.current.send(JSON.stringify(message))
      }
    })

    // Handle window resize with debounce
    let resizeTimeout: NodeJS.Timeout | null = null
    const handleResize = () => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout)
      }

      resizeTimeout = setTimeout(() => {
        if (fitAddon.current && terminal.current) {
          fitAddon.current.fit()

          // Send resize event to backend
          const { cols, rows } = terminal.current
          if (ws.current?.readyState === WebSocket.OPEN) {
            const message: TerminalMessage = {
              type: 'terminal:resize',
              cols,
              rows,
            }
            ws.current.send(JSON.stringify(message))
          }
        }
      }, 100) // 100ms debounce
    }

    window.addEventListener('resize', handleResize)

    // Cleanup on unmount
    return () => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout)
      }
      window.removeEventListener('resize', handleResize)
      terminal.current?.dispose()
    }
  }, [])

  // WebSocket connection effect
  useEffect(() => {
    if (!terminal.current) return

    // Determine WebSocket URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.hostname
    const port = import.meta.env.VITE_SERVER_PORT || '3000'
    const wsUrl = `${protocol}//${host}:${port}/ws/terminal/${executionId}`

    console.log('[TerminalView] Connecting to:', wsUrl)

    // Create WebSocket connection
    const socket = new WebSocket(wsUrl)
    ws.current = socket

    socket.onopen = () => {
      console.log('[TerminalView] WebSocket connected')
      setStatus('connected')
      onConnect?.()
    }

    socket.onmessage = (event) => {
      try {
        const message: TerminalMessage = JSON.parse(event.data)

        if (message.type === 'terminal:data' && message.data) {
          // Write data to terminal
          terminal.current?.write(message.data)
        } else if (message.type === 'terminal:exit') {
          // Handle process exit
          console.log('[TerminalView] Process exited with code:', message.exitCode)
          setExitCode(message.exitCode ?? null)
          setStatus('disconnected')

          // Display exit message in terminal
          const exitMsg = `\r\n\r\n[Process exited with code ${message.exitCode ?? 'unknown'}]\r\n`
          terminal.current?.write(exitMsg)
        }
      } catch (error) {
        console.error('[TerminalView] Failed to parse message:', error)
      }
    }

    socket.onerror = (event) => {
      console.error('[TerminalView] WebSocket error:', event)
      setStatus('error')
      setErrorMessage('Connection error')
      onError?.(new Error('WebSocket connection error'))
    }

    socket.onclose = (event) => {
      console.log('[TerminalView] WebSocket closed:', event.code, event.reason)

      if (status === 'connected') {
        setStatus('disconnected')
        onDisconnect?.()
      } else if (status === 'connecting') {
        // Failed to connect
        setStatus('error')
        setErrorMessage(event.reason || 'Failed to connect')
        onError?.(new Error(event.reason || 'Connection failed'))
      }
    }

    // Cleanup on unmount
    return () => {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close()
      }
    }
  }, [executionId, onConnect, onDisconnect, onError, status])

  return (
    <Card className={`flex flex-col ${className}`}>
      {/* Connection Status */}
      <div className="flex items-center justify-between border-b p-3">
        <div className="flex items-center gap-2">
          {status === 'connecting' && (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Connecting to terminal...</span>
            </>
          )}
          {status === 'connected' && (
            <>
              <div className="h-2 w-2 rounded-full bg-green-500" />
              <span className="text-sm text-muted-foreground">Connected</span>
            </>
          )}
          {status === 'disconnected' && (
            <>
              <div className="h-2 w-2 rounded-full bg-gray-500" />
              <span className="text-sm text-muted-foreground">Disconnected</span>
            </>
          )}
          {status === 'error' && (
            <>
              <AlertCircle className="h-4 w-4 text-destructive" />
              <span className="text-sm text-destructive">{errorMessage}</span>
            </>
          )}
        </div>

        <Badge variant="outline" className="text-xs">
          {executionId.slice(0, 8)}
        </Badge>
      </div>

      {/* Terminal Container */}
      <div
        ref={terminalRef}
        className="flex-1 p-2 overflow-hidden"
        style={{ minHeight: '400px' }}
      />

      {/* Exit Code Display */}
      {exitCode !== null && (
        <div className="border-t p-3 bg-muted/50">
          <div className="text-sm flex items-center gap-2">
            <span className="text-muted-foreground">Process exited with code</span>
            <Badge variant={exitCode === 0 ? 'default' : 'destructive'}>
              {exitCode}
            </Badge>
            {exitCode === 0 && <span className="text-muted-foreground">(success)</span>}
            {exitCode !== 0 && <span className="text-destructive">(error)</span>}
          </div>
        </div>
      )}
    </Card>
  )
}
