/**
 * Tests for ExecutionEntityBadges Component
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProjectProvider } from '@/contexts/ProjectContext'
import { ExecutionEntityBadges } from '@/components/executions/ExecutionEntityBadges'
import type { UseExecutionEntityOperationsReturn } from '@/hooks/useExecutionEntityOperations'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
})

function renderWithProviders(component: React.ReactElement) {
  return render(
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <ProjectProvider skipValidation={true}>{component}</ProjectProvider>
      </QueryClientProvider>
    </BrowserRouter>
  )
}

describe('ExecutionEntityBadges', () => {
  it('should not render when all sections are empty', () => {
    const emptyOperations: UseExecutionEntityOperationsReturn = {
      updated: [],
      linked: [],
      read: [],
      listOperations: [],
    }

    const { container } = renderWithProviders(
      <ExecutionEntityBadges operations={emptyOperations} />
    )

    expect(container.firstChild).toBeNull()
  })

  it('should render Updated Documents section when upsert operations exist', () => {
    const operations: UseExecutionEntityOperationsReturn = {
      updated: [
        {
          operationType: 'upsert',
          entityId: 'i-test1',
          entityType: 'issue',
          timestamp: Date.now(),
          toolCallId: 'tool-1',
        },
      ],
      linked: [],
      read: [],
      listOperations: [],
    }

    renderWithProviders(<ExecutionEntityBadges operations={operations} />)

    expect(screen.getByText('Entity Operations')).toBeInTheDocument()
    expect(screen.getByText('Updated Documents')).toBeInTheDocument()
  })

  it('should render Linked Documents section when link operations exist', () => {
    const operations: UseExecutionEntityOperationsReturn = {
      updated: [],
      linked: [
        {
          operationType: 'link',
          entityId: 'i-test1',
          entityType: 'issue',
          timestamp: Date.now(),
          toolCallId: 'tool-2',
          linkTarget: {
            entityId: 's-test1',
            entityType: 'spec',
            relationshipType: 'implements',
          },
        },
      ],
      read: [],
      listOperations: [],
    }

    renderWithProviders(<ExecutionEntityBadges operations={operations} />)

    expect(screen.getByText('Linked Documents')).toBeInTheDocument()
    expect(screen.getByText('Implements')).toBeInTheDocument()
  })

  it('should render Read Documents section when read operations exist', () => {
    const operations: UseExecutionEntityOperationsReturn = {
      updated: [],
      linked: [],
      read: [
        {
          operationType: 'read',
          entityId: 's-test1',
          entityType: 'spec',
          timestamp: Date.now(),
          toolCallId: 'tool-3',
        },
      ],
      listOperations: [],
    }

    renderWithProviders(<ExecutionEntityBadges operations={operations} />)

    expect(screen.getByText('Read Documents')).toBeInTheDocument()
  })

  it('should render List Operations section when list operations exist', () => {
    const operations: UseExecutionEntityOperationsReturn = {
      updated: [],
      linked: [],
      read: [],
      listOperations: [
        {
          operationType: 'list',
          entityId: '',
          entityType: 'issue',
          timestamp: Date.now(),
          toolCallId: 'tool-4',
        },
      ],
    }

    renderWithProviders(<ExecutionEntityBadges operations={operations} />)

    expect(screen.getByText(/List Operations \(1\)/)).toBeInTheDocument()
  })

  it('should render all sections when all operation types exist', () => {
    const operations: UseExecutionEntityOperationsReturn = {
      updated: [
        {
          operationType: 'upsert',
          entityId: 'i-test1',
          entityType: 'issue',
          timestamp: Date.now(),
          toolCallId: 'tool-1',
        },
      ],
      linked: [
        {
          operationType: 'link',
          entityId: 'i-test2',
          entityType: 'issue',
          timestamp: Date.now(),
          toolCallId: 'tool-2',
          linkTarget: {
            entityId: 's-test1',
            entityType: 'spec',
            relationshipType: 'blocks',
          },
        },
      ],
      read: [
        {
          operationType: 'read',
          entityId: 's-test2',
          entityType: 'spec',
          timestamp: Date.now(),
          toolCallId: 'tool-3',
        },
      ],
      listOperations: [
        {
          operationType: 'list',
          entityId: '',
          entityType: 'spec',
          timestamp: Date.now(),
          toolCallId: 'tool-4',
        },
      ],
    }

    renderWithProviders(<ExecutionEntityBadges operations={operations} />)

    expect(screen.getByText('Updated Documents')).toBeInTheDocument()
    expect(screen.getByText('Linked Documents')).toBeInTheDocument()
    expect(screen.getByText('Read Documents')).toBeInTheDocument()
    expect(screen.getByText(/List Operations \(1\)/)).toBeInTheDocument()
  })
})
