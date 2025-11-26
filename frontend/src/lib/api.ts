import axios, { AxiosInstance, AxiosError, isCancel } from 'axios'
import type {
  ApiResponse,
  Issue,
  Spec,
  Relationship,
  IssueFeedback,
  RepositoryInfo,
  CreateIssueRequest,
  UpdateIssueRequest,
  CreateSpecRequest,
  UpdateSpecRequest,
  CreateRelationshipRequest,
  DeleteRelationshipRequest,
  CreateFeedbackRequest,
  UpdateFeedbackRequest,
  AgentInfo,
  GetAgentsResponse,
} from '@/types/api'
import type {
  Execution,
  ExecutionPrepareResult,
  PrepareExecutionRequest,
  CreateExecutionRequest,
  CreateFollowUpRequest,
} from '@/types/execution'
import type {
  ProjectInfo,
  OpenProjectInfo,
  ValidateProjectRequest,
  ValidateProjectResponse,
  OpenProjectRequest,
  InitProjectRequest,
} from '@/types/project'

// Create axios instance
const api: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

/**
 * Current project ID for injecting into requests
 * Updated by setCurrentProjectId function
 */
let currentProjectId: string | null = null

/**
 * Set the current project ID for API requests
 * This will be automatically injected as X-Project-ID header
 */
export function setCurrentProjectId(projectId: string | null) {
  currentProjectId = projectId
}

/**
 * Get the current project ID
 */
export function getCurrentProjectId(): string | null {
  return currentProjectId
}

