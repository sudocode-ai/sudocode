import { useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useProject } from './useProject'

/**
 * Hook for building project-scoped URLs and navigation.
 *
 * All project-scoped routes follow the pattern: /p/:projectId/...
 * This hook provides utilities to build these URLs consistently.
 */
export function useProjectRoutes() {
  const { projectId: urlProjectId } = useParams<{ projectId?: string }>()
  const { currentProjectId } = useProject()
  const navigate = useNavigate()

  // Prefer URL project ID, fallback to context
  const effectiveProjectId = urlProjectId || currentProjectId

  /**
   * Build a project-scoped path.
   * @param path - The path to append (e.g., '/issues', '/specs/s-abc')
   * @returns Full path with project prefix (e.g., '/p/proj-123/issues')
   */
  const buildPath = useCallback(
    (path: string): string => {
      if (!effectiveProjectId) return path
      const normalized = path.startsWith('/') ? path : `/${path}`
      return `/p/${effectiveProjectId}${normalized}`
    },
    [effectiveProjectId]
  )

  /**
   * Pre-built path generators for common routes.
   */
  const paths = {
    issues: () => buildPath('/issues'),
    issue: (id: string) => buildPath(`/issues/${id}`),
    archivedIssues: () => buildPath('/issues/archived'),
    specs: () => buildPath('/specs'),
    spec: (id: string) => buildPath(`/specs/${id}`),
    archivedSpecs: () => buildPath('/specs/archived'),
    executions: () => buildPath('/executions'),
    execution: (id: string) => buildPath(`/executions/${id}`),
    workflows: () => buildPath('/workflows'),
    workflow: (id: string) => buildPath(`/workflows/${id}`),
    worktrees: () => buildPath('/worktrees'),
  }

  /**
   * Navigate to a project-scoped path.
   * @param path - The path to navigate to
   * @param options - React Router navigate options
   */
  const goTo = useCallback(
    (path: string, options?: { replace?: boolean; state?: unknown }) => {
      navigate(buildPath(path), options)
    },
    [navigate, buildPath]
  )

  /**
   * Pre-built navigation functions for common routes.
   */
  const go = {
    issues: (options?: { replace?: boolean }) => navigate(paths.issues(), options),
    issue: (id: string, options?: { replace?: boolean }) =>
      navigate(paths.issue(id), options),
    archivedIssues: (options?: { replace?: boolean }) =>
      navigate(paths.archivedIssues(), options),
    specs: (options?: { replace?: boolean }) => navigate(paths.specs(), options),
    spec: (id: string, options?: { replace?: boolean }) =>
      navigate(paths.spec(id), options),
    archivedSpecs: (options?: { replace?: boolean }) =>
      navigate(paths.archivedSpecs(), options),
    executions: (options?: { replace?: boolean }) => navigate(paths.executions(), options),
    execution: (id: string, options?: { replace?: boolean }) =>
      navigate(paths.execution(id), options),
    workflows: (options?: { replace?: boolean }) => navigate(paths.workflows(), options),
    workflow: (id: string, options?: { replace?: boolean }) =>
      navigate(paths.workflow(id), options),
    worktrees: (options?: { replace?: boolean }) => navigate(paths.worktrees(), options),
  }

  return {
    /** The effective project ID (from URL or context) */
    effectiveProjectId,
    /** The project ID from URL params (may be undefined) */
    urlProjectId,
    /** Build a project-scoped path */
    buildPath,
    /** Pre-built path generators */
    paths,
    /** Navigate to a project-scoped path */
    goTo,
    /** Pre-built navigation functions */
    go,
  }
}

/**
 * Build a project-scoped path without hooks.
 * Use this in non-component contexts where hooks aren't available.
 *
 * @param projectId - The project ID
 * @param path - The path to append
 * @returns Full path with project prefix
 */
export function buildProjectPath(projectId: string, path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `/p/${projectId}${normalized}`
}
