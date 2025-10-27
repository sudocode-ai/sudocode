import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { EntityMentionComponent } from './EntityMentionComponent'

export interface EntityMentionOptions {
  HTMLAttributes: Record<string, any>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    entityMention: {
      setEntityMention: (entityId: string) => ReturnType
    }
  }
}

/**
 * EntityMention extension for Tiptap
 *
 * Renders [[ISSUE-ID]] and [[SPEC-ID]] mentions as interactive React components.
 * This extension creates inline, atomic nodes that display entity mentions as badges
 * with links to the entity pages.
 *
 * Future enhancements will include:
 * - Run button for executing entities
 * - Run status indicators
 * - Agent message display
 */
export const EntityMention = Node.create<EntityMentionOptions>({
  name: 'entityMention',

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  // Inline node that flows with text
  inline: true,

  // Part of the inline content group
  group: 'inline',

  // Atomic node - cannot have its content edited
  atom: true,

  addAttributes() {
    return {
      entityId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-entity-id'),
        renderHTML: (attributes) => {
          if (!attributes.entityId) {
            return {}
          }
          return {
            'data-entity-id': attributes.entityId,
          }
        },
      },
      entityType: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-entity-type'),
        renderHTML: (attributes) => {
          if (!attributes.entityType) {
            return {}
          }
          return {
            'data-entity-type': attributes.entityType,
          }
        },
      },
      displayText: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-display-text'),
        renderHTML: (attributes) => {
          if (!attributes.displayText) {
            return {}
          }
          return {
            'data-display-text': attributes.displayText,
          }
        },
      },
      relationshipType: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-relationship-type'),
        renderHTML: (attributes) => {
          if (!attributes.relationshipType) {
            return {}
          }
          return {
            'data-relationship-type': attributes.relationshipType,
          }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-entity-id]',
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(
        { 'data-entity-id': node.attrs.entityId },
        { 'data-entity-type': node.attrs.entityType },
        this.options.HTMLAttributes,
        HTMLAttributes
      ),
      node.attrs.entityId,
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(EntityMentionComponent)
  },

  addCommands() {
    return {
      setEntityMention:
        (entityId: string) =>
        ({ commands }) => {
          const entityType = entityId.startsWith('ISSUE-') ? 'issue' : 'spec'
          return commands.insertContent({
            type: this.name,
            attrs: {
              entityId,
              entityType,
            },
          })
        },
    }
  },
})
