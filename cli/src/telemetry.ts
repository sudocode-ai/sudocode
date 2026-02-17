/**
 * CLI Telemetry via OTLP with Buffer-and-Flush
 *
 * Appends usage events to a local buffer file (<1ms per call).
 * Flushes to a configured OTLP endpoint when conditions are met.
 * Constructs OTLP/HTTP JSON manually — no SDK dependency.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import {
  getProjectConfig,
  getLocalConfig,
  updateProjectConfig,
} from "./config.js";

// --- Types ---

export interface TelemetryEvent {
  /** CLI command name (e.g., "upsert_issue", "link") */
  cmd: string;
  /** Whether the command succeeded */
  success: boolean;
  /** Duration in milliseconds */
  dur: number;
  /** Session ID from SUDOCODE_SESSION_ID env var (optional) */
  sid?: string;
  /** Command-specific attributes */
  attrs?: Record<string, string | number | boolean | undefined>;
}

interface BufferLine {
  ts: number;
  cmd: string;
  success: boolean;
  dur: number;
  sid?: string;
  attrs?: Record<string, string | number | boolean | undefined>;
}

interface FlushMeta {
  lastFlushAt: number;
}

export interface TelemetryConfig {
  endpoint: string;
  authHeader: string;
  projectId: string;
  installationId: string;
  serviceVersion: string;
}

// --- Constants ---

const BUFFER_FILE = "telemetry-buffer.jsonl";
const FLUSH_META_FILE = "telemetry-flush.json";
const FLUSH_INTERVAL_MS = 60_000; // 60 seconds
const MAX_BUFFER_LINES = 100;
const FLUSH_TIMEOUT_MS = 5_000; // 5 second HTTP timeout
const INSTALLATION_CONFIG_FILE = "config.json";

// --- Public API ---

/**
 * Check if telemetry is enabled by reading config.
 * Returns TelemetryConfig if enabled, null otherwise.
 */
