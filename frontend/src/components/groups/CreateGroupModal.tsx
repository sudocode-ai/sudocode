import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { CreateIssueGroupRequest } from '@/types/api'

interface CreateGroupModalProps {
  isOpen: boolean
  onClose: () => void
  onCreate: (data: CreateIssueGroupRequest) => void
  isCreating?: boolean
}

const DEFAULT_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#f59e0b', // amber
  '#84cc16', // lime
  '#10b981', // emerald
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
]

export function CreateGroupModal({
  isOpen,
  onClose,
  onCreate,
  isCreating = false,
}: CreateGroupModalProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [baseBranch, setBaseBranch] = useState('main')
  const [workingBranch, setWorkingBranch] = useState('')
  const [color, setColor] = useState(DEFAULT_COLORS[5])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!name.trim() || !baseBranch.trim() || !workingBranch.trim()) {
      return
    }

    onCreate({
      name: name.trim(),
      description: description.trim() || undefined,
      baseBranch: baseBranch.trim(),
      workingBranch: workingBranch.trim(),
      color,
    })

    // Reset form
    setName('')
    setDescription('')
    setBaseBranch('main')
    setWorkingBranch('')
    setColor(DEFAULT_COLORS[5])
  }

  const handleClose = () => {
    // Reset form on close
    setName('')
    setDescription('')
    setBaseBranch('main')
    setWorkingBranch('')
    setColor(DEFAULT_COLORS[5])
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Issue Group</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="name">
              Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter group name"
              required
              autoFocus
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of this group"
              rows={3}
            />
          </div>

          {/* Base Branch */}
          <div className="space-y-2">
            <Label htmlFor="baseBranch">
              Base Branch <span className="text-red-500">*</span>
            </Label>
            <Input
              id="baseBranch"
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
              placeholder="main"
              required
            />
            <p className="text-xs text-muted-foreground">
              The branch to create the working branch from
            </p>
          </div>

          {/* Working Branch */}
          <div className="space-y-2">
            <Label htmlFor="workingBranch">
              Working Branch <span className="text-red-500">*</span>
            </Label>
            <Input
              id="workingBranch"
              value={workingBranch}
              onChange={(e) => setWorkingBranch(e.target.value)}
              placeholder="feature/my-feature"
              required
            />
            <p className="text-xs text-muted-foreground">
              All issues in this group will share this branch
            </p>
          </div>

          {/* Color */}
          <div className="space-y-2">
            <Label htmlFor="color">Color</Label>
            <div className="flex items-center gap-2">
              <div className="flex flex-wrap gap-2">
                {DEFAULT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`h-8 w-8 rounded-full border-2 transition-all ${
                      color === c ? 'border-foreground scale-110' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: c }}
                    title={c}
                  />
                ))}
              </div>
              <Input
                id="color"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-8 w-16 cursor-pointer"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={handleClose} disabled={isCreating}>
              Cancel
            </Button>
            <Button type="submit" disabled={isCreating || !name || !baseBranch || !workingBranch}>
              {isCreating ? 'Creating...' : 'Create Group'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
