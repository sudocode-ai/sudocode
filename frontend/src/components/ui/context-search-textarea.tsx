import { useState, useRef, useCallback, useEffect, forwardRef } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { ContextSearchDropdown } from '@/components/ui/context-search-dropdown'
import { useContextSearch, saveRecentMention } from '@/hooks/useContextSearch'
import type { ContextSearchResult } from '@/types/api'

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
    },
    ref
  ) {
    const [searchQuery, setSearchQuery] = useState('')
    const [showDropdown, setShowDropdown] = useState(false)
    const [selectedIndex, setSelectedIndex] = useState(-1)
    const [atSymbolPosition, setAtSymbolPosition] = useState(-1)

    const internalRef = useRef<HTMLTextAreaElement>(null)
    const textareaRef = (ref as React.RefObject<HTMLTextAreaElement>) || internalRef

    // Use context search hook
    const { results, isLoading, error } = useContextSearch({
      query: searchQuery,
      projectId,
      enabled: showDropdown && atSymbolPosition !== -1,
    })

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

    // Handle text changes and detect @ symbol
    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value
      const cursorPosition = e.target.selectionStart || 0

      onChange(newValue)

      // Check for @ symbol before cursor
      const textBeforeCursor = newValue.slice(0, cursorPosition)
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


    // Handle keyboard navigation
    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Handle dropdown navigation first
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

    // Close dropdown on blur
    const handleBlur = () => {
      // Delay to allow click events on dropdown to fire
      setTimeout(() => {
        setShowDropdown(false)
        setSearchQuery('')
        setAtSymbolPosition(-1)
        setSelectedIndex(-1)
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