export function getTelemetryConfig(outputDir: string): TelemetryConfig | null {
  try {
    const localConfig = getLocalConfig(outputDir);

    if (!localConfig.telemetry?.endpoint || localConfig.telemetry?.disabled) {
      return null;
    }

    const projectId = ensureProjectId(outputDir);
    const installationId = ensureInstallationId();

    // Read version from package.json
    let serviceVersion = "unknown";
    try {
      const pkgPath = path.join(__dirname, "..", "package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      serviceVersion = pkg.version || "unknown";
    } catch {
      // ignore
    }

    return {
      endpoint: localConfig.telemetry.endpoint,
      authHeader: localConfig.telemetry.authHeader || "",
      projectId,
      installationId,
      serviceVersion,
    };
  } catch {
    return null;
  }
}

/**
 * Record a telemetry event and maybe flush the buffer.
 * Convenience wrapper for command handlers — handles config check,
 * event recording, and flush in one call. All errors caught silently.
 */
export async function trackCommand(
  outputDir: string,
  command: string,
  args: Record<string, unknown>,
  success: boolean,
  durationMs: number
): Promise<void> {
  try {
    const config = getTelemetryConfig(outputDir);
    if (!config) return;

    recordEvent(outputDir, {
      cmd: command,
      success,
      dur: durationMs,
      sid: process.env.SUDOCODE_SESSION_ID,
      attrs: extractAttributes(command, args),
    });

    await maybeFlush(outputDir, config);
  } catch {
    // Telemetry must never break CLI commands
  }
}

/**
 * Append a telemetry event to the buffer file.
 * <1ms overhead — sync file append.
 * No-op if telemetry is not configured.
 */
export function recordEvent(outputDir: string, event: TelemetryEvent): void {
  try {
    const bufferPath = path.join(outputDir, BUFFER_FILE);

    // Strip undefined values from attrs
    const attrs = event.attrs
      ? Object.fromEntries(
          Object.entries(event.attrs).filter(([, v]) => v !== undefined)
        )
      : undefined;

    const line: BufferLine = {
      ts: Date.now(),
      cmd: event.cmd,
      success: event.success,
      dur: event.dur,
      ...(event.sid ? { sid: event.sid } : {}),
      ...(attrs && Object.keys(attrs).length > 0 ? { attrs } : {}),
    };

    fs.appendFileSync(bufferPath, JSON.stringify(line) + "\n", "utf8");
  } catch {
    // Telemetry must never break CLI commands
  }
}

/**
 * Check flush conditions and flush if needed.
 * Only adds latency (~100-200ms) when actually flushing.
 */
export async function maybeFlush(
  outputDir: string,
  config: TelemetryConfig
): Promise<void> {
  try {
    const bufferPath = path.join(outputDir, BUFFER_FILE);
    const flushMetaPath = path.join(outputDir, FLUSH_META_FILE);

    // Check if buffer file exists
    if (!fs.existsSync(bufferPath)) return;

    const bufferContent = fs.readFileSync(bufferPath, "utf8").trim();
    if (!bufferContent) return;

    const lines = bufferContent.split("\n");

    // Read flush metadata
    let lastFlushAt = 0;
    try {
      if (fs.existsSync(flushMetaPath)) {
        const meta: FlushMeta = JSON.parse(
          fs.readFileSync(flushMetaPath, "utf8")
        );
        lastFlushAt = meta.lastFlushAt || 0;
      }
    } catch {
      // ignore corrupt flush meta
    }

    const now = Date.now();
    const shouldFlush =
      now - lastFlushAt > FLUSH_INTERVAL_MS ||
      lines.length >= MAX_BUFFER_LINES;

    if (!shouldFlush) return;

    // Parse buffer lines
    const events: BufferLine[] = [];
    for (const line of lines) {
      try {
        events.push(JSON.parse(line));
      } catch {
        // skip malformed lines
      }
    }

    if (events.length === 0) return;

    // Build and send OTLP payload
    const payload = buildOtlpPayload(events, config);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FLUSH_TIMEOUT_MS);

    try {
      const response = await fetch(config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.authHeader
            ? { Authorization: config.authHeader }
            : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok || response.status === 204) {
        // Success — truncate buffer and update flush metadata
        fs.writeFileSync(bufferPath, "", "utf8");
        fs.writeFileSync(
          flushMetaPath,
          JSON.stringify({ lastFlushAt: now }),
          "utf8"
        );
      }
      // On non-OK response, leave buffer intact for retry
    } catch {
      clearTimeout(timeout);
      // Network error or timeout — leave buffer intact for retry
    }
  } catch {
    // Telemetry must never break CLI commands
  }
}

/**
 * Build OTLP/HTTP JSON Log Records payload from buffered events.
 */
export function buildOtlpPayload(
  events: BufferLine[],
  config: TelemetryConfig
): object {
  const logRecords = events.map((event) => {
    const attributes: Array<{ key: string; value: object }> = [
      { key: "tool.name", value: { stringValue: event.cmd } },
      { key: "tool.success", value: { boolValue: event.success } },
      { key: "tool.duration_ms", value: { intValue: String(event.dur) } },
    ];

    // Add session ID if present
    if (event.sid) {
      attributes.push({
        key: "session.id",
        value: { stringValue: event.sid },
      });
    }

    // Add command-specific attributes
    if (event.attrs) {
      for (const [key, val] of Object.entries(event.attrs)) {
        if (val === undefined) continue;
        if (typeof val === "boolean") {
          attributes.push({ key, value: { boolValue: val } });
        } else if (typeof val === "number") {
          attributes.push({ key, value: { intValue: String(val) } });
        } else {
          attributes.push({ key, value: { stringValue: String(val) } });
        }
      }
    }

    return {
      timeUnixNano: String(event.ts) + "000000",
      severityNumber: 9,
      body: { stringValue: "tool_call" },
      attributes,
    };
  });

  return {
    resourceLogs: [
      {
        resource: {
          attributes: [
            {
              key: "service.name",
              value: { stringValue: "sudocode-cli" },
            },
            {
              key: "service.version",
              value: { stringValue: config.serviceVersion },
            },
            {
              key: "project.id",
              value: { stringValue: config.projectId },
            },
            {
              key: "installation.id",
              value: { stringValue: config.installationId },
            },
          ],
        },
        scopeLogs: [
          {
            scope: { name: "sudocode.usage", version: "1" },
            logRecords,
          },
        ],
      },
    ],
  };
}

/**
 * Extract command-specific attributes from CLI command name and args.
 */
