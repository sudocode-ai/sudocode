/**
 * Scheduler configuration operations
 */

import type Database from "better-sqlite3";
import type { SchedulerConfig, QualityGateConfig } from "@sudocode-ai/types";

/**
 * Get scheduler configuration
 */
export function getSchedulerConfig(db: Database.Database): SchedulerConfig {
  const stmt = db.prepare(`
    SELECT * FROM scheduler_config WHERE id = 'default'
  `);

  const row = stmt.get() as
    | {
        id: string;
        enabled: number;
        max_concurrency: number;
        poll_interval: number;
        quality_gates_enabled: number;
        quality_gates_config: string | null;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  if (!row) {
    throw new Error("Scheduler config not found");
  }

  let qualityGatesConfig: QualityGateConfig | undefined;
  if (row.quality_gates_config) {
    try {
      qualityGatesConfig = JSON.parse(row.quality_gates_config);
    } catch (e) {
      console.error("Failed to parse quality gates config:", e);
    }
  }

  return {
    id: row.id,
    enabled: row.enabled === 1,
    maxConcurrency: row.max_concurrency,
    pollInterval: row.poll_interval,
    qualityGatesEnabled: row.quality_gates_enabled === 1,
    qualityGatesConfig,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Update scheduler configuration
 */
export function updateSchedulerConfig(
  db: Database.Database,
  input: Partial<
    Pick<
      SchedulerConfig,
      | "enabled"
      | "maxConcurrency"
      | "pollInterval"
      | "qualityGatesEnabled"
      | "qualityGatesConfig"
    >
  >
): SchedulerConfig {
  const updates: string[] = [];
  const params: Record<string, any> = { id: "default" };

  if (input.enabled !== undefined) {
    updates.push("enabled = @enabled");
    params.enabled = input.enabled ? 1 : 0;
  }

  if (input.maxConcurrency !== undefined) {
    if (input.maxConcurrency < 1 || input.maxConcurrency > 10) {
      throw new Error("maxConcurrency must be between 1 and 10");
    }
    updates.push("max_concurrency = @max_concurrency");
    params.max_concurrency = input.maxConcurrency;
  }

  if (input.pollInterval !== undefined) {
    if (input.pollInterval < 1000) {
      throw new Error("pollInterval must be at least 1000ms");
    }
    updates.push("poll_interval = @poll_interval");
    params.poll_interval = input.pollInterval;
  }

  if (input.qualityGatesEnabled !== undefined) {
    updates.push("quality_gates_enabled = @quality_gates_enabled");
    params.quality_gates_enabled = input.qualityGatesEnabled ? 1 : 0;
  }

  if (input.qualityGatesConfig !== undefined) {
    updates.push("quality_gates_config = @quality_gates_config");
    params.quality_gates_config =
      input.qualityGatesConfig === null
        ? null
        : JSON.stringify(input.qualityGatesConfig);
  }

  if (updates.length === 0) {
    return getSchedulerConfig(db);
  }

  // Always update updated_at
  updates.push("updated_at = CURRENT_TIMESTAMP");

  const stmt = db.prepare(`
    UPDATE scheduler_config
    SET ${updates.join(", ")}
    WHERE id = @id
  `);

  stmt.run(params);

  return getSchedulerConfig(db);
}
