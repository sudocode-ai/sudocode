import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { ProjectProvider } from '@/contexts/ProjectContext'
import { WebSocketProvider } from '@/contexts/WebSocketContext'
import { ChatWidgetProvider } from '@/contexts/ChatWidgetContext'
import { Toaster } from '@/components/ui/sonner'
import MainLayout from '@/components/layout/MainLayout'
import { ProtectedRoute } from '@/components/routing/ProtectedRoute'
import { DefaultRoute } from '@/components/routing/DefaultRoute'
import { LegacyRedirect } from '@/components/routing/LegacyRedirect'
import IssuesPage from '@/pages/IssuesPage'
import IssueDetailPage from '@/pages/IssueDetailPage'
import SpecsPage from '@/pages/SpecsPage'
import SpecDetailPage from '@/pages/SpecDetailPage'
import ArchivedIssuesPage from '@/pages/ArchivedIssuesPage'
import ArchivedSpecsPage from '@/pages/ArchivedSpecsPage'
import ExecutionDetailPage from '@/pages/ExecutionDetailPage'
import WorktreesPage from '@/pages/WorktreesPage'
import ProjectsPage from '@/pages/ProjectsPage'
import ExecutionsPage from '@/pages/ExecutionsPage'
import WorkflowsPage from '@/pages/WorkflowsPage'
import WorkflowDetailPage from '@/pages/WorkflowDetailPage'
import StacksPage from '@/pages/StacksPage'

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
            <ChatWidgetProvider>
              <BrowserRouter>
                <Routes>
                  <Route path="/" element={<MainLayout />}>
                    <Route index element={<DefaultRoute />} />
                    <Route path="projects" element={<ProjectsPage />} />

                    {/* Project-scoped routes under /p/:projectId */}
                    <Route path="p/:projectId">
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
                        path="worktrees"
                        element={
                          <ProtectedRoute>
                            <WorktreesPage />
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path="executions"
                        element={
                          <ProtectedRoute>
                            <ExecutionsPage />
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
                      <Route
                        path="workflows"
                        element={
                          <ProtectedRoute>
                            <WorkflowsPage />
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path="workflows/:id"
                        element={
                          <ProtectedRoute>
                            <WorkflowDetailPage />
                          </ProtectedRoute>
                        }
                      />
                      <Route
                        path="stacks"
                        element={
                          <ProtectedRoute>
                            <StacksPage />
                          </ProtectedRoute>
                        }
                      />
                    </Route>

                    {/* Legacy redirects - redirect old URLs to new project-scoped URLs */}
                    <Route path="issues/*" element={<LegacyRedirect />} />
                    <Route path="issues" element={<LegacyRedirect />} />
                    <Route path="specs/*" element={<LegacyRedirect />} />
                    <Route path="specs" element={<LegacyRedirect />} />
                    <Route path="executions/*" element={<LegacyRedirect />} />
                    <Route path="executions" element={<LegacyRedirect />} />
                    <Route path="workflows/*" element={<LegacyRedirect />} />
                    <Route path="workflows" element={<LegacyRedirect />} />
                    <Route path="worktrees" element={<LegacyRedirect />} />
                    <Route path="stacks" element={<LegacyRedirect />} />
                  </Route>
                </Routes>
              </BrowserRouter>
              <Toaster />
            </ChatWidgetProvider>
          </ThemeProvider>
        </WebSocketProvider>
      </ProjectProvider>
    </QueryClientProvider>
  )
}

export default App
