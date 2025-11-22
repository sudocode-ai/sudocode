import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { ProjectProvider } from '@/contexts/ProjectContext'
import { WebSocketProvider } from '@/contexts/WebSocketContext'
import { Toaster } from '@/components/ui/sonner'
import MainLayout from '@/components/layout/MainLayout'
import { ProtectedRoute } from '@/components/routing/ProtectedRoute'
import { DefaultRoute } from '@/components/routing/DefaultRoute'
import IssuesPage from '@/pages/IssuesPage'
import IssueDetailPage from '@/pages/IssueDetailPage'
import SpecsPage from '@/pages/SpecsPage'
import SpecDetailPage from '@/pages/SpecDetailPage'
import ArchivedIssuesPage from '@/pages/ArchivedIssuesPage'
import ArchivedSpecsPage from '@/pages/ArchivedSpecsPage'
import ExecutionDetailPage from '@/pages/ExecutionDetailPage'
import ProjectsPage from '@/pages/ProjectsPage'

// Configure TanStack Query
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000, // 30 seconds
      gcTime: 3600000, // 1 hour (formerly cacheTime)
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ProjectProvider>
        <WebSocketProvider>
          <ThemeProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/" element={<MainLayout />}>
                  <Route index element={<DefaultRoute />} />
                  <Route path="projects" element={<ProjectsPage />} />
                  <Route
                    path="issues"
                    element={
                      <ProtectedRoute>
                        <IssuesPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="issues/archived"
                    element={
                      <ProtectedRoute>
                        <ArchivedIssuesPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="issues/:id"
                    element={
                      <ProtectedRoute>
                        <IssueDetailPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="specs"
                    element={
                      <ProtectedRoute>
                        <SpecsPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="specs/archived"
                    element={
                      <ProtectedRoute>
                        <ArchivedSpecsPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="specs/:id"
                    element={
                      <ProtectedRoute>
                        <SpecDetailPage />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="executions/:id"
                    element={
                      <ProtectedRoute>
                        <ExecutionDetailPage />
                      </ProtectedRoute>
                    }
                  />
                </Route>
              </Routes>
            </BrowserRouter>
            <Toaster />
          </ThemeProvider>
        </WebSocketProvider>
      </ProjectProvider>
    </QueryClientProvider>
  )
}

export default App
