/**
 * Lease management system for distributed locking
 */

import { CRDTState } from "./crdt-state.js";
import { Lease, LeaseRequest, Conflict } from "./types.js";

export interface LeaseManagerOptions {
  agentId: string;
  defaultLeaseTTL: number; // milliseconds
  renewalInterval: number; // milliseconds
}

export class LeaseManager {
  private state: CRDTState;
  private options: LeaseManagerOptions;
  private renewalTimers: Map<string, NodeJS.Timeout> = new Map();
  private eventHandlers: Map<string, Function[]> = new Map();

  constructor(state: CRDTState, options: LeaseManagerOptions) {
    this.state = state;
    this.options = options;
  }

  /**
   * Acquire a lease on a resource
   */
  async acquireLease(request: LeaseRequest): Promise<boolean> {
    const { path, type, priority = 5, metadata = {} } = request;
    const { agentId, defaultLeaseTTL } = this.options;

    // Check if resource is already leased
    const existingLease = this.state.getLease(path);

    if (existingLease) {
      const now = Date.now();

      // Check if lease has expired
      if (existingLease.expires < now) {
        console.log(`Lease on ${path} has expired, acquiring...`);
      } else if (existingLease.holder === agentId) {
        console.log(`Already holding lease on ${path}`);
        return true;
      } else {
        // Lease is held by another agent
        const timeRemaining = existingLease.expires - now;
        console.log(
          `Lease on ${path} is held by ${existingLease.holder} (expires in ${timeRemaining}ms)`
        );

        // Check priority - higher priority can override
        if (priority > existingLease.priority) {
          console.log(
            `Overriding lease on ${path} (priority ${priority} > ${existingLease.priority})`
          );
        } else {
          this.emit("lease-denied", {
            resource: path,
            holder: existingLease.holder,
            expiresIn: timeRemaining,
          });
          return false;
        }
      }
    }

    // Acquire the lease
    const lease: Lease = {
      holder: agentId,
      resourcePath: path,
      leaseType: type,
      acquiredAt: Date.now(),
      expires: Date.now() + defaultLeaseTTL,
      renewable: true,
      priority,
      metadata,
    };

    this.state.setLease(path, lease);

    // Setup automatic renewal
    if (lease.renewable) {
      this.setupRenewal(path);
    }

    this.emit("lease-acquired", { resource: path, lease });
    console.log(`Acquired lease on ${path}`);

    return true;
  }

  /**
   * Release a lease
   */
  async releaseLease(resourcePath: string): Promise<boolean> {
    const lease = this.state.getLease(resourcePath);

    if (!lease) {
      console.log(`No lease found on ${resourcePath}`);
      return false;
    }

    if (lease.holder !== this.options.agentId) {
      console.log(
        `Cannot release lease on ${resourcePath} - held by ${lease.holder}`
      );
      return false;
    }

    // Cancel renewal timer
    this.cancelRenewal(resourcePath);

    // Remove lease
    this.state.removeLease(resourcePath);

    this.emit("lease-released", { resource: resourcePath });
    console.log(`Released lease on ${resourcePath}`);

    return true;
  }

  /**
   * Renew a lease
   */
  async renewLease(resourcePath: string): Promise<boolean> {
    const lease = this.state.getLease(resourcePath);

    if (!lease) {
      console.log(`No lease found on ${resourcePath}`);
      return false;
    }

    if (lease.holder !== this.options.agentId) {
      console.log(
        `Cannot renew lease on ${resourcePath} - held by ${lease.holder}`
      );
      return false;
    }

    if (!lease.renewable) {
      console.log(`Lease on ${resourcePath} is not renewable`);
      return false;
    }

    // Extend lease
    lease.expires = Date.now() + this.options.defaultLeaseTTL;
    this.state.setLease(resourcePath, lease);

    this.emit("lease-renewed", { resource: resourcePath, lease });
    console.log(`Renewed lease on ${resourcePath}`);

    return true;
  }

