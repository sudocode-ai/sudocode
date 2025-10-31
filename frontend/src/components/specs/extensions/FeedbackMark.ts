/**
 * FeedbackMark - Custom Tiptap mark extension for highlighting text with feedback
 *
 * This extension adds visual highlighting to text that has associated feedback/comments.
 * It renders as a <mark> element with data attributes for tracking.
 */

import { Mark } from '@tiptap/core'

export interface FeedbackMarkOptions {
  /**
   * HTML attributes to apply to the mark element
   */
  HTMLAttributes: Record<string, any>
}

/**
 * FeedbackMark extension for Tiptap
 *
 * Usage:
 * ```typescript
 * const editor = useEditor({
 *   extensions: [
 *     StarterKit,
 *     FeedbackMark,
 *   ],
 * })
 *
 * // Apply mark to selection
 * editor.chain().focus().setMark('feedbackHighlight', { feedbackId: 'FB-001' }).run()
 * ```
 */
export const FeedbackMark = Mark.create<FeedbackMarkOptions>({
  name: 'feedbackHighlight',

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  addAttributes() {
    return {
      feedbackId: {
        default: null,
        // Parse the data-feedback-id attribute from HTML
        parseHTML: element => element.getAttribute('data-feedback-id'),
        // Render the data-feedback-id attribute to HTML
        renderHTML: attributes => {
          if (!attributes.feedbackId) {
            return {}
          }
          return {
            'data-feedback-id': attributes.feedbackId,
          }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'mark[data-feedback-id]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'mark',
      {
        ...this.options.HTMLAttributes,
        ...HTMLAttributes,
        class: 'feedback-highlight bg-yellow-100 cursor-pointer hover:bg-yellow-200 transition-colors',
      },
      0, // Content slot
    ]
  },

  /**
   * Add commands for applying/removing the mark
   */
  addCommands() {
    return {
      setFeedbackHighlight: (attributes?: { feedbackId?: string }) => ({ commands }) => {
        return commands.setMark(this.name, attributes)
      },
      toggleFeedbackHighlight: (attributes?: { feedbackId?: string }) => ({ commands }) => {
        return commands.toggleMark(this.name, attributes)
      },
      unsetFeedbackHighlight: () => ({ commands }) => {
        return commands.unsetMark(this.name)
      },
    }
  },
})

// Type augmentation for Tiptap commands
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    feedbackHighlight: {
      /**
       * Set feedback highlight mark with optional feedback ID
       */
      setFeedbackHighlight: (attributes?: { feedbackId?: string }) => ReturnType
      /**
       * Toggle feedback highlight mark with optional feedback ID
       */
      toggleFeedbackHighlight: (attributes?: { feedbackId?: string }) => ReturnType
      /**
       * Remove feedback highlight mark
       */
      unsetFeedbackHighlight: () => ReturnType
    }
  }
}
