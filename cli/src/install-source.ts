/**
 * Install source detection
 *
 * Detects how sudocode was installed (binary, npm, Volta) and
 * the current platform. Used by the update checker and update commands.
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

export type InstallSource = "binary" | "npm-meta" | "npm-standalone" | "volta";

/**
 * Detect how sudocode was installed.
 *
 * Detection order matters:
 * 1. SEA binary check (most definitive — if it's a SEA, it's a binary install)
 * 2. Volta check (path-based, fast)
 * 3. npm metapackage check (shells out to npm)
 * 4. Fallback to npm standalone
 */
export function detectInstallSource(): InstallSource {
  if (isBinaryInstall()) {
    return "binary";
  }

  if (isVoltaInstall()) {
    return "volta";
  }

  if (isNpmMetapackage()) {
    return "npm-meta";
  }

  return "npm-standalone";
}

/**
 * Check if running as a Node.js SEA (Single Executable Application).
 *
 * In Node 20+, SEA binaries have a sentinel fuse baked into the binary.
 * The `node:sea` built-in module exposes `isSea()` only inside SEA executables.
 * In non-SEA contexts, `require('node:sea')` throws.
 */
export function isBinaryInstall(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const seaModule = require("node:sea") as { isSea(): boolean };
    return seaModule.isSea();
  } catch {
    // node:sea module not available — not a SEA binary
    return false;
  }
}

/**
 * Check if sudocode was installed via Volta.
 */
function isVoltaInstall(): boolean {
  try {
    const binPath = process.execPath;
    const voltaHome = process.env.VOLTA_HOME;
    if (voltaHome && binPath.startsWith(voltaHome)) {
      return true;
    }
    return binPath.includes("/.volta/");
  } catch {
    return false;
  }
}

/**
 * Check if the sudocode npm metapackage is globally installed.
 */
function isNpmMetapackage(): boolean {
  try {
    execSync("npm list -g sudocode --depth=0", {
      stdio: "pipe",
      encoding: "utf8",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect the current platform key matching our binary distribution names.
 * Returns e.g. "linux-x64", "darwin-arm64", "win-x64", "linux-x64-musl".
 */
export function detectPlatform(): string {
  const os = process.platform === "win32" ? "win" : process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const musl = os === "linux" ? detectMusl() : "";
  return `${os}-${arch}${musl}`;
}

/**
 * Detect musl libc on Linux (Alpine, Void, etc.)
 */
function detectMusl(): string {
  try {
    if (
      fs.existsSync("/lib/ld-musl-x86_64.so.1") ||
      fs.existsSync("/lib/ld-musl-aarch64.so.1")
    ) {
      return "-musl";
    }

    // Check ldd output
    const lddOutput = execSync("ldd --version 2>&1", {
      stdio: "pipe",
      encoding: "utf8",
    });
    if (lddOutput.toLowerCase().includes("musl")) {
      return "-musl";
    }
  } catch {
    // ldd failed — not critical
  }
  return "";
}

/**
 * Get the install directory for binary installations.
 * Resolves from process.execPath (e.g. ~/.local/share/sudocode/bin/sudocode → ~/.local/share/sudocode/)
 * or from SUDOCODE_INSTALL_DIR environment variable.
 */
export function getBinaryInstallDir(): string | null {
  if (process.env.SUDOCODE_INSTALL_DIR) {
    return process.env.SUDOCODE_INSTALL_DIR;
  }

  try {
    // process.execPath → .../sudocode/bin/sudocode → go up 2 levels
    const binDir = path.dirname(process.execPath);
    const packageDir = path.dirname(binDir);

    // Validate: check that bin/ subdir exists
    if (fs.existsSync(path.join(packageDir, "bin"))) {
      return packageDir;
    }
  } catch {
    // Fall through
  }

  return null;
}
