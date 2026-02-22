/**
 * Update checker with caching
 * Checks npm registry for new versions and caches results
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { VERSION } from "./version.js";
import { isBinaryInstall } from "./install-source.js";

const PACKAGE_NAME = "@sudocode-ai/cli";
const GITHUB_REPO = "sudocode-ai/sudocode";
const CACHE_DIR = path.join(os.tmpdir(), "sudocode-cli");
const CACHE_FILE = path.join(CACHE_DIR, "update-cache.json");
const DISMISS_FILE = path.join(CACHE_DIR, "update-dismissed.json");
const CACHE_DURATION = 1000 * 60 * 60 * 24; // 24 hours
const DISMISS_DURATION = 1000 * 60 * 60 * 24 * 30; // 30 days

interface UpdateCache {
  timestamp: number;
  latest: string;
}

interface UpdateInfo {
  current: string;
  latest: string;
  updateAvailable: boolean;
}

interface NpmRegistryResponse {
  version?: string;
}

interface DismissInfo {
  timestamp: number;
  version: string;
}

/**
 * Fetch latest version from npm registry
 */
async function fetchLatestVersion(): Promise<string | null> {
  try {
    const response = await fetch(
      `https://registry.npmjs.org/${PACKAGE_NAME}/latest`,
      {
        headers: {
          Accept: "application/json",
        },
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as NpmRegistryResponse;
    return data.version || null;
  } catch {
    return null;
  }
}

/**
 * Fetch latest version from GitHub Releases (for binary installs)
 */
async function fetchLatestVersionFromGitHub(): Promise<string | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: {
          Accept: "application/vnd.github+json",
        },
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as { tag_name?: string };
    const tag = data.tag_name;
    if (!tag) return null;

    // Strip leading "v" from tag (e.g. "v0.1.22" → "0.1.22")
    return tag.startsWith("v") ? tag.slice(1) : tag;
  } catch {
    return null;
  }
}

/**
 * Read cached version info
 */
function readCache(): UpdateCache | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) {
      return null;
    }

    const content = fs.readFileSync(CACHE_FILE, "utf-8");
    const cache: UpdateCache = JSON.parse(content);

    // Check if cache is still valid
    const now = Date.now();
    if (now - cache.timestamp > CACHE_DURATION) {
      return null;
    }

    return cache;
  } catch {
    return null;
  }
}

/**
 * Write version info to cache
 */
function writeCache(latest: string): void {
  try {
    // Ensure cache directory exists
    fs.mkdirSync(CACHE_DIR, { recursive: true });

    const cache: UpdateCache = {
      timestamp: Date.now(),
      latest,
    };

    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), "utf-8");
  } catch {
    // Silently fail if we can't write cache
  }
}

/**
 * Check for updates
 * Returns null if check fails or update info if successful
 */
export async function checkForUpdates(): Promise<UpdateInfo | null> {
  // Try to use cached version first
  const cached = readCache();
  if (cached) {
    return {
      current: VERSION,
      latest: cached.latest,
      updateAvailable: VERSION !== cached.latest,
    };
  }

  // Fetch latest version from appropriate source
  const latest = isBinaryInstall()
    ? await fetchLatestVersionFromGitHub()
    : await fetchLatestVersion();
  if (!latest) {
    return null;
  }

  // Cache the result
  writeCache(latest);

  return {
    current: VERSION,
    latest,
    updateAvailable: VERSION !== latest,
  };
}

/**
 * Compare semver versions
 * Returns true if v1 < v2
 */
export function isOlderVersion(v1: string, v2: string): boolean {
  const parts1 = v1.split(".").map(Number);
  const parts2 = v2.split(".").map(Number);

  for (let i = 0; i < 3; i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;

    if (p1 < p2) return true;
    if (p1 > p2) return false;
  }

  return false;
}

/**
 * Check for updates and return formatted notification message
 */
export async function getUpdateNotification(): Promise<string | null> {
  const info = await checkForUpdates();

  if (!info || !info.updateAvailable) {
    return null;
  }

  // Only notify if latest is actually newer (not just different)
  if (!isOlderVersion(info.current, info.latest)) {
    return null;
  }

  // Check if update notification is dismissed
  if (isDismissed(info.latest)) {
    return null;
  }

  // Compact single-line notification
  return `Update available: ${info.current} → ${info.latest} (run 'sudocode update' or 'sudocode update --dismiss')`;
}

/**
 * Check if update notifications are dismissed
 */
function isDismissed(version: string): boolean {
  try {
    if (!fs.existsSync(DISMISS_FILE)) {
      return false;
    }

    const content = fs.readFileSync(DISMISS_FILE, "utf-8");
    const dismissInfo: DismissInfo = JSON.parse(content);

    // Check if dismissed version matches
    if (dismissInfo.version !== version) {
      return false;
    }

    // Check if dismiss is still valid
    const now = Date.now();
    if (now - dismissInfo.timestamp > DISMISS_DURATION) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Dismiss update notifications for a version
 */
export function dismissUpdate(version: string): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });

    const dismissInfo: DismissInfo = {
      timestamp: Date.now(),
      version,
    };

    fs.writeFileSync(
      DISMISS_FILE,
      JSON.stringify(dismissInfo, null, 2),
      "utf-8"
    );
  } catch {
    // Silently fail
  }
}

/**
 * Clear update cache (useful for testing)
 */
export function clearUpdateCache(): void {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      fs.unlinkSync(CACHE_FILE);
    }
    if (fs.existsSync(DISMISS_FILE)) {
      fs.unlinkSync(DISMISS_FILE);
    }
  } catch {
    // Silently fail
  }
}
