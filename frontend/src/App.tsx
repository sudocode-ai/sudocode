import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { WebSocketProvider } from '@/contexts/WebSocketContext'
import MainLayout from '@/components/layout/MainLayout'
import IssuesPage from '@/pages/IssuesPage'
import IssueDetailPage from '@/pages/IssueDetailPage'
import SpecsPage from '@/pages/SpecsPage'
import SpecDetailPage from '@/pages/SpecDetailPage'
import ArchivedIssuesPage from '@/pages/ArchivedIssuesPage'
import ArchivedSpecsPage from '@/pages/ArchivedSpecsPage'
import ExecutionDetailPage from '@/pages/ExecutionDetailPage'

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
      <WebSocketProvider>
        <ThemeProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<MainLayout />}>
                <Route index element={<Navigate to="/issues" replace />} />
                <Route path="issues" element={<IssuesPage />} />
                <Route path="issues/archived" element={<ArchivedIssuesPage />} />
                <Route path="issues/:id" element={<IssueDetailPage />} />
                <Route path="specs" element={<SpecsPage />} />
                <Route path="specs/archived" element={<ArchivedSpecsPage />} />
                <Route path="specs/:id" element={<SpecDetailPage />} />
                <Route path="executions/:id" element={<ExecutionDetailPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </ThemeProvider>
      </WebSocketProvider>
    </QueryClientProvider>
  )
}

export default App
