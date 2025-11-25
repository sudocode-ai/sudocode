import { render, RenderOptions } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { WebSocketProvider } from '@/contexts/WebSocketContext'
import { ProjectProvider } from '@/contexts/ProjectContext'
import { TooltipProvider } from '@/components/ui/tooltip'

/**
 * Custom render function that includes all providers
 */
export function renderWithProviders(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'> & { defaultProjectId?: string | null }
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  })

  const defaultProjectId = options?.defaultProjectId ?? 'test-project-123'

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ProjectProvider defaultProjectId={defaultProjectId} skipValidation={true}>
          <WebSocketProvider>
            <ThemeProvider>
              <TooltipProvider>
                <BrowserRouter>{children}</BrowserRouter>
              </TooltipProvider>
            </ThemeProvider>
          </WebSocketProvider>
        </ProjectProvider>
      </QueryClientProvider>
    )
  }

  return render(ui, { wrapper: Wrapper, ...options })
}

// Re-export everything from testing library
export * from '@testing-library/react'
export { renderWithProviders as render }
