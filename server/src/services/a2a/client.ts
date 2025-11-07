/**
 * A2A Protocol Client - HTTP client for outgoing cross-repo requests
 */

import Database from "better-sqlite3";
import axios, { AxiosInstance, AxiosError } from "axios";
import {
  A2ADiscoverMessage,
  A2ADiscoverResponse,
  A2AQueryMessage,
  A2AQueryResponse,
  A2AMutateMessage,
  A2AMutateResponse,
  RemoteRepo,
  ProblemDetails,
} from "../../types/federation.js";
import { createAuditLog } from "./audit.js";

/**
 * A2A Client for making outgoing requests
 */
export class A2AClient {
  private db: Database.Database;
  private localRepoUrl: string;
  private httpClient: AxiosInstance;

  constructor(db: Database.Database, localRepoUrl: string, timeout = 30000) {
    this.db = db;
    this.localRepoUrl = localRepoUrl;

    // Create axios instance with default config
    this.httpClient = axios.create({
      timeout,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "sudocode-federation/1.0",
      },
    });
  }

  /**
   * Send discover request to remote repo
   */
  async discover(remoteRepoUrl: string): Promise<A2ADiscoverResponse> {
    const startTime = Date.now();

    const message: A2ADiscoverMessage = {
      type: "discover",
      from: this.localRepoUrl,
      to: remoteRepoUrl,
      timestamp: new Date().toISOString(),
    };

    try {
      const remoteRepo = this.getRemoteRepo(remoteRepoUrl);
      const endpoint = `${remoteRepo.rest_endpoint}/federation/info`;

      const response = await this.httpClient.post<A2ADiscoverResponse>(
        endpoint,
        message,
        {
          headers: this.getAuthHeaders(remoteRepo),
        }
      );

      // Log successful discover
      await createAuditLog(this.db, {
        operation_type: "discover",
        direction: "outgoing",
        local_repo: this.localRepoUrl,
        remote_repo: remoteRepoUrl,
        payload: JSON.stringify(message),
        result: JSON.stringify(response.data),
        status: "success",
        timestamp: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
      });

      // Update remote repo capabilities
      this.updateRemoteCapabilities(remoteRepoUrl, response.data.capabilities);

      return response.data;
    } catch (error) {
      await this.logError("discover", remoteRepoUrl, message, error, startTime);
      throw this.handleError(error);
    }
  }

  /**
   * Send query request to remote repo
   */
  async query(
    remoteRepoUrl: string,
    message: Omit<A2AQueryMessage, "from" | "to" | "timestamp">
  ): Promise<A2AQueryResponse> {
    const startTime = Date.now();

    const fullMessage: A2AQueryMessage = {
      ...message,
      type: "query",
      from: this.localRepoUrl,
      to: remoteRepoUrl,
      timestamp: new Date().toISOString(),
    };

    try {
      const remoteRepo = this.getRemoteRepo(remoteRepoUrl);
      const endpoint = `${remoteRepo.rest_endpoint}/federation/query`;

      const response = await this.httpClient.post<A2AQueryResponse>(
        endpoint,
        fullMessage,
        {
          headers: this.getAuthHeaders(remoteRepo),
        }
      );

      // Log successful query
      await createAuditLog(this.db, {
        operation_type: "query",
        direction: "outgoing",
        local_repo: this.localRepoUrl,
        remote_repo: remoteRepoUrl,
        payload: JSON.stringify(fullMessage),
        result: JSON.stringify({ count: response.data.results.length }),
        status: "success",
        timestamp: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
      });

      return response.data;
    } catch (error) {
      await this.logError("query", remoteRepoUrl, fullMessage, error, startTime);
      throw this.handleError(error);
    }
  }

  /**
   * Send mutate request to remote repo
   */
  async mutate(
    remoteRepoUrl: string,
    message: Omit<A2AMutateMessage, "from" | "to" | "timestamp">
  ): Promise<A2AMutateResponse> {
    const startTime = Date.now();

    const requestId = message.metadata?.request_id || `req-${Date.now()}`;

    const fullMessage: A2AMutateMessage = {
      ...message,
      type: "mutate",
      from: this.localRepoUrl,
      to: remoteRepoUrl,
      timestamp: new Date().toISOString(),
      metadata: {
        ...message.metadata,
        request_id: requestId,
        requester: message.metadata?.requester || "system",
      },
    };

    try {
      const remoteRepo = this.getRemoteRepo(remoteRepoUrl);
      const endpoint = `${remoteRepo.rest_endpoint}/federation/mutate`;

      // Create outgoing request record
      this.db
        .prepare(
          `
        INSERT INTO cross_repo_requests (
          request_id, direction, from_repo, to_repo,
          request_type, payload, status,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
        )
        .run(
          requestId,
          "outgoing",
          this.localRepoUrl,
          remoteRepoUrl,
          message.operation,
          JSON.stringify(message.data),
          "pending",
          new Date().toISOString(),
          new Date().toISOString()
        );

      const response = await this.httpClient.post<A2AMutateResponse>(
        endpoint,
        fullMessage,
        {
          headers: this.getAuthHeaders(remoteRepo),
        }
      );

      // Update request status
      this.db
        .prepare(
          `
        UPDATE cross_repo_requests
        SET status = ?, result = ?, updated_at = ?
        WHERE request_id = ?
      `
        )
        .run(
          response.data.status === "completed" ? "completed" : "pending",
          JSON.stringify(response.data),
          new Date().toISOString(),
          requestId
        );

      // Log successful mutate
      await createAuditLog(this.db, {
        operation_type: "mutate",
        direction: "outgoing",
        local_repo: this.localRepoUrl,
        remote_repo: remoteRepoUrl,
        request_id: requestId,
        payload: JSON.stringify(fullMessage),
        result: JSON.stringify(response.data),
        status: "success",
        timestamp: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
      });

      return response.data;
    } catch (error) {
      // Update request to failed
      this.db
        .prepare(
          `
        UPDATE cross_repo_requests
        SET status = ?, updated_at = ?
        WHERE request_id = ?
      `
        )
        .run("failed", new Date().toISOString(), requestId);

      await this.logError("mutate", remoteRepoUrl, fullMessage, error, startTime, requestId);
      throw this.handleError(error);
    }
  }

  /**
   * Get remote repo configuration
   */
  private getRemoteRepo(remoteRepoUrl: string): RemoteRepo {
    const repo = this.db
      .prepare<[string]>(
        `
      SELECT * FROM remote_repos WHERE url = ?
    `
      )
      .get(remoteRepoUrl) as RemoteRepo | undefined;

    if (!repo) {
      throw new Error(`Remote repository ${remoteRepoUrl} is not configured`);
    }

    if (!repo.rest_endpoint) {
      throw new Error(
        `Remote repository ${remoteRepoUrl} has no REST endpoint configured`
      );
    }

    return repo;
  }

  /**
   * Get authentication headers for remote repo
   * TODO: Implement proper auth token management
   */
  private getAuthHeaders(_remoteRepo: RemoteRepo): Record<string, string> {
    // For now, return empty headers
    // In production, this would read from environment variables or secret store
    // Example: Authorization: Bearer ${process.env[`REMOTE_REPO_TOKEN_${_remoteRepo.url}`]}
    return {};
  }

  /**
   * Update remote repo capabilities from discover response
   */
  private updateRemoteCapabilities(
    remoteRepoUrl: string,
    capabilities: any
  ): void {
    this.db
      .prepare(
        `
      UPDATE remote_repos
      SET capabilities = ?, last_synced_at = ?, sync_status = ?
      WHERE url = ?
    `
      )
      .run(
        JSON.stringify(capabilities),
        new Date().toISOString(),
        "synced",
        remoteRepoUrl
      );
  }

  /**
   * Get authentication token for remote repo
   * @param _remoteRepo - Remote repository configuration (unused for now)
   * @returns Authentication token or undefined
   */
  // private getAuthToken(_remoteRepo: RemoteRepo): string | undefined {
  //   // TODO: Implement proper auth token retrieval from secrets
  //   // For now, return undefined
  //   return undefined;
  // }

  /**
   * Log error to audit log
   */
  private async logError(
    operationType: string,
    remoteRepoUrl: string,
    message: any,
    error: unknown,
    startTime: number,
    requestId?: string
  ): Promise<void> {
    await createAuditLog(this.db, {
      operation_type: operationType,
      direction: "outgoing",
      local_repo: this.localRepoUrl,
      remote_repo: remoteRepoUrl,
      request_id: requestId,
      payload: JSON.stringify(message),
      status: "failed",
      error_message: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
    });
  }

  /**
   * Handle and format errors
   */
  private handleError(error: unknown): Error {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<ProblemDetails>;

      if (axiosError.response?.data) {
        // Server returned RFC 7807 problem details
        const problem = axiosError.response.data;
        return new Error(`${problem.title}: ${problem.detail}`);
      }

      if (axiosError.code === "ECONNREFUSED") {
        return new Error("Remote repository is unreachable");
      }

      if (axiosError.code === "ETIMEDOUT") {
        return new Error("Request to remote repository timed out");
      }

      return new Error(axiosError.message);
    }

    if (error instanceof Error) {
      return error;
    }

    return new Error(String(error));
  }
}

/**
 * Create A2A client instance
 */
export function createA2AClient(
  db: Database.Database,
  localRepoUrl: string
): A2AClient {
  return new A2AClient(db, localRepoUrl);
}
