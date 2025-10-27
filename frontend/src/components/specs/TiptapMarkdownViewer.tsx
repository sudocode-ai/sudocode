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
import { EntityMention } from './extensions/EntityMention'
import { preprocessEntityMentions } from './extensions/markdown-utils'
import './tiptap.css'

// Create lowlight instance with common languages
const lowlight = createLowlight(common)

interface TiptapMarkdownViewerProps {
  content: string
  className?: string
  onReady?: () => void
}

/**
 * A Tiptap-based markdown viewer that renders markdown content
 * in a rich text format with proper styling.
 *
 * This component converts markdown to HTML and displays it using Tiptap
 * in read-only mode, providing a clean, formatted view of the spec content.
 */
export function TiptapMarkdownViewer({
  content,
  className = '',
  onReady,
}: TiptapMarkdownViewerProps) {
  const [htmlContent, setHtmlContent] = useState<string>('')

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
      EntityMention,
    ],
    editable: false,
    content: htmlContent,
    onUpdate: () => {
      onReady?.()
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
        // Fallback to plain text
        setHtmlContent(`<pre>${content}</pre>`)
      })
  }, [content])

  // Update editor content when HTML changes
  useEffect(() => {
    if (editor && htmlContent) {
      editor.commands.setContent(htmlContent)
    }
  }, [htmlContent, editor])

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
      <EditorContent
        editor={editor}
        className="tiptap-viewer prose prose-sm dark:prose-invert max-w-none"
      />
    </div>
  )
}
