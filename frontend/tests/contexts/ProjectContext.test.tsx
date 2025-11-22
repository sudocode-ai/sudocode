import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { ProjectProvider, useProjectContext } from '@/contexts/ProjectContext'
import * as api from '@/lib/api'

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString()
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      store = {}
    },
  }
})()

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
})

// Mock the API setCurrentProjectId function
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual('@/lib/api')
  return {
    ...actual,
    setCurrentProjectId: vi.fn(),
  }
})

describe('ProjectContext', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('should throw error when useProjectContext is used outside ProjectProvider', () => {
    // Suppress console.error for this test
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})

    expect(() => {
      renderHook(() => useProjectContext())
    }).toThrow('useProjectContext must be used within ProjectProvider')

    consoleError.mockRestore()
  })

  it('should provide null as default currentProjectId', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ProjectProvider skipValidation={true}>{children}</ProjectProvider>
    )

    const { result } = renderHook(() => useProjectContext(), { wrapper })

    expect(result.current.currentProjectId).toBeNull()
    expect(result.current.currentProject).toBeNull()
  })

  it('should load currentProjectId from localStorage', () => {
    localStorageMock.setItem('sudocode:currentProjectId', 'test-project-123')

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ProjectProvider skipValidation={true}>{children}</ProjectProvider>
    )

    const { result } = renderHook(() => useProjectContext(), { wrapper })

    expect(result.current.currentProjectId).toBe('test-project-123')
  })

  it('should accept defaultProjectId prop', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ProjectProvider defaultProjectId="default-project" skipValidation={true}>{children}</ProjectProvider>
    )

    const { result } = renderHook(() => useProjectContext(), { wrapper })

    expect(result.current.currentProjectId).toBe('default-project')
  })

  it('should set currentProjectId and persist to localStorage', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ProjectProvider skipValidation={true}>{children}</ProjectProvider>
    )

    const { result } = renderHook(() => useProjectContext(), { wrapper })

    act(() => {
      result.current.setCurrentProjectId('project-abc')
    })

    expect(result.current.currentProjectId).toBe('project-abc')
    expect(localStorageMock.getItem('sudocode:currentProjectId')).toBe('project-abc')
  })

  it('should call API setCurrentProjectId when project changes', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ProjectProvider skipValidation={true}>{children}</ProjectProvider>
    )

    const { result } = renderHook(() => useProjectContext(), { wrapper })

    act(() => {
      result.current.setCurrentProjectId('project-xyz')
    })

    expect(api.setCurrentProjectId).toHaveBeenCalledWith('project-xyz')
  })

  it('should clear currentProjectId and remove from localStorage', () => {
    localStorageMock.setItem('sudocode:currentProjectId', 'old-project')

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ProjectProvider skipValidation={true}>{children}</ProjectProvider>
    )

    const { result } = renderHook(() => useProjectContext(), { wrapper })

    act(() => {
      result.current.setCurrentProjectId(null)
    })

    expect(result.current.currentProjectId).toBeNull()
    expect(localStorageMock.getItem('sudocode:currentProjectId')).toBeNull()
  })

  it('should call API setCurrentProjectId with null when clearing project', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ProjectProvider skipValidation={true}>{children}</ProjectProvider>
    )

    const { result } = renderHook(() => useProjectContext(), { wrapper })

    act(() => {
      result.current.setCurrentProjectId('project-123')
    })

    vi.clearAllMocks()

    act(() => {
      result.current.setCurrentProjectId(null)
    })

    expect(api.setCurrentProjectId).toHaveBeenCalledWith(null)
  })

  it('should clear currentProject when switching projects', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ProjectProvider skipValidation={true}>{children}</ProjectProvider>
    )

    const { result } = renderHook(() => useProjectContext(), { wrapper })

    // Set initial project
    act(() => {
      result.current.setCurrentProjectId('project-1')
      result.current.setCurrentProject({
        id: 'project-1',
        name: 'Project 1',
        path: '/path/to/project1',
        sudocodeDir: '/path/to/project1/.sudocode',
        registeredAt: '2025-01-01T00:00:00Z',
        lastOpenedAt: '2025-01-01T00:00:00Z',
        favorite: false,
      })
    })

    expect(result.current.currentProject).not.toBeNull()
    expect(result.current.currentProject?.id).toBe('project-1')

    // Switch to different project
    act(() => {
      result.current.setCurrentProjectId('project-2')
    })

    // currentProject should be cleared
    expect(result.current.currentProject).toBeNull()
    expect(result.current.currentProjectId).toBe('project-2')
  })

  it('should not clear currentProject when setting same projectId', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ProjectProvider skipValidation={true}>{children}</ProjectProvider>
    )

    const { result } = renderHook(() => useProjectContext(), { wrapper })

    const projectInfo = {
      id: 'project-1',
      name: 'Project 1',
      path: '/path/to/project1',
      sudocodeDir: '/path/to/project1/.sudocode',
      registeredAt: '2025-01-01T00:00:00Z',
      lastOpenedAt: '2025-01-01T00:00:00Z',
      favorite: false,
    }

    act(() => {
      result.current.setCurrentProjectId('project-1')
      result.current.setCurrentProject(projectInfo)
    })

    expect(result.current.currentProject).not.toBeNull()

    // Set same projectId again
    act(() => {
      result.current.setCurrentProjectId('project-1')
    })

    // currentProject should still be there
    expect(result.current.currentProject).not.toBeNull()
    expect(result.current.currentProject?.id).toBe('project-1')
  })

  it('should clear both projectId and project with clearProject', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ProjectProvider skipValidation={true}>{children}</ProjectProvider>
    )

    const { result } = renderHook(() => useProjectContext(), { wrapper })

    act(() => {
      result.current.setCurrentProjectId('project-1')
      result.current.setCurrentProject({
        id: 'project-1',
        name: 'Project 1',
        path: '/path/to/project1',
        sudocodeDir: '/path/to/project1/.sudocode',
        registeredAt: '2025-01-01T00:00:00Z',
        lastOpenedAt: '2025-01-01T00:00:00Z',
        favorite: false,
      })
    })

    expect(result.current.currentProjectId).toBe('project-1')
    expect(result.current.currentProject).not.toBeNull()

    act(() => {
      result.current.clearProject()
    })

    expect(result.current.currentProjectId).toBeNull()
    expect(result.current.currentProject).toBeNull()
    expect(localStorageMock.getItem('sudocode:currentProjectId')).toBeNull()
  })

  it('should handle localStorage errors gracefully', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Mock localStorage to throw
    const originalSetItem = localStorageMock.setItem
    localStorageMock.setItem = () => {
      throw new Error('Storage quota exceeded')
    }

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ProjectProvider skipValidation={true}>{children}</ProjectProvider>
    )

    const { result } = renderHook(() => useProjectContext(), { wrapper })

    // Should not throw, just log error
    act(() => {
      result.current.setCurrentProjectId('project-1')
    })

    expect(consoleError).toHaveBeenCalled()

    // Restore
    localStorageMock.setItem = originalSetItem
    consoleError.mockRestore()
  })

  it('should persist projectId changes across multiple updates', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ProjectProvider skipValidation={true}>{children}</ProjectProvider>
    )

    const { result } = renderHook(() => useProjectContext(), { wrapper })

    act(() => {
      result.current.setCurrentProjectId('project-1')
    })
    expect(localStorageMock.getItem('sudocode:currentProjectId')).toBe('project-1')

    act(() => {
      result.current.setCurrentProjectId('project-2')
    })
    expect(localStorageMock.getItem('sudocode:currentProjectId')).toBe('project-2')

    act(() => {
      result.current.setCurrentProjectId('project-3')
    })
    expect(localStorageMock.getItem('sudocode:currentProjectId')).toBe('project-3')
  })

  it('should call API setCurrentProjectId on each projectId change', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ProjectProvider skipValidation={true}>{children}</ProjectProvider>
    )

    const { result } = renderHook(() => useProjectContext(), { wrapper })

    act(() => {
      result.current.setCurrentProjectId('project-1')
    })
    expect(api.setCurrentProjectId).toHaveBeenCalledWith('project-1')

    vi.clearAllMocks()

    act(() => {
      result.current.setCurrentProjectId('project-2')
    })
    expect(api.setCurrentProjectId).toHaveBeenCalledWith('project-2')

    vi.clearAllMocks()

    act(() => {
      result.current.setCurrentProjectId(null)
    })
    expect(api.setCurrentProjectId).toHaveBeenCalledWith(null)
  })
})