// Request interceptor to inject X-Project-ID header
api.interceptors.request.use(
  (config) => {
    // Inject X-Project-ID header if we have a current project
    // Skip for /projects and /agents endpoints which don't require project context
    if (currentProjectId && !config.url?.startsWith('/projects') && !config.url?.startsWith('/agents')) {
      config.headers['X-Project-ID'] = currentProjectId
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// Response interceptor to unwrap ApiResponse
api.interceptors.response.use(
  (response) => {
    const apiResponse = response.data as ApiResponse<any>
    if (!apiResponse.success) {
      const error = new Error(apiResponse.message || 'API request failed')
      ;(error as any).response = {
        data: apiResponse.error_data,
        status: response.status,
      }
      throw error
    }
    return apiResponse.data
  },
  (error: AxiosError) => {
    // Don't log or transform canceled requests
    if (isCancel(error)) {
      throw error
    }

    console.error('API Error:', error)

    // Handle network errors
    if (!error.response) {
      throw new Error('Network error: Please check your connection')
    }

    // Handle HTTP errors
    const status = error.response.status
    if (status === 404) {
      throw new Error('Resource not found')
    } else if (status === 500) {
      throw new Error('Server error: Please try again later')
    }

    throw error
  }
)

// Helper functions
const get = <T>(url: string) => api.get<T, T>(url)
const post = <T>(url: string, data?: any) => api.post<T, T>(url, data)
const put = <T>(url: string, data?: any) => api.put<T, T>(url, data)
const del = (url: string, data?: any) => api.delete(url, data ? { data } : undefined)

/**
 * Issues API
 */
export const issuesApi = {
  getAll: (archived?: boolean) => {
    const params = archived !== undefined ? `?archived=${archived}` : ''
    return get<Issue[]>(`/issues${params}`)
  },
  getById: (id: string) => get<Issue>(`/issues/${id}`),
  create: (data: CreateIssueRequest) => post<Issue>('/issues', data),
  update: (id: string, data: UpdateIssueRequest) => put<Issue>(`/issues/${id}`, data),
  delete: (id: string) => del(`/issues/${id}`),
  getFeedback: async (id: string) => {
    // Fetch both inbound (feedback ON this issue) and outbound (feedback FROM this issue)
    const [inbound, outbound] = await Promise.all([
      get<IssueFeedback[]>(`/feedback?to_id=${id}`),
      get<IssueFeedback[]>(`/feedback?from_id=${id}`),
    ])
    // Combine and deduplicate (in case an issue left feedback on itself)
    const combined = [...inbound, ...outbound]
    const seen = new Set<string>()
    return combined.filter((f) => {
      if (seen.has(f.id)) return false
      seen.add(f.id)
      return true
    })
  },
}

/**
 * Specs API
 */
export const specsApi = {
  getAll: (archived?: boolean) => {
    const params = archived !== undefined ? `?archived=${archived}` : ''
    return get<Spec[]>(`/specs${params}`)
  },
  getById: (id: string) => get<Spec>(`/specs/${id}`),
  create: (data: CreateSpecRequest) => post<Spec>('/specs', data),
  update: (id: string, data: UpdateSpecRequest) => put<Spec>(`/specs/${id}`, data),
  delete: (id: string) => del(`/specs/${id}`),
  getFeedback: (id: string) => get<IssueFeedback[]>(`/feedback?to_id=${id}`),
}

/**
 * Relationships API
 */
export const relationshipsApi = {
  getForEntity: (entityId: string, entityType: 'issue' | 'spec') =>
    get<Relationship[] | { outgoing: Relationship[]; incoming: Relationship[] }>(
      `/relationships/${entityType}/${entityId}`
    ),
  create: (data: CreateRelationshipRequest) => post<Relationship>('/relationships', data),
  delete: (data: DeleteRelationshipRequest) => del('/relationships', data),
}

/**
 * Feedback API
 */
export const feedbackApi = {
  getForSpec: (specId: string) => get<IssueFeedback[]>(`/feedback?spec_id=${specId}`),
  getById: (id: string) => get<IssueFeedback>(`/feedback/${id}`),
  create: (data: CreateFeedbackRequest) => post<IssueFeedback>('/feedback', data),
  update: (id: string, data: UpdateFeedbackRequest) => put<IssueFeedback>(`/feedback/${id}`, data),
  delete: (id: string) => del(`/feedback/${id}`),
}

/**
 * Executions API
 */
/**
 * Execution chain response from /executions/:id/chain
 */
export interface ExecutionChainResponse {
  rootId: string
  executions: Execution[]
}

export const executionsApi = {
  // Prepare execution (preview template and gather context)
  prepare: (issueId: string, request?: PrepareExecutionRequest) =>
    post<ExecutionPrepareResult>(`/issues/${issueId}/executions/prepare`, request),

  // Create and start execution
  create: (issueId: string, request: CreateExecutionRequest) =>
    post<Execution>(`/issues/${issueId}/executions`, request),

  // Get execution by ID
  getById: (executionId: string) => get<Execution>(`/executions/${executionId}`),

  // Get execution chain (root + all follow-ups)
  getChain: (executionId: string) => get<ExecutionChainResponse>(`/executions/${executionId}/chain`),

  // List executions for issue
  list: (issueId: string) => get<Execution[]>(`/issues/${issueId}/executions`),

  // Create follow-up execution
  createFollowUp: (executionId: string, request: CreateFollowUpRequest) =>
    post<Execution>(`/executions/${executionId}/follow-up`, request),

  // Cancel execution
  cancel: (executionId: string) => del(`/executions/${executionId}`),

  // Check if worktree exists for execution
  worktreeExists: (executionId: string) =>
    get<{ exists: boolean }>(`/executions/${executionId}/worktree`),

  // Delete worktree for execution
  deleteWorktree: (executionId: string) => del(`/executions/${executionId}/worktree`),
}

/**
 * Repository API
 */
export const repositoryApi = {
  getInfo: () => get<RepositoryInfo>('/repo-info'),
}

/**
 * Agents API
 */
export const agentsApi = {
  getAll: async (): Promise<AgentInfo[]> => {
    // Use axios directly to bypass the ApiResponse interceptor
    // The /agents endpoint returns data directly, not wrapped in ApiResponse
    const response = await axios.get<GetAgentsResponse>('/api/agents')
    return response.data.agents
  },
}

/**
 * Projects API
 */
export const projectsApi = {
  // List all registered projects
  getAll: () => get<ProjectInfo[]>('/projects'),

  // List currently open projects
  getOpen: () => get<OpenProjectInfo[]>('/projects/open'),

  // Get recent projects
  getRecent: () => get<ProjectInfo[]>('/projects/recent'),

  // Get project by ID
  getById: (projectId: string) => get<ProjectInfo | OpenProjectInfo>(`/projects/${projectId}`),

  // Validate a project path
  validate: (data: ValidateProjectRequest) => post<ValidateProjectResponse>('/projects/validate', data),

  // Open a project by path
  open: (data: OpenProjectRequest) => post<ProjectInfo>('/projects/open', data),

  // Close a project
  close: (projectId: string) => post<void>(`/projects/${projectId}/close`),

  // Update project metadata (name, favorite status)
  update: (projectId: string, data: { name?: string; favorite?: boolean }) =>
    api.patch<ProjectInfo, ProjectInfo>(`/projects/${projectId}`, data),

  // Unregister a project
  delete: (projectId: string) => del(`/projects/${projectId}`),

  // Initialize a new project
  init: (data: InitProjectRequest) => post<ProjectInfo>('/projects/init', data),
}

export default api
