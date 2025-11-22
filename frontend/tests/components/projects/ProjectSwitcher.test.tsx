import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProjectProvider } from '@/contexts/ProjectContext'
import { ProjectSwitcher } from '@/components/projects/ProjectSwitcher'
import * as useProjectsHooks from '@/hooks/useProjects'
import * as api from '@/lib/api'

// Mock the hooks
vi.mock('@/hooks/useProjects', () => ({
  useRecentProjects: vi.fn(),
  useProjectById: vi.fn(),
}))

// Mock API
vi.mock('@/lib/api', () => ({
  projectsApi: {
    getOpen: vi.fn(),
    open: vi.fn(),
  },
  setCurrentProjectId: vi.fn(),
}))

// Mock router navigate
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

describe('ProjectSwitcher', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
    vi.clearAllMocks()

    // Default mock implementations
    vi.mocked(useProjectsHooks.useRecentProjects).mockReturnValue({
      data: [],
      isLoading: false,
    } as any)

    vi.mocked(useProjectsHooks.useProjectById).mockReturnValue({
      data: null,
    } as any)
  })

  const renderWithProviders = (projectId: string | null = null) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <ProjectProvider defaultProjectId={projectId} skipValidation={true}>
          <BrowserRouter>
            <ProjectSwitcher />
          </BrowserRouter>
        </ProjectProvider>
      </QueryClientProvider>
    )
  }

  it('should show "Open Project" button when no project is selected', () => {
    renderWithProviders(null)

    expect(screen.getByRole('button', { name: /open project/i })).toBeInTheDocument()
  })

  it('should navigate to /projects when "Open Project" is clicked', async () => {
    const user = userEvent.setup()
    renderWithProviders(null)

    const openButton = screen.getByRole('button', { name: /open project/i })
    await user.click(openButton)

    expect(mockNavigate).toHaveBeenCalledWith('/projects')
  })

  it('should display current project name when project is selected', () => {
    vi.mocked(useProjectsHooks.useProjectById).mockReturnValue({
      data: {
        id: 'project-1',
        name: 'My Project',
        path: '/path/to/project',
        sudocodeDir: '/path/to/project/.sudocode',
        registeredAt: '2025-01-01T00:00:00Z',
        lastOpenedAt: '2025-01-01T00:00:00Z',
        favorite: false,
      },
    } as any)

    renderWithProviders('project-1')

    expect(screen.getByRole('combobox', { name: /select project/i })).toBeInTheDocument()
    expect(screen.getByText('My Project')).toBeInTheDocument()
  })

  it('should show loading state for recent projects', async () => {
    vi.mocked(useProjectsHooks.useRecentProjects).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as any)

    vi.mocked(useProjectsHooks.useProjectById).mockReturnValue({
      data: {
        id: 'project-1',
        name: 'My Project',
        path: '/path/to/project',
        sudocodeDir: '/path/to/project/.sudocode',
        registeredAt: '2025-01-01T00:00:00Z',
        lastOpenedAt: '2025-01-01T00:00:00Z',
        favorite: false,
      },
    } as any)

    const user = userEvent.setup()
    renderWithProviders('project-1')

    // Find the combobox button (dropdown trigger)
    const trigger = screen.getByRole('combobox', { name: /select project/i })
    await user.click(trigger)

    await waitFor(() => {
      expect(screen.getByText(/loading projects/i)).toBeInTheDocument()
    })
  })

  it('should display recent projects in dropdown', async () => {
    vi.mocked(useProjectsHooks.useRecentProjects).mockReturnValue({
      data: [
        {
          id: 'project-1',
          name: 'Project One',
          path: '/path/to/project1',
          sudocodeDir: '/path/to/project1/.sudocode',
          registeredAt: '2025-01-01T00:00:00Z',
          lastOpenedAt: '2025-01-01T00:00:00Z',
          favorite: false,
        },
        {
          id: 'project-2',
          name: 'Project Two',
          path: '/path/to/project2',
          sudocodeDir: '/path/to/project2/.sudocode',
          registeredAt: '2025-01-01T00:00:00Z',
          lastOpenedAt: '2025-01-01T00:00:00Z',
          favorite: true,
        },
      ],
      isLoading: false,
    } as any)

    vi.mocked(useProjectsHooks.useProjectById).mockReturnValue({
      data: {
        id: 'project-1',
        name: 'Project One',
        path: '/path/to/project1',
        sudocodeDir: '/path/to/project1/.sudocode',
        registeredAt: '2025-01-01T00:00:00Z',
        lastOpenedAt: '2025-01-01T00:00:00Z',
        favorite: false,
      },
    } as any)

    const user = userEvent.setup()
    renderWithProviders('project-1')

    // Find and click the combobox trigger
    const trigger = screen.getByRole('combobox', { name: /select project/i })
    await user.click(trigger)

    await waitFor(() => {
      expect(screen.getByText('Project Two')).toBeInTheDocument()
      expect(screen.getByText('★ Favorite')).toBeInTheDocument()
    })
  })

  it('should show "Manage Projects" option in dropdown', async () => {
    vi.mocked(useProjectsHooks.useProjectById).mockReturnValue({
      data: {
        id: 'project-1',
        name: 'My Project',
        path: '/path/to/project',
        sudocodeDir: '/path/to/project/.sudocode',
        registeredAt: '2025-01-01T00:00:00Z',
        lastOpenedAt: '2025-01-01T00:00:00Z',
        favorite: false,
      },
    } as any)

    const user = userEvent.setup()
    renderWithProviders('project-1')

    // Find and click the combobox trigger
    const trigger = screen.getByRole('combobox', { name: /select project/i })
    await user.click(trigger)

    await waitFor(() => {
      expect(screen.getByText(/manage projects/i)).toBeInTheDocument()
    })
  })

  it('should navigate to /projects when "Manage Projects" is clicked', async () => {
    vi.mocked(useProjectsHooks.useProjectById).mockReturnValue({
      data: {
        id: 'project-1',
        name: 'My Project',
        path: '/path/to/project',
        sudocodeDir: '/path/to/project/.sudocode',
        registeredAt: '2025-01-01T00:00:00Z',
        lastOpenedAt: '2025-01-01T00:00:00Z',
        favorite: false,
      },
    } as any)

    const user = userEvent.setup()
    renderWithProviders('project-1')

    // Find and click the combobox trigger
    const trigger = screen.getByRole('combobox', { name: /select project/i })
    await user.click(trigger)

    // Click "Manage Projects"
    const manageButton = await screen.findByText(/manage projects/i)
    await user.click(manageButton)

    expect(mockNavigate).toHaveBeenCalledWith('/projects')
  })

  it('should render in collapsed mode', () => {
    vi.mocked(useProjectsHooks.useProjectById).mockReturnValue({
      data: {
        id: 'project-1',
        name: 'My Project',
        path: '/path/to/project',
        sudocodeDir: '/path/to/project/.sudocode',
        registeredAt: '2025-01-01T00:00:00Z',
        lastOpenedAt: '2025-01-01T00:00:00Z',
        favorite: false,
      },
    } as any)

    render(
      <QueryClientProvider client={queryClient}>
        <ProjectProvider defaultProjectId="project-1">
          <BrowserRouter>
            <ProjectSwitcher collapsed={true} />
          </BrowserRouter>
        </ProjectProvider>
      </QueryClientProvider>
    )

    // In collapsed mode, project name should not be visible (only icon)
    expect(screen.queryByText('My Project')).not.toBeInTheDocument()
  })

  it('should open closed project before switching', async () => {
    const recentProjects = [
      {
        id: 'project-1',
        name: 'Project One',
        path: '/path/to/project1',
        sudocodeDir: '/path/to/project1/.sudocode',
        registeredAt: '2025-01-01T00:00:00Z',
        lastOpenedAt: '2025-01-01T00:00:00Z',
        favorite: false,
      },
      {
        id: 'project-2',
        name: 'Project Two',
        path: '/path/to/project2',
        sudocodeDir: '/path/to/project2/.sudocode',
        registeredAt: '2025-01-01T00:00:00Z',
        lastOpenedAt: '2025-01-01T00:00:00Z',
        favorite: false,
      },
    ]

    vi.mocked(useProjectsHooks.useRecentProjects).mockReturnValue({
      data: recentProjects,
      isLoading: false,
    } as any)

    vi.mocked(useProjectsHooks.useProjectById).mockReturnValue({
      data: recentProjects[0],
    } as any)

    // Mock getOpen to return only project-1 is open
    vi.mocked(api.projectsApi.getOpen).mockResolvedValue([
      {
        ...recentProjects[0],
        isOpen: true,
      },
    ] as any)

    // Mock open to succeed
    vi.mocked(api.projectsApi.open).mockResolvedValue(recentProjects[1] as any)

    const user = userEvent.setup()
    renderWithProviders('project-1')

    // Open the dropdown
    const trigger = screen.getByRole('combobox', { name: /select project/i })
    await user.click(trigger)

    // Click on Project Two (which is closed)
    const projectTwo = await screen.findByText('Project Two')
    await user.click(projectTwo)

    // Verify that the project was opened before switching
    await waitFor(() => {
      expect(api.projectsApi.getOpen).toHaveBeenCalled()
      expect(api.projectsApi.open).toHaveBeenCalledWith({ path: '/path/to/project2' })
    })
  })

  it('should not open project if already open', async () => {
    const recentProjects = [
      {
        id: 'project-1',
        name: 'Project One',
        path: '/path/to/project1',
        sudocodeDir: '/path/to/project1/.sudocode',
        registeredAt: '2025-01-01T00:00:00Z',
        lastOpenedAt: '2025-01-01T00:00:00Z',
        favorite: false,
      },
      {
        id: 'project-2',
        name: 'Project Two',
        path: '/path/to/project2',
        sudocodeDir: '/path/to/project2/.sudocode',
        registeredAt: '2025-01-01T00:00:00Z',
        lastOpenedAt: '2025-01-01T00:00:00Z',
        favorite: false,
      },
    ]

    vi.mocked(useProjectsHooks.useRecentProjects).mockReturnValue({
      data: recentProjects,
      isLoading: false,
    } as any)

    vi.mocked(useProjectsHooks.useProjectById).mockReturnValue({
      data: recentProjects[0],
    } as any)

    // Mock getOpen to return both projects are open
    vi.mocked(api.projectsApi.getOpen).mockResolvedValue([
      {
        ...recentProjects[0],
        isOpen: true,
      },
      {
        ...recentProjects[1],
        isOpen: true,
      },
    ] as any)

    const user = userEvent.setup()
    renderWithProviders('project-1')

    // Open the dropdown
    const trigger = screen.getByRole('combobox', { name: /select project/i })
    await user.click(trigger)

    // Click on Project Two (which is already open)
    const projectTwo = await screen.findByText('Project Two')
    await user.click(projectTwo)

    // Verify that the project was NOT opened (already open)
    await waitFor(() => {
      expect(api.projectsApi.getOpen).toHaveBeenCalled()
      expect(api.projectsApi.open).not.toHaveBeenCalled()
    })
  })

  it('should navigate to issues page when switching projects', async () => {
    const recentProjects = [
      {
        id: 'project-1',
        name: 'Project One',
        path: '/path/to/project1',
        sudocodeDir: '/path/to/project1/.sudocode',
        registeredAt: '2025-01-01T00:00:00Z',
        lastOpenedAt: '2025-01-01T00:00:00Z',
        favorite: false,
      },
      {
        id: 'project-2',
        name: 'Project Two',
        path: '/path/to/project2',
        sudocodeDir: '/path/to/project2/.sudocode',
        registeredAt: '2025-01-01T00:00:00Z',
        lastOpenedAt: '2025-01-01T00:00:00Z',
        favorite: false,
      },
    ]

    vi.mocked(useProjectsHooks.useRecentProjects).mockReturnValue({
      data: recentProjects,
      isLoading: false,
    } as any)

    vi.mocked(useProjectsHooks.useProjectById).mockReturnValue({
      data: recentProjects[0],
    } as any)

    // Mock getOpen to return both projects are open
    vi.mocked(api.projectsApi.getOpen).mockResolvedValue([
      {
        ...recentProjects[0],
        isOpen: true,
      },
      {
        ...recentProjects[1],
        isOpen: true,
      },
    ] as any)

    const user = userEvent.setup()
    renderWithProviders('project-1')

    // Open the dropdown
    const trigger = screen.getByRole('combobox', { name: /select project/i })
    await user.click(trigger)

    // Click on Project Two
    const projectTwo = await screen.findByText('Project Two')
    await user.click(projectTwo)

    // Verify navigation to issues page
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/issues')
    })
  })
})
