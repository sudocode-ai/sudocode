import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { FileText, ListTodo, GitBranch, X, Settings, HelpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { ProjectSwitcher } from '@/components/projects/ProjectSwitcher'
import { SettingsDialog } from './SettingsDialog'
import { HelpDialog } from './HelpDialog'

interface SidebarProps {
  open: boolean
  collapsed: boolean
  onClose?: () => void
}

export default function Sidebar({ open, collapsed, onClose }: SidebarProps) {
  const location = useLocation()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  const isActive = (path: string) => {
    return location.pathname.startsWith(path)
  }

  const navItems = [
    {
      path: '/issues',
      label: 'Issues',
      icon: ListTodo,
    },
    {
      path: '/specs',
      label: 'Specs',
      icon: FileText,
    },
    {
      path: '/worktrees',
      label: 'Worktrees',
      icon: GitBranch,
    },
  ]

  return (
    <TooltipProvider delayDuration={300}>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col border-r border-border bg-background transition-all duration-300 md:sticky md:top-0 md:z-30 md:h-screen md:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
          collapsed ? 'w-16' : 'w-64'
        )}
      >
        {/* Logo section - Desktop */}
        <div className="hidden h-16 items-center justify-center md:flex">
          <img
            src="/logo.png"
            alt="Logo"
            className={cn('h-10 w-10 rounded-md transition-all duration-300')}
          />
        </div>

        {/* Mobile header with logo and close button */}
        <div className="flex h-16 items-center justify-between border-b border-border px-4 md:hidden">
          <img src="/logo.png" alt="Logo" className="h-8 w-8 rounded-md" />
          <button
            onClick={onClose}
            className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Project Switcher */}
        <div className={cn('border-b border-border p-2', collapsed ? 'px-2' : 'px-3')}>
          <ProjectSwitcher collapsed={collapsed} />
        </div>

        {/* Navigation */}
        <nav className={cn('flex-1 space-y-1 p-2', collapsed ? 'px-2' : 'px-3')}>
          {navItems.map((item) => {
            const Icon = item.icon
            const active = isActive(item.path)

            const linkContent = (
              <Link
                key={item.path}
                to={item.path}
                onClick={onClose}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  collapsed && 'justify-center px-2'
                )}
              >
                <Icon className={'h-5 w-5 flex-shrink-0' + (active ? ' text-white' : '')} />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            )

            if (collapsed) {
              return (
                <Tooltip key={item.path}>
                  <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              )
            }

            return linkContent
          })}
        </nav>

        {/* Bottom section with help and settings */}
        <div>
          <div className={cn('space-y-1 p-2', collapsed ? 'px-2' : 'px-3')}>
            {/* Help button */}
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setHelpOpen(true)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                      collapsed && 'justify-center px-2'
                    )}
                    aria-label="Help"
                  >
                    <HelpCircle className="h-5 w-5 flex-shrink-0" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">Help</TooltipContent>
              </Tooltip>
            ) : (
              <button
                onClick={() => setHelpOpen(true)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
                )}
                aria-label="Help"
              >
                <HelpCircle className="h-5 w-5 flex-shrink-0" />
                <span>Help</span>
              </button>
            )}

            {/* Settings button */}
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setSettingsOpen(true)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                      collapsed && 'justify-center px-2'
                    )}
                    aria-label="Settings"
                  >
                    <Settings className="h-5 w-5 flex-shrink-0" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">Settings</TooltipContent>
              </Tooltip>
            ) : (
              <button
                onClick={() => setSettingsOpen(true)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
                )}
                aria-label="Settings"
              >
                <Settings className="h-5 w-5 flex-shrink-0" />
                <span>Settings</span>
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Help Dialog */}
      <HelpDialog isOpen={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* Settings Dialog */}
      <SettingsDialog isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </TooltipProvider>
  )
}
