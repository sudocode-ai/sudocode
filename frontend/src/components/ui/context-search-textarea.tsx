import { useState, useRef, useCallback, useEffect, forwardRef, useMemo } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { ContextSearchDropdown } from '@/components/ui/context-search-dropdown'
import { useContextSearch, saveRecentMention } from '@/hooks/useContextSearch'
import type { ContextSearchResult } from '@/types/api'
import type { AvailableCommand } from '@/hooks/useSessionUpdateStream'
import { cn } from '@/lib/utils'
import { Loader2, RefreshCw } from 'lucide-react'

interface ContextSearchTextareaProps {
  value: string
  onChange: (value: string) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  projectId: string
  autoResize?: boolean
  maxHeight?: number
  /**
   * Available slash commands from the agent
   * When provided, enables `/` autocomplete at the start of input
   */
  availableCommands?: AvailableCommand[]
  /**
   * Callback to trigger command discovery when "/" is typed and no commands cached
   */
  onDiscoverCommands?: () => void
  /**
   * Whether command discovery is in progress
   */
  isLoadingCommands?: boolean
  /**
   * Callback to refresh commands (bypasses cache)
   */
  onRefreshCommands?: () => void
}

/**
 * Context-aware textarea with @ mention support
 * Detects @ symbol, searches files/specs/issues, and inserts selected results
 */
