import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ExternalLink, FileText, MessageCircle, Github as GitHub } from 'lucide-react'
import { cn } from '@/lib/utils'

interface HelpDialogProps {
  isOpen: boolean
  onClose: () => void
}

export function HelpDialog({ isOpen, onClose }: HelpDialogProps) {
  const helpLinks = [
    {
      title: 'Docs',
      description: 'Learn how to use sudocode',
      url: 'https://docs.sudocode.ai',
      icon: FileText,
    },
    {
      title: 'GitHub Issues',
      description: 'Report bugs or request features',
      url: 'https://github.com/sudocode-ai/sudocode/issues',
      icon: GitHub,
    },
    {
      title: 'Discord Community',
      description: 'Join our community for help and discussion',
      url: 'https://discord.gg/T3kR4EzQ6V',
      icon: MessageCircle,
    },
  ]

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Resources</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-4">
          {helpLinks.map((link) => {
            const Icon = link.icon
            return (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  'flex items-start gap-3 rounded-lg border border-border p-4 transition-colors',
                  'hover:border-accent-foreground/20 hover:bg-accent'
                )}
              >
                <Icon className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium text-foreground">{link.title}</h3>
                    <ExternalLink className="h-3 w-3 text-muted-foreground" />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{link.description}</p>
                </div>
              </a>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
