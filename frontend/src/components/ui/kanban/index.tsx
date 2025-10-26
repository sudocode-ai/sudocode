'use client'

import { Card } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { DragEndEvent, Modifier } from '@dnd-kit/core'
import {
  DndContext,
  PointerSensor,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { type ReactNode, type Ref, type KeyboardEvent } from 'react'

import { Plus } from 'lucide-react'
import type { ClientRect } from '@dnd-kit/core'
import type { Transform } from '@dnd-kit/utilities'
import { Button } from '../button'
export type { DragEndEvent } from '@dnd-kit/core'

export type Status = {
  id: string
  name: string
  color: string
}

export type KanbanBoardProps = {
  id: Status['id']
  children: ReactNode
  className?: string
}

export const KanbanBoard = ({ id, children, className }: KanbanBoardProps) => {
  const { isOver, setNodeRef } = useDroppable({ id })

  return (
    <div
      className={cn(
        'flex h-full min-h-40 flex-col',
        isOver ? 'outline-primary' : 'outline-border',
        className
      )}
      ref={setNodeRef}
    >
      {children}
    </div>
  )
}

export type KanbanCardProps = {
  id: string
  name: string
  index: number
  parent: string
  children?: ReactNode
  className?: string
  onClick?: () => void
  tabIndex?: number
  forwardedRef?: Ref<HTMLDivElement>
  onKeyDown?: (e: KeyboardEvent) => void
  isOpen?: boolean
}

export const KanbanCard = ({
  id,
  name,
  index,
  parent,
  children,
  className,
  onClick,
  tabIndex,
  forwardedRef,
  onKeyDown,
  isOpen,
}: KanbanCardProps) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id,
    data: { index, parent },
  })

  // Combine DnD ref and forwarded ref
  const combinedRef = (node: HTMLDivElement | null) => {
    setNodeRef(node)
    if (typeof forwardedRef === 'function') {
      forwardedRef(node)
    } else if (forwardedRef && typeof forwardedRef === 'object') {
      ;(forwardedRef as React.MutableRefObject<HTMLDivElement | null>).current = node
    }
  }

  return (
    <Card
      className={cn(
        'flex-col space-y-2 border-b p-3 outline-none',
        isDragging && 'cursor-grabbing',
        isOpen && 'ring-2 ring-inset ring-secondary-foreground',
        className
      )}
      {...listeners}
      {...attributes}
      ref={combinedRef}
      tabIndex={tabIndex}
      onClick={onClick}
      onKeyDown={onKeyDown}
      style={{
        zIndex: isDragging ? 1000 : 1,
        transform: transform ? `translateX(${transform.x}px) translateY(${transform.y}px)` : 'none',
      }}
    >
      {children ?? <p className="m-0 text-sm font-medium">{name}</p>}
    </Card>
  )
}

export type KanbanCardsProps = {
  children: ReactNode
  className?: string
}

export const KanbanCards = ({ children, className }: KanbanCardsProps) => (
  <div className={cn('flex flex-1 flex-col', className)}>{children}</div>
)

export type KanbanHeaderProps =
  | {
      children: ReactNode
    }
  | {
      name: Status['name']
      color: Status['color']
      className?: string
      onAddIssue?: () => void
    }

export const KanbanHeader = (props: KanbanHeaderProps) => {
  if ('children' in props) {
    return props.children
  }

  return (
    <Card
      className={cn(
        'sticky top-0 z-20 flex flex shrink-0 items-center gap-2 gap-2 border-b border-dashed p-3',
        'bg-background',
        props.className
      )}
      style={{
        backgroundImage: `linear-gradient(hsl(var(${props.color}) / 0.03), hsl(var(${props.color}) / 0.03))`,
      }}
    >
      <span className="flex flex-1 items-center gap-2">
        <div
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: `hsl(var(${props.color}))` }}
        />

        <p className="m-0 text-sm">{props.name}</p>
      </span>
      {props.onAddIssue && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                className="m-0 h-0 p-0 text-foreground/50 hover:text-foreground"
                onClick={props.onAddIssue}
                aria-label="Add Issue"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Add Issue</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </Card>
  )
}

function restrictToBoundingRectWithRightPadding(
  transform: Transform,
  rect: ClientRect,
  boundingRect: ClientRect,
  rightPadding: number
): Transform {
  const value = {
    ...transform,
  }

  if (rect.top + transform.y <= boundingRect.top) {
    value.y = boundingRect.top - rect.top
  } else if (rect.bottom + transform.y >= boundingRect.top + boundingRect.height) {
    value.y = boundingRect.top + boundingRect.height - rect.bottom
  }

  if (rect.left + transform.x <= boundingRect.left) {
    value.x = boundingRect.left - rect.left
  } else if (
    // branch that checks if the right edge of the dragged element is beyond
    // the right edge of the bounding rectangle
    rect.right + transform.x + rightPadding >=
    boundingRect.left + boundingRect.width
  ) {
    value.x = boundingRect.left + boundingRect.width - rect.right - rightPadding
  }

  return {
    ...value,
    x: value.x,
  }
}

// An alternative to `restrictToFirstScrollableAncestor` from the dnd-kit library
const restrictToFirstScrollableAncestorCustom: Modifier = (args) => {
  const { draggingNodeRect, transform, scrollableAncestorRects } = args
  const firstScrollableAncestorRect = scrollableAncestorRects[0]

  if (!draggingNodeRect || !firstScrollableAncestorRect) {
    return transform
  }

  // Inset the right edge that the rect can be dragged to by this amount.
  // This is a workaround for the kanban board where dragging a card too far
  // to the right causes infinite horizontal scrolling if there are also
  // enough cards for vertical scrolling to be enabled.
  const rightPadding = 16
  return restrictToBoundingRectWithRightPadding(
    transform,
    draggingNodeRect,
    firstScrollableAncestorRect,
    rightPadding
  )
}

export type KanbanProviderProps = {
  children: ReactNode
  onDragEnd: (event: DragEndEvent) => void
  className?: string
}

export const KanbanProvider = ({ children, onDragEnd, className }: KanbanProviderProps) => {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  )

  return (
    <DndContext
      collisionDetection={rectIntersection}
      onDragEnd={onDragEnd}
      sensors={sensors}
      modifiers={[restrictToFirstScrollableAncestorCustom]}
    >
      <div
        className={cn(
          'inline-grid h-full auto-cols-[minmax(200px,400px)] grid-flow-col divide-x border-x',
          className
        )}
      >
        {children}
      </div>
    </DndContext>
  )
}
