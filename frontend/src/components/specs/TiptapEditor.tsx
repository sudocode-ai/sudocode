import { useEditor, EditorContent, ReactNodeViewRenderer } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Placeholder from '@tiptap/extension-placeholder'
import TableOfContents from '@tiptap/extension-table-of-contents'
import { common, createLowlight } from 'lowlight'
import { useEffect, useState, useRef } from 'react'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'
import TurndownService from 'turndown'
import { Button } from '@/components/ui/button'
import { calculateMarkdownLineNumbers } from '@/lib/markdown'
import {
  Bold,
  Italic,
  Code,
  CodeSquare,
  List,
  ListOrdered,
  Quote,
  Heading1,
  Heading2,
  Heading3,
  Undo,
  Redo,
  ImageIcon,
  Table as TableIcon,
} from 'lucide-react'
import { Extension } from '@tiptap/core'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableCell } from '@tiptap/extension-table-cell'
import Image from '@tiptap/extension-image'
import { ListKit } from '@tiptap/extension-list'
import { TableWithControls } from './TableWithControls'
import { EntityMention } from './extensions/EntityMention'
import { FeedbackMark } from './extensions/FeedbackMark'
import { preprocessEntityMentions } from './extensions/markdown-utils'
import type { IssueFeedback } from '@/types/api'
import './tiptap.css'

export interface TocItem {
  id: string
  level: number
  textContent: string
  isActive: boolean
  isScrolledOver: boolean
}

// Create lowlight instance with common languages
const lowlight = createLowlight(common)

/**
 * Create a configured TurndownService instance with all custom rules
 * Used by getMarkdownFromEditor to ensure consistent markdown output
 *
 * @remarks Exported for testing purposes
 */
export function createConfiguredTurndownService(): TurndownService {
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    hr: '---',
    emDelimiter: '_',
    strongDelimiter: '**',
  })

  // Add GFM support (strikethrough)
  turndownService.addRule('strikethrough', {
    filter: ['del', 's'] as any,
    replacement: (content) => `~~${content}~~`,
  })

  // Add table support
  turndownService.addRule('table', {
    filter: 'table',
    replacement: (content) => {
      return '\n' + content + '\n'
    },
  })

  turndownService.addRule('tableRow', {
    filter: 'tr',
    replacement: (content, node) => {
      const row = '|' + content + '\n'

      // Check if this row contains header cells (th elements)
      const headerCells = (node as HTMLElement).querySelectorAll('th')
      if (headerCells.length > 0) {
        // Add separator row after header row
        const separatorRow =
          '|' +
          Array.from(headerCells)
            .map(() => ' --- |')
            .join('') +
          '\n'
        return row + separatorRow
      }

      return row
    },
  })

  turndownService.addRule('tableCell', {
    filter: ['th', 'td'],
    replacement: (content) => {
      return ' ' + content.trim() + ' |'
    },
  })

  // Fix list item formatting to prevent extra newlines and spaces
  turndownService.addRule('listItem', {
    filter: 'li',
    replacement: (content, node) => {
      // Remove leading/trailing newlines from content
      content = content.trim().replace(/\n\n/g, '\n')

      const parent = node.parentNode
      if (!parent) return content

      const prefix = /ol/i.test(parent.nodeName) ? '1. ' : '- '
      const postfix = '\n'

      return prefix + content.replace(/\n/g, '\n  ') + postfix
    },
  })

  // Handle entity mentions - convert spans directly to [[ENTITY-ID]] format
  turndownService.addRule('entityMention', {
    filter: (node) => {
      return node.nodeName === 'SPAN' && node.hasAttribute('data-entity-id')
    },
    replacement: (content, node) => {
      const element = node as HTMLElement
      const entityId = element.getAttribute('data-entity-id')
      const displayText = element.getAttribute('data-display-text')
      const relationshipType = element.getAttribute('data-relationship-type')

      if (!entityId) return content

      let ref = `[[${entityId}`

      if (displayText) {
        ref += `|${displayText}`
      }

      ref += ']]'

      if (relationshipType) {
        ref += `{ ${relationshipType} }`
      }

      return ref
    },
  })

  return turndownService
}