  /**
   * Setup automatic lease renewal
   */
  private setupRenewal(resourcePath: string): void {
    // Cancel existing timer if any
    this.cancelRenewal(resourcePath);

    // Renew at half the TTL interval
    const renewalInterval = this.options.renewalInterval;

    const timer = setInterval(() => {
      this.renewLease(resourcePath).catch((error) => {
        console.error(`Failed to renew lease on ${resourcePath}:`, error);
        this.cancelRenewal(resourcePath);
      });
    }, renewalInterval);

    this.renewalTimers.set(resourcePath, timer);
  }

  /**
   * Cancel automatic renewal
   */
  private cancelRenewal(resourcePath: string): void {
    const timer = this.renewalTimers.get(resourcePath);
    if (timer) {
      clearInterval(timer);
      this.renewalTimers.delete(resourcePath);
    }
  }

  /**
   * Check for conflicts before claiming work
   */
  checkConflicts(
    files: string[],
    issues: string[],
    specs: string[]
  ): Conflict[] {
    const conflicts: Conflict[] = [];
    const now = Date.now();

    // Check file leases
    files.forEach((file) => {
      const lease = this.state.getLease(file);
      if (lease && lease.holder !== this.options.agentId) {
        const timeRemaining = lease.expires - now;
        if (timeRemaining > 0) {
          conflicts.push({
            type: "file",
            resource: file,
            holder: lease.holder,
            expiresIn: timeRemaining,
          });
        }
      }
    });

    // Check issue ownership
    issues.forEach((issueId) => {
      const update = this.state.getIssueUpdate(issueId);
      if (update && update.agentId !== this.options.agentId) {
        conflicts.push({
          type: "issue",
          resource: issueId,
          holder: update.agentId,
        });
      }
    });

    // Check spec ownership
    specs.forEach((specPath) => {
      const update = this.state.getSpecUpdate(specPath);
      if (update && update.agentId !== this.options.agentId) {
        conflicts.push({
          type: "spec",
          resource: specPath,
          holder: update.agentId,
        });
      }
    });

    return conflicts;
  }

  /**
   * Acquire multiple leases atomically
   */
  async acquireLeases(requests: LeaseRequest[]): Promise<boolean> {
    // First check for conflicts
    const files = requests.filter((r) => r.type === "file").map((r) => r.path);
    const issues = requests
      .filter((r) => r.type === "issue")
      .map((r) => r.path);
    const specs = requests.filter((r) => r.type === "spec").map((r) => r.path);

    const conflicts = this.checkConflicts(files, issues, specs);

    if (conflicts.length > 0) {
      console.log(`Found ${conflicts.length} conflicts:`);
      conflicts.forEach((c) => {
        console.log(
          `  - ${c.type} ${c.resource} held by ${c.holder}${c.expiresIn ? ` (expires in ${c.expiresIn}ms)` : ""}`
        );
      });
      this.emit("conflicts-detected", { conflicts });
      return false;
    }

    // Acquire all leases
    const results = await Promise.all(requests.map((r) => this.acquireLease(r)));

    return results.every((r) => r);
  }

  /**
   * Release all leases held by this agent
   */
  async releaseAllLeases(): Promise<void> {
    const leases = this.state.getLeasesHeldBy(this.options.agentId);

    for (const [resourcePath, _] of leases) {
      await this.releaseLease(resourcePath);
    }
  }

  /**
   * Get all leases held by this agent
   */
  getMyLeases(): Map<string, Lease> {
    return this.state.getLeasesHeldBy(this.options.agentId);
  }

  /**
   * Get lease by resource path
   */
  getLease(resourcePath: string): Lease | undefined {
    return this.state.getLease(resourcePath);
  }

  /**
   * Check if resource is available
   */
  isResourceAvailable(resourcePath: string): boolean {
    const lease = this.state.getLease(resourcePath);

    if (!lease) {
      return true;
    }

    const now = Date.now();
    return lease.expires < now || lease.holder === this.options.agentId;
  }

  /**
   * Register event handler
   */
  on(event: string, handler: Function): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
  }

  /**
   * Emit event
   */
  private emit(event: string, data: any): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => handler(data));
    }
  }

  /**
   * Stop all renewal timers
   */
  stop(): void {
    this.renewalTimers.forEach((timer) => clearInterval(timer));
    this.renewalTimers.clear();
  }
}
