import { Link, useLocation } from 'react-router-dom'
import { FileText, ListTodo, X, Sun, Moon, ChevronLeft, ChevronRight } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface SidebarProps {
  open: boolean
  collapsed: boolean
  onClose?: () => void
  onToggleCollapse?: () => void
}

export default function Sidebar({ open, collapsed, onClose, onToggleCollapse }: SidebarProps) {
  const location = useLocation()
  const { theme, setTheme } = useTheme()

  const isActive = (path: string) => {
    return location.pathname.startsWith(path)
  }

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
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
        {/* Mobile close button */}
        <div className="flex h-14 items-center justify-between border-b border-border px-4 md:hidden">
          <span className="font-semibold">Menu</span>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Desktop collapse toggle */}
        <div className="hidden md:flex h-12 items-center justify-end px-2 border-b border-border">
          <button
            onClick={onToggleCollapse}
            className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
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
                <Icon className="h-5 w-5 flex-shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            )

            if (collapsed) {
              return (
                <Tooltip key={item.path}>
                  <TooltipTrigger asChild>
                    {linkContent}
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {item.label}
                  </TooltipContent>
                </Tooltip>
              )
            }

            return linkContent
          })}
        </nav>

        {/* Bottom section with settings */}
        <div className="border-t border-border">
          {/* Settings/Theme toggle */}
          <div className={cn('space-y-1 p-2', collapsed ? 'px-2' : 'px-3')}>
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={toggleTheme}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                      collapsed && 'justify-center px-2'
                    )}
                    aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
                  >
                    {theme === 'dark' ? <Sun className="h-5 w-5 flex-shrink-0" /> : <Moon className="h-5 w-5 flex-shrink-0" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
                </TooltipContent>
              </Tooltip>
            ) : (
              <button
                onClick={toggleTheme}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
                )}
                aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              >
                {theme === 'dark' ? <Sun className="h-5 w-5 flex-shrink-0" /> : <Moon className="h-5 w-5 flex-shrink-0" />}
                <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
              </button>
            )}
          </div>

          {/* Footer info */}
          {!collapsed && (
            <div className="px-4 py-3">
              <p className="text-xs text-muted-foreground">Phase 1 MVP</p>
            </div>
          )}
        </div>
      </aside>
    </TooltipProvider>
  )
}