/**
 * Convert editor HTML content to markdown using configured TurndownService.
 * This is the single source of truth for HTML→MD conversion, ensuring consistent
 * output across all use cases (autosave, explicit save, reference comparison).
 *
 * IMPORTANT: This function produces "round-tripped" markdown - the result of
 * MD→HTML→MD conversion. Due to lossy transformations (e.g., list formatting),
 * the output may differ from the original markdown input.
 */
function getMarkdownFromEditor(editor: ReturnType<typeof useEditor>): string {
  if (!editor) return ''
  const html = editor.getHTML()
  const turndownService = createConfiguredTurndownService()
  return turndownService.turndown(html)
}

/**
 * Convert HTML to markdown using the configured TurndownService.
 * This is the HTML→MD portion of the round-trip conversion.
 *
 * @remarks Exported for testing purposes - allows unit testing the HTML→MD conversion
 * without needing a full TipTap editor instance.
 */
export function htmlToMarkdown(html: string): string {
  const turndownService = createConfiguredTurndownService()
  return turndownService.turndown(html)
}

/**
 * Perform a full round-trip conversion: Markdown → HTML → Markdown.
 * This simulates what TipTap does internally when content is loaded and then
 * converted back to markdown.
 *
 * @remarks Exported for testing purposes - allows unit testing the round-trip
 * conversion without needing a full TipTap editor instance.
 *
 * @param markdown - Original markdown content
 * @returns Promise resolving to the round-tripped markdown
 */
export async function roundTripMarkdown(markdown: string): Promise<string> {
  // MD → HTML (same pipeline as TiptapEditor useEffect)
  const html = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(markdown)
    .then((file) => String(file))

  // HTML → MD (same as getMarkdownFromEditor)
  return htmlToMarkdown(html)
}

// Custom extension to handle Tab key for indentation
const TabHandler = Extension.create({
  name: 'tabHandler',

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        // Check if we're in a list
        const { state } = this.editor
        const { $from } = state.selection
        const listItem = $from.node($from.depth - 1)

        if (listItem && listItem.type.name === 'listItem') {
          // Sink the list item (increase indent)
          return this.editor.commands.sinkListItem('listItem')
        }

        // If not in a list, insert tab spaces
        return this.editor.commands.insertContent('\t')
      },
      'Shift-Tab': () => {
        // Check if we're in a list
        const { state } = this.editor
        const { $from } = state.selection
        const listItem = $from.node($from.depth - 1)

        if (listItem && listItem.type.name === 'listItem') {
          // Lift the list item (decrease indent)
          return this.editor.commands.liftListItem('listItem')
        }

        return false
      },
    }
  },
})

// Custom extension to add line numbers to block elements
const LineNumbers = Extension.create({
  name: 'lineNumbers',

  addGlobalAttributes() {
    return [
      {
        types: ['heading', 'paragraph', 'codeBlock', 'blockquote', 'orderedList', 'bulletList'],
        attributes: {
          lineNumber: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-line-number'),
            renderHTML: (attributes) => {
              if (!attributes.lineNumber) {
                return {}
              }
              return {
                'data-line-number': attributes.lineNumber,
              }
            },
          },
        },
      },
    ]
  },
})

interface TiptapEditorProps {
  content: string
  editable?: boolean
  onSave?: (markdown: string) => void
  onChange?: (markdown: string) => void
  onCancel?: () => void
  className?: string
  showToolbar?: boolean
  feedback?: IssueFeedback[]
  onFeedbackClick?: (feedbackId: string) => void
  showLineNumbers?: boolean
  selectedLine?: number | null
  onLineClick?: (lineNumber: number) => void
  placeholder?: string
  onTocUpdate?: (items: TocItem[]) => void
}

/**
 * Tiptap editor for markdown content with rich text editing capabilities.
 * Supports both read-only and editable modes with a formatting toolbar.
 *
 * Feedback Integration:
 * - Accepts optional feedback array for displaying inline feedback highlights
 * - FeedbackMark extension renders <mark> elements with data-feedback-id attributes
 * - Click handler calls onFeedbackClick when feedback marks are clicked
 * - Note: Actual mark application based on feedback anchors happens at the parent level
 *   (e.g., SpecDetailPage) since it requires mapping line numbers to content positions
 */
