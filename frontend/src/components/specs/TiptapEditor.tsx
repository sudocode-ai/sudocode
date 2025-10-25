import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'
import { useEffect, useState } from 'react'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'
import TurndownService from 'turndown'
import { Button } from '@/components/ui/button'
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
import './tiptap.css'

// Create lowlight instance with common languages
const lowlight = createLowlight(common)

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

interface TiptapEditorProps {
  content: string
  editable?: boolean
  onSave?: (markdown: string) => void
  onCancel?: () => void
  className?: string
}

/**
 * Tiptap editor for markdown content with rich text editing capabilities.
 * Supports both read-only and editable modes with a formatting toolbar.
 */
export function TiptapEditor({
  content,
  editable = false,
  onSave,
  onCancel,
  className = '',
}: TiptapEditorProps) {
  const [htmlContent, setHtmlContent] = useState<string>('')
  const [hasChanges, setHasChanges] = useState(false)

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
      }),
      CodeBlockLowlight.configure({
        lowlight,
        HTMLAttributes: {
          class: 'bg-muted/50 rounded-md p-4 font-mono text-sm my-4 overflow-x-auto',
        },
      }),
      Table.configure({
        resizable: true,
        HTMLAttributes: {
          class: 'border-collapse table-auto w-full my-4',
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
    ],
    editable,
    content: htmlContent,
    onUpdate: () => {
      setHasChanges(true)
    },
  })

  // Convert markdown to HTML when content changes
  useEffect(() => {
    if (!content) {
      setHtmlContent('')
      return
    }

    unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkRehype)
      .use(rehypeStringify)
      .process(content)
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
      editor.commands.setContent(htmlContent)
      setHasChanges(false)
    }
  }, [htmlContent, editor])

  // Update editor editable state
  useEffect(() => {
    if (editor) {
      editor.setEditable(editable)
    }
  }, [editable, editor])

  const handleSave = () => {
    if (!editor || !onSave) return

    // Convert HTML back to markdown
    const html = editor.getHTML()
    const turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      hr: '---',
      emDelimiter: '_',
      strongDelimiter: '**',
    })

    // Add GFM support (tables, strikethrough, task lists)
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

    // Fix list item formatting to prevent extra newlines
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

    const markdown = turndownService.turndown(html)
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
      {editable && (
        <div className="flex flex-wrap items-center gap-1 border-b border-border bg-muted/30 px-4 py-2">
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
      <div className="p-6">
        <EditorContent
          editor={editor}
          className="tiptap-editor prose prose-sm dark:prose-invert max-w-none"
        />
      </div>
    </div>
  )
}
