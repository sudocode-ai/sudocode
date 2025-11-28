import type { Execution } from '@/types/execution'

/**
 * Follows an execution chain to its end by recursively finding the most recent child.
 */
function followChainToEnd(
  execution: Execution,
  childrenMap: Map<string, Execution[]>
): Execution {
  const children = childrenMap.get(execution.id)
  if (!children || children.length === 0) {
    return execution
  }

  // Sort children by created_at and follow the most recent
  const sortedChildren = [...children].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )

  return followChainToEnd(sortedChildren[0], childrenMap)
}

/**
 * Finds the latest execution in any chain. If execution A has follow-up B,
 * this returns B (the end of the chain with the most recent timestamp).
 */
export function findLatestExecutionInChain(executions: Execution[]): Execution | null {
  if (executions.length === 0) return null

  // Build a map of parent_execution_id -> children
  const childrenMap = new Map<string, Execution[]>()
  executions.forEach((exec) => {
    if (exec.parent_execution_id) {
      const children = childrenMap.get(exec.parent_execution_id) || []
      children.push(exec)
      childrenMap.set(exec.parent_execution_id, children)
    }
  })

  // Find all root executions (no parent)
  const rootExecutions = executions.filter((e) => !e.parent_execution_id)

  // For each root, follow the chain to the end
  let latestExecution: Execution | null = null
  let latestTimestamp = 0

  rootExecutions.forEach((root) => {
    const chainEnd = followChainToEnd(root, childrenMap)
    const timestamp = new Date(chainEnd.created_at).getTime()
    if (timestamp > latestTimestamp) {
      latestTimestamp = timestamp
      latestExecution = chainEnd
    }
  })

  return latestExecution
}
