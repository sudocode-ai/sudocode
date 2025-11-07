import axios, { AxiosInstance, AxiosError } from 'axios'
import type {
  ApiResponse,
  Issue,
  Spec,
  Relationship,
  IssueFeedback,
  IssueGroup,
  IssueGroupWithStats,
  QualityGateConfigResponse,
  QualityGateResult,
  CreateIssueRequest,
  UpdateIssueRequest,
  CreateSpecRequest,
  UpdateSpecRequest,
  CreateRelationshipRequest,
  DeleteRelationshipRequest,
  CreateFeedbackRequest,
  UpdateFeedbackRequest,
  CreateIssueGroupRequest,
  UpdateIssueGroupRequest,
  AddIssueToGroupRequest,
  UpdateQualityGateConfigRequest,
} from '@/types/api'
import type {
  Execution,
  ExecutionPrepareResult,
  PrepareExecutionRequest,
  CreateExecutionRequest,
  CreateFollowUpRequest,
} from '@/types/execution'

// Create axios instance
const api: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

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
  getFeedback: (id: string) => get<IssueFeedback[]>(`/feedback?spec_id=${id}`),
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
export const executionsApi = {
  // Prepare execution (preview template and gather context)
  prepare: (issueId: string, request?: PrepareExecutionRequest) =>
    post<ExecutionPrepareResult>(`/issues/${issueId}/executions/prepare`, request),

  // Create and start execution
  create: (issueId: string, request: CreateExecutionRequest) =>
    post<Execution>(`/issues/${issueId}/executions`, request),

  // Get execution by ID
  getById: (executionId: string) => get<Execution>(`/executions/${executionId}`),

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
 * Issue Groups API
 */
export const issueGroupsApi = {
  // Get all issue groups
  getAll: (status?: 'active' | 'paused' | 'completed') => {
    const params = status ? `?status=${status}` : ''
    return get<IssueGroup[]>(`/issue-groups${params}`)
  },

  // Get issue group by ID with issues and stats
  getById: (id: string) => get<IssueGroupWithStats>(`/issue-groups/${id}`),

  // Create new issue group
  create: (data: CreateIssueGroupRequest) => post<IssueGroup>('/issue-groups', data),

  // Update issue group
  update: (id: string, data: UpdateIssueGroupRequest) =>
    put<IssueGroup>(`/issue-groups/${id}`, data),

  // Delete issue group
  delete: (id: string) => del(`/issue-groups/${id}`),

  // Pause issue group
  pause: (id: string, reason?: string) =>
    post<IssueGroup>(`/issue-groups/${id}/pause`, { reason }),

  // Resume issue group
  resume: (id: string) => post<IssueGroup>(`/issue-groups/${id}/resume`),

  // Complete issue group
  complete: (id: string) => post<IssueGroup>(`/issue-groups/${id}/complete`),

  // Add issue to group
  addIssue: (groupId: string, data: AddIssueToGroupRequest) =>
    post<Issue>(`/issue-groups/${groupId}/members`, data),

  // Remove issue from group
  removeIssue: (groupId: string, issueId: string) =>
    del(`/issue-groups/${groupId}/members/${issueId}`),

  // Get issues in group
  getIssues: (groupId: string) => get<Issue[]>(`/issue-groups/${groupId}/members`),
}

/**
 * Quality Gates API
 */
export const qualityGatesApi = {
  // Get quality gate configuration
  getConfig: () => get<QualityGateConfigResponse>('/quality-gates/config'),

  // Update quality gate configuration
  updateConfig: (data: UpdateQualityGateConfigRequest) =>
    put<QualityGateConfigResponse>('/quality-gates/config', data),

  // Get quality gate results for an execution
  getResults: (executionId: string) => get<QualityGateResult>(`/quality-gates/execution/${executionId}`),

  // Delete quality gate results for an execution
  deleteResults: (executionId: string) => del(`/quality-gates/execution/${executionId}`),
}

export default api