export function TiptapEditor({
  content,
  editable = false,
  onSave,
  onChange,
  onCancel,
  className = '',
  showToolbar = false,
  feedback: _feedback = [], // Reserved for future use
  onFeedbackClick,
  showLineNumbers = false,
  selectedLine,
  onLineClick,
  placeholder,
  onTocUpdate,
}: TiptapEditorProps) {
  const [htmlContent, setHtmlContent] = useState<string>('')
  const [hasChanges, setHasChanges] = useState(false)
  const isLoadingContentRef = useRef(false)
  const lastContentRef = useRef<string>('')

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3, 4, 5, 6],
          HTMLAttributes: {
            class: 'font-bold',
          },
        },
        // Disable default codeBlock to use CodeBlockLowlight instead
        codeBlock: false,
        code: {
          HTMLAttributes: {
            class: 'bg-muted/50 rounded px-1.5 py-0.5 font-mono text-sm',
          },
        },
        blockquote: {
          HTMLAttributes: {
            class: 'border-l-4 border-primary/50 pl-4 italic text-muted-foreground my-4',
          },
        },
        // Disable default list extensions to use ListKit instead
        bulletList: false,
        orderedList: false,
        listItem: false,
        listKeymap: false,
      }),
      CodeBlockLowlight.configure({
        lowlight,
        HTMLAttributes: {
          class: 'bg-muted/50 rounded-md p-4 font-mono text-sm my-4 overflow-x-auto',
        },
      }),
      Placeholder.configure({
        placeholder: placeholder,
        emptyEditorClass: 'is-editor-empty',
      }),
      Table.extend({
        addNodeView() {
          return ReactNodeViewRenderer(TableWithControls)
        },
      }).configure({
        resizable: true,
        HTMLAttributes: {
          class: 'border-collapse table-auto w-full',
        },
      }),
      TableRow,
      TableHeader.configure({
        HTMLAttributes: {
          class: 'border border-border bg-muted/50 px-4 py-2 text-left font-bold',
        },
      }),
      TableCell.configure({
        HTMLAttributes: {
          class: 'border border-border px-4 py-2',
        },
      }),
      Image.configure({
        HTMLAttributes: {
          class: 'max-w-full h-auto rounded-md my-4',
        },
      }),
      ListKit,
      TabHandler,
      LineNumbers,
      EntityMention,
      FeedbackMark,
      TableOfContents.configure({
        onUpdate: (content) => {
          // Call onTocUpdate callback if provided
          if (onTocUpdate) {
            onTocUpdate(content)
          }
        },
      }),
    ],
    editable,
    content: htmlContent,
    onUpdate: ({ editor }) => {
      // Guard against updates while loading external content
      if (isLoadingContentRef.current) {
        return
      }

      setHasChanges(true)

      // Call onChange callback if provided (for autosave)
      if (onChange) {
        const markdown = getMarkdownFromEditor(editor)

        // Only call onChange if content actually changed
        if (markdown !== lastContentRef.current) {
          lastContentRef.current = markdown
          onChange(markdown)
        }
      }
    },
  })

  // Convert markdown to HTML when content changes
  useEffect(() => {
    if (!content) {
      setHtmlContent('')
      return
    }

    // Preprocess markdown to convert [[ENTITY-ID]] to HTML spans
    const preprocessedContent = preprocessEntityMentions(content)

    unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeStringify, { allowDangerousHtml: true })
      .process(preprocessedContent)
      .then((file) => {
        setHtmlContent(String(file))
      })
      .catch((error) => {
        console.error('Failed to convert markdown to HTML:', error)
        setHtmlContent(`<pre>${content}</pre>`)
      })
  }, [content])

  // Update editor content when HTML changes
  useEffect(() => {
    if (editor && htmlContent) {
      // Only update content if editor is not focused (i.e., change is from external source)
      // This prevents losing cursor position during auto-save
      if (!editor.isFocused) {
        isLoadingContentRef.current = true
        // Set emitUpdate to true to trigger TOC update
        editor.commands.setContent(htmlContent, { emitUpdate: true })
        // Reset hasChanges since we're loading external content
        setHasChanges(false)

        // CRITICAL FIX: Store the round-tripped markdown, not the original.
        // TipTap's HTML conversion is lossy (e.g., "\n  - " becomes "\n\n- ").
        // If we store the original, subsequent onUpdate comparisons will always
        // show a diff, triggering false-positive auto-saves and sync oscillation.
        const roundTrippedMarkdown = getMarkdownFromEditor(editor)
        lastContentRef.current = roundTrippedMarkdown

        // Keep the guard up for a bit longer to catch any delayed events
        setTimeout(() => {
          isLoadingContentRef.current = false
        }, 100)
      }
      // Don't reset hasChanges if editor is focused - user is actively editing
    }
  }, [htmlContent, editor, content])

  // Update editor editable state
  useEffect(() => {
    if (editor) {
      editor.setEditable(editable)
    }
  }, [editable, editor])

  // Handle clicks on feedback marks
  useEffect(() => {
    if (!editor || !onFeedbackClick) return

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement

      // Check if the clicked element or its parent has data-feedback-id
      const markElement = target.closest('[data-feedback-id]') as HTMLElement
      if (markElement) {
        const feedbackId = markElement.getAttribute('data-feedback-id')
        if (feedbackId) {
          onFeedbackClick(feedbackId)
        }
      }
    }

    const editorElement = editor.view.dom
    editorElement.addEventListener('click', handleClick)

    return () => {
      editorElement.removeEventListener('click', handleClick)
    }
  }, [editor, onFeedbackClick])

  // Calculate and set line numbers based on markdown source
  useEffect(() => {
    if (!editor || !showLineNumbers || !content) return

    const applyLineNumbers = () => {
      const blockLineNumbers = calculateMarkdownLineNumbers(content)

      // Apply line numbers to nodes using Tiptap transactions
      const { state } = editor
      const { tr } = state
      let nodeIndex = 0

      // Iterate through top-level blocks using descendants with depth check
      state.doc.descendants((node, pos, parent) => {
        // Only process direct children of the document (depth 0 means doc, depth 1 means top-level blocks)
        if (parent === state.doc && node.isBlock) {
          const lineNumber = blockLineNumbers[nodeIndex] || nodeIndex + 1

          tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            lineNumber: String(lineNumber),
          })

          nodeIndex++
          // Don't descend into children of this block
          return false
        }
        // Continue descending for non-block nodes
        return true
      })

      if (tr.docChanged) {
        editor.view.dispatch(tr)
      }
    }

    // Use setTimeout to ensure the editor has finished rendering
    const timeoutId = setTimeout(() => {
      applyLineNumbers()
    }, 100)

    return () => {
      clearTimeout(timeoutId)
    }
  }, [editor, showLineNumbers, content])

  // Handle line number clicks
  useEffect(() => {
    if (!editor || !showLineNumbers) return

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement

      // Check if clicking on the line number pseudo-element area
      const blockElement = target.closest('.ProseMirror > *') as HTMLElement
      if (!blockElement) return

      // Get the line number from the data attribute
      const lineNumber = parseInt(blockElement.getAttribute('data-line-number') || '0')

      if (lineNumber > 0 && onLineClick) {
        onLineClick(lineNumber)
      }
    }

    const editorElement = editor.view.dom
    editorElement.addEventListener('click', handleClick)

    return () => {
      editorElement.removeEventListener('click', handleClick)
    }
  }, [editor, showLineNumbers, onLineClick])

  // Update selected line styling based on markdown line numbers
  useEffect(() => {
    if (!editor || !showLineNumbers) return

    // Remove previous selection
    const allBlocks = editor.view.dom.querySelectorAll('.ProseMirror > *')
    allBlocks.forEach((block) => block.classList.remove('selected-line'))

    // Add selection to current line by matching the line number
    if (selectedLine && selectedLine > 0) {
      allBlocks.forEach((block) => {
        const blockLine = parseInt((block as HTMLElement).getAttribute('data-line-number') || '0')
        if (blockLine === selectedLine) {
          block.classList.add('selected-line')
        }
      })
    }
  }, [editor, showLineNumbers, selectedLine])

  const handleSave = () => {
    if (!editor || !onSave) return

    // Convert HTML back to markdown using the shared helper
    const markdown = getMarkdownFromEditor(editor)

    onSave(markdown)
    setHasChanges(false)
  }

  const handleCancel = () => {
    if (editor) {
      // Reset to original content
      editor.commands.setContent(htmlContent)
      setHasChanges(false)
    }
    onCancel?.()
  }

  const handleInsertImage = () => {
    const url = window.prompt('Enter image URL:')
    if (url && editor) {
      editor.chain().focus().setImage({ src: url }).run()
    }
  }

  const handleInsertTable = () => {
    if (editor) {
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
    }
  }

  if (!editor) {
    return (
      <div className={className}>
        <div className="animate-pulse">
          <div className="mb-2 h-4 w-3/4 rounded bg-muted"></div>
          <div className="mb-2 h-4 w-1/2 rounded bg-muted"></div>
          <div className="h-4 w-5/6 rounded bg-muted"></div>
        </div>
      </div>
    )
  }

  return (
    <div className={className}>
      {/* Toolbar - only show in editable mode */}
      {editable && showToolbar && (
        <div className="flex flex-wrap items-center gap-1 border-b border-border bg-muted/30 pl-2 pr-4 py-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={editor.isActive('bold') ? 'bg-muted' : ''}
            type="button"
          >
            <Bold className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={editor.isActive('italic') ? 'bg-muted' : ''}
            type="button"
          >
            <Italic className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleCode().run()}
            className={editor.isActive('code') ? 'bg-muted' : ''}
            type="button"
          >
            <Code className="h-4 w-4" />
          </Button>

          <div className="mx-1 h-6 w-px bg-border" />

          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            className={editor.isActive('heading', { level: 1 }) ? 'bg-muted' : ''}
            type="button"
          >
            <Heading1 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            className={editor.isActive('heading', { level: 2 }) ? 'bg-muted' : ''}
            type="button"
          >
            <Heading2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            className={editor.isActive('heading', { level: 3 }) ? 'bg-muted' : ''}
            type="button"
          >
            <Heading3 className="h-4 w-4" />
          </Button>

          <div className="mx-1 h-6 w-px bg-border" />

          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={editor.isActive('bulletList') ? 'bg-muted' : ''}
            type="button"
          >
            <List className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={editor.isActive('orderedList') ? 'bg-muted' : ''}
            type="button"
          >
            <ListOrdered className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            className={editor.isActive('blockquote') ? 'bg-muted' : ''}
            type="button"
          >
            <Quote className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            className={editor.isActive('codeBlock') ? 'bg-muted' : ''}
            type="button"
          >
            <CodeSquare className="h-4 w-4" />
          </Button>

          <div className="mx-1 h-6 w-px bg-border" />

          <Button
            variant="ghost"
            size="sm"
            onClick={handleInsertTable}
            className={editor.isActive('table') ? 'bg-muted' : ''}
            type="button"
          >
            <TableIcon className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={handleInsertImage} type="button">
            <ImageIcon className="h-4 w-4" />
          </Button>

          <div className="mx-1 h-6 w-px bg-border" />

          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
            type="button"
          >
            <Undo className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
            type="button"
          >
            <Redo className="h-4 w-4" />
          </Button>

          <div className="flex-1" />

          {/* Save/Cancel buttons */}
          <Button variant="outline" size="sm" onClick={handleCancel} type="button">
            Cancel
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleSave}
            disabled={!hasChanges}
            type="button"
          >
            Save
          </Button>
        </div>
      )}

      {/* Editor content */}
      <div className={`pl-3 pr-6 py-6 ${showLineNumbers ? 'tiptap-with-line-numbers' : ''}`}>
        <EditorContent
          editor={editor}
          className="tiptap-editor prose prose-sm dark:prose-invert max-w-none"
        />
      </div>
    </div>
  )
}