export function extractAttributes(
  command: string,
  args: Record<string, unknown>
): Record<string, string | number | boolean | undefined> {
  switch (command) {
    case "issue_create":
      return {
        "entity.type": "issue",
        "entity.operation": "create",
      };

    case "issue_update":
    case "issue_close":
      return {
        "entity.id": args.id as string,
        "entity.type": "issue",
        "entity.operation": "update",
        "entity.status": args.status as string | undefined,
        "entity.archived": args.archived as boolean | undefined,
      };

    case "issue_show":
      return {
        "entity.id": args.id as string,
        "entity.type": "issue",
      };

    case "issue_list":
      return { "entity.type": "issue" };

    case "spec_create":
      return {
        "entity.type": "spec",
        "entity.operation": "create",
      };

    case "spec_update":
      return {
        "entity.id": args.id as string,
        "entity.type": "spec",
        "entity.operation": "update",
      };

    case "spec_show":
      return {
        "entity.id": args.id as string,
        "entity.type": "spec",
      };

    case "spec_list":
      return { "entity.type": "spec" };

    case "link":
      return {
        "link.from_id": args.from_id as string,
        "link.to_id": args.to_id as string,
        "link.type": args.type as string,
      };

    case "add_feedback":
      return {
        "feedback.to_id": args.to_id as string,
        "feedback.from_id": args.from_id as string | undefined,
        "feedback.type": args.feedback_type as string | undefined,
      };

    case "ready":
      return {};

    default:
      return {};
  }
}

/**
 * Get the installation config directory path.
 * Uses XDG_CONFIG_HOME if set, otherwise ~/.config/sudocode
 * (same location as cli/src/auth/credentials.ts)
 */
export function getInstallationConfigDir(): string {
  return process.env.XDG_CONFIG_HOME
    ? path.join(process.env.XDG_CONFIG_HOME, "sudocode")
    : path.join(os.homedir(), ".config", "sudocode");
}

/**
 * Ensure projectId exists in project config, generate if missing.
 * Migrates from old `anonymousId` if present.
 * Returns the project ID.
 */
export function ensureProjectId(outputDir: string): string {
  const projectConfig = getProjectConfig(outputDir);

  // Check for new projectId first
  if (projectConfig.telemetry?.projectId) {
    return projectConfig.telemetry.projectId;
  }

  // Migrate from old anonymousId
  if (projectConfig.telemetry?.anonymousId) {
    const projectId = projectConfig.telemetry.anonymousId;
    updateProjectConfig(outputDir, {
      ...projectConfig,
      telemetry: {
        projectId,
      },
    });
    return projectId;
  }

  // Generate new project ID
  const projectId = `proj-${crypto.randomBytes(4).toString("hex")}`;

  updateProjectConfig(outputDir, {
    ...projectConfig,
    telemetry: {
      ...projectConfig.telemetry,
      projectId,
    },
  });

  return projectId;
}

/**
 * Ensure installationId exists in home directory config, generate if missing.
 * Stored at ~/.config/sudocode/config.json (respects XDG_CONFIG_HOME).
 * Returns the installation ID.
 */
export function ensureInstallationId(): string {
  try {
    const configDir = getInstallationConfigDir();
    const configPath = path.join(configDir, INSTALLATION_CONFIG_FILE);

    // Try to read existing
    try {
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
        if (config.telemetry?.installationId) {
          return config.telemetry.installationId;
        }
      }
    } catch {
      // ignore corrupt config
    }

    // Generate new installation ID
    const installationId = `inst-${crypto.randomBytes(4).toString("hex")}`;

    // Ensure directory exists with secure permissions
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });

    // Read existing config to preserve other fields (e.g., credentials references)
    let config: Record<string, unknown> = {};
    try {
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      }
    } catch {
      // start fresh
    }

    config.telemetry = {
      ...((config.telemetry as Record<string, unknown>) || {}),
      installationId,
    };

    // Atomic write with secure permissions
    const tmpPath = configPath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), {
      mode: 0o600,
    });
    fs.renameSync(tmpPath, configPath);

    return installationId;
  } catch {
    // Fallback: return a transient ID if we can't persist
    return `inst-${crypto.randomBytes(4).toString("hex")}`;
  }
}
