/**
 * PermissionManager - Tracks pending permission requests for interactive mode
 *
 * When using ACP's interactive permission mode, permission requests are emitted
 * as session updates. This manager tracks pending requests and allows them to
 * be resolved via REST API calls.
 *
 * @module execution/executors/permission-manager
 */

import type { PermissionOption } from "acp-factory";

/**
 * A pending permission request waiting for user response
 */
export interface PendingPermission {
  /** Unique ID for this permission request */
  requestId: string;
  /** Session this request belongs to */
  sessionId: string;
  /** The tool call that triggered this permission request */
  toolCall: {
    toolCallId: string;
    title: string;
    status: string;
    rawInput?: unknown;
  };
  /** Available options for the user to choose from */
  options: PermissionOption[];
  /** Timestamp when the request was created */
  createdAt: Date;
  /** Resolve function to complete the request */
  resolve: (optionId: string) => void;
  /** Reject function to cancel the request */
  reject: (error: Error) => void;
}

/**
 * PermissionManager
 *
 * Manages pending permission requests for interactive ACP sessions.
 * Requests are added when permission_request events are received,
 * and resolved when the user responds via the REST API.
 *
 * @example
 * ```typescript
 * const manager = new PermissionManager();
 *
 * // Add a pending request (returns promise that resolves with user's choice)
 * const optionId = await manager.addPending({
 *   requestId: 'req-123',
 *   sessionId: 'session-456',
 *   toolCall: { toolCallId: 'tool-789', title: 'Bash', status: 'pending' },
 *   options: [{ id: 'allow_once', title: 'Allow Once' }],
 * });
 *
 * // Later, when user responds:
 * manager.respond('req-123', 'allow_once');
 * ```
 */
export class PermissionManager {
  private pendingPermissions: Map<string, PendingPermission> = new Map();

  /**
   * Add a pending permission request
   *
   * Returns a promise that resolves with the selected option ID
   * when the user responds via respond().
   *
   * @param permission - Permission request details (without resolve/reject)
   * @returns Promise that resolves with the selected option ID
   */
  addPending(
    permission: Omit<PendingPermission, "resolve" | "reject" | "createdAt">
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      this.pendingPermissions.set(permission.requestId, {
        ...permission,
        createdAt: new Date(),
        resolve,
        reject,
      });

      console.log(
        `[PermissionManager] Added pending permission: ${permission.requestId}`,
        {
          sessionId: permission.sessionId,
          toolCall: permission.toolCall.title,
          options: permission.options.map((o) => o.optionId),
        }
      );
    });
  }

  /**
   * Respond to a pending permission request
   *
   * @param requestId - The permission request ID
   * @param optionId - The selected option ID (e.g., 'allow_once', 'reject_always')
   * @returns true if the request was found and resolved, false otherwise
   */
  respond(requestId: string, optionId: string): boolean {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) {
      console.warn(
        `[PermissionManager] Permission request not found: ${requestId}`
      );
      return false;
    }

    console.log(
      `[PermissionManager] Responding to permission: ${requestId} with ${optionId}`
    );

    pending.resolve(optionId);
    this.pendingPermissions.delete(requestId);
    return true;
  }

  /**
   * Cancel a pending permission request
   *
   * @param requestId - The permission request ID
   * @returns true if the request was found and cancelled, false otherwise
   */
  cancel(requestId: string): boolean {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) {
      console.warn(
        `[PermissionManager] Permission request not found for cancel: ${requestId}`
      );
      return false;
    }

    console.log(`[PermissionManager] Cancelling permission: ${requestId}`);

    pending.reject(new Error("Permission request cancelled"));
    this.pendingPermissions.delete(requestId);
    return true;
  }

  /**
   * Get a pending permission request
   *
   * @param requestId - The permission request ID
   * @returns The pending permission or undefined
   */
  getPending(requestId: string): PendingPermission | undefined {
    return this.pendingPermissions.get(requestId);
  }

  /**
   * Check if a permission request is pending
   *
   * @param requestId - The permission request ID
   * @returns true if the request is pending
   */
  hasPending(requestId: string): boolean {
    return this.pendingPermissions.has(requestId);
  }

  /**
   * Get all pending permission request IDs
   *
   * @returns Array of pending request IDs
   */
  getPendingIds(): string[] {
    return Array.from(this.pendingPermissions.keys());
  }

  /**
   * Get count of pending permissions
   *
   * @returns Number of pending permissions
   */
  get pendingCount(): number {
    return this.pendingPermissions.size;
  }

  /**
   * Cancel all pending permissions (e.g., on execution cancel)
   *
   * @returns Number of permissions cancelled
   */
  cancelAll(): number {
    const count = this.pendingPermissions.size;
    for (const [requestId, pending] of this.pendingPermissions) {
      console.log(
        `[PermissionManager] Cancelling all - permission: ${requestId}`
      );
      pending.reject(new Error("All permissions cancelled"));
    }
    this.pendingPermissions.clear();
    return count;
  }
}