export const ContextSearchTextarea = forwardRef<HTMLTextAreaElement, ContextSearchTextareaProps>(
  function ContextSearchTextarea(
    {
      value,
      onChange,
      onKeyDown,
      placeholder,
      disabled,
      className,
      projectId,
      autoResize = false,
      maxHeight = 300,
      availableCommands = [],
      onDiscoverCommands,
      isLoadingCommands = false,
      onRefreshCommands,
    },
    ref
  ) {
    // Context search (@ mentions) state
    const [searchQuery, setSearchQuery] = useState('')
    const [showDropdown, setShowDropdown] = useState(false)
    const [selectedIndex, setSelectedIndex] = useState(-1)
    const [atSymbolPosition, setAtSymbolPosition] = useState(-1)

    // Slash command state
    const [slashQuery, setSlashQuery] = useState('')
    const [showSlashDropdown, setShowSlashDropdown] = useState(false)
    const [slashSelectedIndex, setSlashSelectedIndex] = useState(-1)

    const internalRef = useRef<HTMLTextAreaElement>(null)
    const textareaRef = (ref as React.RefObject<HTMLTextAreaElement>) || internalRef
    const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // Cleanup blur timeout on unmount
    useEffect(() => {
      return () => {
        if (blurTimeoutRef.current) {
          clearTimeout(blurTimeoutRef.current)
        }
      }
    }, [])

    // Use context search hook
    const { results, isLoading, error } = useContextSearch({
      query: searchQuery,
      projectId,
      enabled: showDropdown && atSymbolPosition !== -1,
    })

    // Filter available commands based on slash query
    const filteredCommands = useMemo(() => {
      if (!slashQuery && showSlashDropdown) {
        // Show all commands when just `/` is typed
        return availableCommands
      }
      if (!slashQuery) return []
      const query = slashQuery.toLowerCase()
      return availableCommands.filter(
        (cmd) =>
          cmd.name.toLowerCase().includes(query) ||
          cmd.description.toLowerCase().includes(query)
      )
    }, [availableCommands, slashQuery, showSlashDropdown])

    // Auto-resize textarea based on content
    useEffect(() => {
      if (!autoResize) return

      const textarea = textareaRef.current
      if (!textarea) return

      // Save current scroll position
      const scrollTop = textarea.scrollTop

      // Calculate single-line height from computed styles
      const computedStyle = window.getComputedStyle(textarea)
      const lineHeight = parseInt(computedStyle.lineHeight)
      const paddingTop = parseInt(computedStyle.paddingTop)
      const paddingBottom = parseInt(computedStyle.paddingBottom)

      // Single line height = line-height + padding
      const singleLineHeight = lineHeight + paddingTop + paddingBottom

      // TODO: Make sure when there is content that the textarea is sized to a single line (currently two)
      // If textarea is empty or only whitespace, just use single line height
      if (!value || value.trim() === '') {
        textarea.style.height = `${singleLineHeight}px`
      } else {
        // For content, measure scrollHeight
        textarea.style.height = 'auto'
        const scrollHeight = textarea.scrollHeight
        // Calculate new height: use scrollHeight but ensure minimum of single line
        const newHeight = Math.max(singleLineHeight, Math.min(scrollHeight, maxHeight))
        textarea.style.height = `${newHeight}px`
      }
      // Restore scroll position if needed
      textarea.scrollTop = scrollTop
    }, [value, autoResize, maxHeight, textareaRef])

    // Handle text changes and detect @ symbol or / command
    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value
      const cursorPosition = e.target.selectionStart || 0

      onChange(newValue)

      const textBeforeCursor = newValue.slice(0, cursorPosition)

      // Check for / at start of input (slash commands)
      if (textBeforeCursor.startsWith('/')) {
        // Extract text after / until first space or end
        const textAfterSlash = textBeforeCursor.slice(1)
        const spaceIndex = textAfterSlash.search(/\s/)
        const query = spaceIndex === -1 ? textAfterSlash : ''

        // Only show dropdown if we're still typing the command (no space yet)
        if (spaceIndex === -1) {
          // If no commands available and we have a discovery callback, trigger it
          if (availableCommands.length === 0 && onDiscoverCommands) {
            onDiscoverCommands()
          }

          setSlashQuery(query)
          setShowSlashDropdown(true)
          setSlashSelectedIndex(0)
          // Close @ dropdown
          setShowDropdown(false)
          setSearchQuery('')
          setAtSymbolPosition(-1)
          setSelectedIndex(-1)
          return
        }
      }

      // Close slash dropdown if we're not in slash command context
      setShowSlashDropdown(false)
      setSlashQuery('')
      setSlashSelectedIndex(-1)

      // Check for @ symbol before cursor
      const lastAtIndex = textBeforeCursor.lastIndexOf('@')

      if (lastAtIndex !== -1) {
        // Check if @ is at start or preceded by whitespace (not part of email, etc)
        const charBeforeAt = lastAtIndex > 0 ? textBeforeCursor[lastAtIndex - 1] : null
        const isValidAtStart = charBeforeAt === null || /\s/.test(charBeforeAt)

        if (isValidAtStart) {
          // Extract text after @ until cursor
          const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1)
          const hasSpace = textAfterAt.includes(' ') || textAfterAt.includes('\n')

          if (!hasSpace) {
            // Valid @ context - activate search
            setAtSymbolPosition(lastAtIndex)
            setSearchQuery(textAfterAt)
            setShowDropdown(true)
            setSelectedIndex(0) // Auto-select first item
            return
          }
        }
      }

      // No valid @ context - hide dropdown
      setShowDropdown(false)
      setSearchQuery('')
      setAtSymbolPosition(-1)
      setSelectedIndex(-1)
    }

    // Select a result and insert it at cursor
    const selectResult = useCallback(
      (result: ContextSearchResult) => {
        if (atSymbolPosition === -1 || !textareaRef.current) return

        const beforeAt = value.slice(0, atSymbolPosition)
        const afterQuery = value.slice(atSymbolPosition + 1 + searchQuery.length)

        let insertText = ''
        let newCursorPos = atSymbolPosition

        if (result.type === 'file') {
          // Insert @file-path (keeping @ for parsing)
          insertText = '@' + result.insertText
          newCursorPos = atSymbolPosition + insertText.length
        } else if (result.type === 'spec' || result.type === 'issue') {
          // Insert [[entity-id]] (without @ prefix)
          insertText = result.insertText
          newCursorPos = atSymbolPosition + insertText.length
        }

        const newValue = beforeAt + insertText + afterQuery
        onChange(newValue)

        // Track in recent mentions
        if (result.entityId) {
          saveRecentMention(result.entityId)
        }

        // Close dropdown
        setShowDropdown(false)
        setSearchQuery('')
        setAtSymbolPosition(-1)
        setSelectedIndex(-1)

        // Focus and set cursor position
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.focus()
            textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
          }
        }, 0)
      },
      [atSymbolPosition, value, searchQuery, onChange, textareaRef]
    )

    // Select a slash command and insert it
    const selectSlashCommand = useCallback(
      (command: AvailableCommand) => {
        if (!textareaRef.current) return

        // Replace the current /query with /commandname followed by a space
        const commandText = `/${command.name} `
        const afterSlash = value.slice(1 + slashQuery.length)
        const newValue = commandText + afterSlash
        onChange(newValue)

        // Close dropdown
        setShowSlashDropdown(false)
        setSlashQuery('')
        setSlashSelectedIndex(-1)

        // Focus and set cursor position after command
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.focus()
            textareaRef.current.setSelectionRange(commandText.length, commandText.length)
          }
        }, 0)
      },
      [value, slashQuery, onChange, textareaRef]
    )

    // Handle keyboard navigation
    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Handle slash command dropdown navigation first
      if (showSlashDropdown && filteredCommands.length > 0) {
        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault()
            setSlashSelectedIndex((prev) => (prev < filteredCommands.length - 1 ? prev + 1 : 0))
            return
          case 'ArrowUp':
            e.preventDefault()
            setSlashSelectedIndex((prev) => (prev > 0 ? prev - 1 : filteredCommands.length - 1))
            return
          case 'Enter':
          case 'Tab':
            if (slashSelectedIndex >= 0) {
              e.preventDefault()
              selectSlashCommand(filteredCommands[slashSelectedIndex])
              return
            }
            break
          case 'Escape':
            e.preventDefault()
            e.stopPropagation()
            setShowSlashDropdown(false)
            setSlashQuery('')
            setSlashSelectedIndex(-1)
            return
        }
      }

      // Handle @ mention dropdown navigation
      if (showDropdown && results.length > 0) {
        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault()
            setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0))
            return
          case 'ArrowUp':
            e.preventDefault()
            setSelectedIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1))
            return
          case 'Enter':
            if (selectedIndex >= 0) {
              e.preventDefault()
              selectResult(results[selectedIndex])
              return
            }
            break
          case 'Escape':
            e.preventDefault()
            e.stopPropagation() // Prevent event from bubbling to parent components
            setShowDropdown(false)
            setSearchQuery('')
            setAtSymbolPosition(-1)
            setSelectedIndex(-1)
            return
        }
      }

      // Propagate event to parent
      onKeyDown?.(e)
    }

    // Close dropdowns on blur
    const handleBlur = () => {
      // Clear any existing timeout
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current)
      }
      // Delay to allow click events on dropdown to fire
      blurTimeoutRef.current = setTimeout(() => {
        setShowDropdown(false)
        setSearchQuery('')
        setAtSymbolPosition(-1)
        setSelectedIndex(-1)
        setShowSlashDropdown(false)
        setSlashQuery('')
        setSlashSelectedIndex(-1)
      }, 200)
    }

    return (
      <div className="w-full">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={placeholder}
          disabled={disabled}
          className={className}
        />

        {/* Slash command dropdown */}
        {showSlashDropdown && (
          <div className="mt-1">
            <div className="relative rounded-md border bg-popover p-1 shadow-md">
              {/* Floating refresh button */}
              {onRefreshCommands && !isLoadingCommands && filteredCommands.length > 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onRefreshCommands()
                  }}
                  className="absolute right-1.5 top-1.5 z-10 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  title="Refresh commands"
                >
                  <RefreshCw className="h-3 w-3" />
                </button>
              )}
              {isLoadingCommands ? (
                <div className="flex items-center gap-2 px-2 py-1 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Discovering commands...
                </div>
              ) : filteredCommands.length > 0 ? (
                <div className="max-h-[200px] overflow-y-auto">
                  {filteredCommands.map((command, index) => (
                    <button
                      key={command.name}
                      type="button"
                      className={cn(
                        'flex w-full items-baseline gap-2 rounded px-2 py-1 text-left text-sm',
                        index === slashSelectedIndex
                          ? 'bg-accent text-accent-foreground'
                          : 'hover:bg-accent hover:text-accent-foreground'
                      )}
                      onClick={() => selectSlashCommand(command)}
                      onMouseEnter={() => setSlashSelectedIndex(index)}
                      title={`/${command.name} - ${command.description}`}
                    >
                      <span className="shrink-0 font-medium text-foreground">/{command.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {command.description}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="px-2 py-1 text-sm text-muted-foreground">No commands available</div>
              )}
            </div>
          </div>
        )}

        {/* Context search dropdown */}
        {showDropdown && (
          <div className="mt-1">
            <ContextSearchDropdown
              results={results}
              selectedIndex={selectedIndex}
              onSelect={selectResult}
              isLoading={isLoading}
              error={error}
              onClose={() => {
                setShowDropdown(false)
                setSearchQuery('')
                setAtSymbolPosition(-1)
                setSelectedIndex(-1)
              }}
            />
          </div>
        )}
      </div>
    )
  }
)
