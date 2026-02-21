/**
 * Update command handlers
 */

import chalk from "chalk";
import { execSync } from "child_process";
import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { pipeline } from "stream/promises";
import { createWriteStream } from "fs";
import https from "https";
import { checkForUpdates, dismissUpdate } from "../update-checker.js";
import { detectInstallSource, detectPlatform, getBinaryInstallDir } from "../install-source.js";

const execFileAsync = promisify(execFile);
const GITHUB_REPO = "sudocode-ai/sudocode";

/**
 * Detect which sudocode package is globally installed
 * Returns the package name to update
 */
async function detectInstalledPackage(): Promise<string> {
  try {
    // Check if metapackage is installed
    execSync("npm list -g sudocode --depth=0", {
      stdio: "pipe",
      encoding: "utf8",
    });
    return "sudocode"; // Metapackage is installed
  } catch {
    // Metapackage not found, fall back to CLI
    return "@sudocode-ai/cli";
  }
}

/**
 * Install package with smart force retry
 * Tries without --force first, retries with --force only on EEXIST
 */
function installPackageWithRetry(packageName: string): void {
  const baseCommand = `npm install -g ${packageName}`;

  console.log();
  console.log(chalk.cyan(`Running: ${baseCommand}`));
  console.log();

  try {
    // First attempt: without --force
    execSync(baseCommand, { stdio: "inherit" });
  } catch (error) {
    // Check if it's an EEXIST error
    if (error instanceof Error && error.message.includes("EEXIST")) {
      console.log();
      console.log(
        chalk.yellow("File already exists, retrying with --force...")
      );
      console.log();

      try {
        // Retry with --force
        const forceCommand = `${baseCommand} --force`;
        console.log(chalk.cyan(`Running: ${forceCommand}`));
        console.log();
        execSync(forceCommand, { stdio: "inherit" });
      } catch (retryError) {
        // If retry also fails, throw the error to be handled by caller
        throw retryError;
      }
    } else {
      // Not an EEXIST error, re-throw
      throw error;
    }
  }

  // Refresh Volta shim if sudocode is managed by Volta
  // This is necessary because Volta caches package locations at shell initialization
  if (isUsingVoltaForSudocode()) {
    console.log();
    console.log(chalk.dim("Detected Volta - refreshing package shim..."));
    try {
      execSync(`volta install ${packageName}`, { stdio: "inherit" });
    } catch (voltaError) {
      // Volta refresh failed - not critical since npm install succeeded
      console.log(chalk.yellow("Warning: Failed to refresh Volta shim"));
      console.log(chalk.dim("You may need to re-install sudocode"));
    }
  }
}

/**
 * Check if sudocode was installed via Volta
 *
 * Volta is a Node.js version manager that creates shims for globally installed packages.
 * When a package is installed via npm while Volta is active, the binary is placed in
 * Volta's managed directory (typically ~/.volta/bin or $VOLTA_HOME/bin).
 *
 * This function detects if the sudocode binary is managed by Volta by:
 * 1. Checking if Volta is installed on the system
 * 2. Getting the actual path of the sudocode executable
 * 3. Verifying the path is within Volta's managed directories
 *
 * Why this matters:
 * Volta caches the resolved paths of executables at shell initialization time.
 * When sudocode is updated via `npm install -g`, the files are updated but the
 * current shell session continues to use the old cached path until the shell
 * is restarted. This is Volta's intended behavior for performance.
 *
 * @returns true if sudocode binary is managed by Volta, false otherwise
 */
function isUsingVoltaForSudocode(): boolean {
  try {
    // First check if Volta exists on the system
    execSync("volta --version", { stdio: "pipe" });

    // Get the actual path of the sudocode binary
    const binPath = execSync("which sudocode", {
      stdio: "pipe",
      encoding: "utf8",
    }).trim();

    // Check VOLTA_HOME environment variable if set (user may have custom location)
    const voltaHome = process.env.VOLTA_HOME;
    if (voltaHome) {
      return binPath.startsWith(voltaHome);
    }

    // Fall back to checking for default /.volta/ directory in path
    return binPath.includes("/.volta/");
  } catch {
    // Volta not installed, which command failed, or other error
    return false;
  }
}

/**
 * Best-effort update of the Claude Code marketplace plugin.
 * If the claude CLI is not available, prints a note and moves on.
 */
function updateClaudePlugin(): void {
  try {
    execSync("claude --version", { stdio: "pipe" });
  } catch {
    console.log();
    console.log(
      chalk.dim("Claude CLI not found — skipping marketplace plugin update")
    );
    return;
  }

  try {
    console.log();
    console.log(chalk.dim("Updating Claude Code marketplace plugin..."));
    execSync("claude plugin marketplace update sudocode-ai/sudocode", {
      stdio: "inherit",
    });
    execSync("claude plugin update sudocode@sudocode-marketplace", {
      stdio: "inherit",
    });
    console.log(chalk.green("✓ Claude Code plugin updated"));
  } catch {
    // Best-effort — don't fail the overall update
  }
}

/**
 * Download a file from a URL, following redirects
 */
function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        downloadFile(res.headers.location!, destPath).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const ws = createWriteStream(destPath);
      pipeline(res, ws).then(resolve).catch(reject);
    }).on("error", reject);
  });
}

/**
 * Compute SHA256 checksum of a file
 */
function sha256File(filePath: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

/**
 * Handle binary self-update (Unix only).
 * On Windows, prints reinstall instructions and exits.
 */
async function handleBinaryUpdate(): Promise<void> {
  const platform = detectPlatform();
  console.log(chalk.dim(`Install source: binary (${platform})`));

  // Windows: self-update not supported
  if (process.platform === "win32") {
    console.log();
    console.log(chalk.red("Self-update is not supported on Windows."));
    console.log();
    console.log("To update, remove the current installation and reinstall:");
    console.log();
    console.log(chalk.yellow('  Remove-Item -Recurse -Force "$env:LOCALAPPDATA\\sudocode"'));
    console.log(chalk.yellow("  irm https://raw.githubusercontent.com/sudocode-ai/sudocode/main/scripts/install.ps1 | iex"));
    console.log();
    process.exit(1);
  }

  // Fetch latest release tag
  console.log(chalk.dim("Fetching latest release..."));
  let releaseTag: string;
  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      { headers: { Accept: "application/vnd.github+json" } }
    );
    if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
    const data = (await response.json()) as { tag_name: string };
    releaseTag = data.tag_name;
  } catch (error) {
    console.log(chalk.red("Failed to fetch latest release from GitHub"));
    if (error instanceof Error) console.log(chalk.dim(error.message));
    process.exit(1);
  }

  // Download manifest
  const manifestUrl = `https://github.com/${GITHUB_REPO}/releases/download/${releaseTag}/manifest.json`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sudocode-update-"));

  try {
    const manifestPath = path.join(tempDir, "manifest.json");
    console.log(chalk.dim("Downloading manifest..."));
    await downloadFile(manifestUrl, manifestPath);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      version: string;
      platforms: Record<string, { url: string; sha256: string; size: number }>;
    };

    const platformInfo = manifest.platforms[platform];
    if (!platformInfo) {
      console.log(chalk.red(`No binary available for platform: ${platform}`));
      console.log("Available platforms:", Object.keys(manifest.platforms).join(", "));
      process.exit(1);
    }

    // Download tarball
    const tarballPath = path.join(tempDir, "sudocode.tar.gz");
    console.log(`Downloading sudocode ${manifest.version}...`);
    await downloadFile(platformInfo.url, tarballPath);

    // Verify checksum
    console.log(chalk.dim("Verifying checksum..."));
    const computed = sha256File(tarballPath);
    if (computed !== platformInfo.sha256) {
      console.log(chalk.red("Checksum mismatch!"));
      console.log(`  Expected: ${platformInfo.sha256}`);
      console.log(`  Got:      ${computed}`);
      process.exit(1);
    }
    console.log(chalk.dim("Checksum verified"));

    // Extract
    const extractDir = path.join(tempDir, "extract");
    fs.mkdirSync(extractDir, { recursive: true });
    await execFileAsync("tar", ["-xzf", tarballPath, "-C", extractDir]);

    // Find extracted directory
    const entries = fs.readdirSync(extractDir);
    const extracted = entries.find((e) =>
      fs.statSync(path.join(extractDir, e)).isDirectory()
    );
    if (!extracted) {
      console.log(chalk.red("Empty archive"));
      process.exit(1);
    }
    const extractedDir = path.join(extractDir, extracted);

    // Determine install directory
    const installDir = getBinaryInstallDir();
    if (!installDir) {
      console.log(chalk.red("Could not determine install directory"));
      console.log("Set SUDOCODE_INSTALL_DIR environment variable and try again");
      process.exit(1);
    }

    // Replace files
    console.log(chalk.dim(`Installing to ${installDir}...`));

    // Copy bin/ contents
    const srcBin = path.join(extractedDir, "bin");
    const destBin = path.join(installDir, "bin");
    if (fs.existsSync(srcBin)) {
      for (const file of fs.readdirSync(srcBin)) {
        const srcFile = path.join(srcBin, file);
        const destFile = path.join(destBin, file);
        // Skip symlinks (sdc) — recreate after
        const stat = fs.lstatSync(srcFile);
        if (stat.isSymbolicLink()) continue;
        fs.copyFileSync(srcFile, destFile);
        fs.chmodSync(destFile, 0o755);
      }
      // Recreate sdc symlink
      const sdcPath = path.join(destBin, "sdc");
      try { fs.unlinkSync(sdcPath); } catch { /* may not exist */ }
      fs.symlinkSync("sudocode", sdcPath);
    }

    // Copy node_modules/ (native modules like better-sqlite3)
    const srcModules = path.join(extractedDir, "node_modules");
    const destModules = path.join(installDir, "node_modules");
    if (fs.existsSync(srcModules)) {
      if (fs.existsSync(destModules)) fs.rmSync(destModules, { recursive: true });
      fs.cpSync(srcModules, destModules, { recursive: true });
    }

    // Copy public/ (frontend assets)
    const srcPublic = path.join(extractedDir, "public");
    const destPublic = path.join(installDir, "public");
    if (fs.existsSync(srcPublic)) {
      if (fs.existsSync(destPublic)) fs.rmSync(destPublic, { recursive: true });
      fs.cpSync(srcPublic, destPublic, { recursive: true });
    }

    // Copy package.json
    const srcPkg = path.join(extractedDir, "package.json");
    if (fs.existsSync(srcPkg)) {
      fs.copyFileSync(srcPkg, path.join(installDir, "package.json"));
    }

    console.log();
    console.log(chalk.green(`✓ Updated to ${manifest.version}`));
    console.log();
    console.log("Run 'sudocode --version' to verify the new version");

    // Best-effort: update Claude Code marketplace plugin
    updateClaudePlugin();
  } finally {
    // Cleanup temp dir
    try { fs.rmSync(tempDir, { recursive: true }); } catch { /* ignore */ }
  }
}

/**
 * Handle update check command
 */
export async function handleUpdateCheck(): Promise<void> {
  console.log(chalk.cyan("Checking for updates..."));

  const info = await checkForUpdates();

  const source = detectInstallSource();

  if (!info) {
    console.log(chalk.yellow("Unable to check for updates"));
    console.log("Please try again later or check manually:");
    if (source === "binary") {
      console.log("  Check https://github.com/sudocode-ai/sudocode/releases");
    } else {
      const packageName = await detectInstalledPackage();
      console.log(`  npm view ${packageName} version`);
    }
    return;
  }

  console.log(`Current version: ${chalk.cyan(info.current)}`);
  console.log(`Latest version:  ${chalk.cyan(info.latest)}`);
  if (source === "binary") {
    console.log(`Source: ${chalk.dim(`binary (${detectPlatform()})`)}`);
  } else {
    const packageName = await detectInstalledPackage();
    console.log(`Package: ${chalk.dim(packageName)}`);
  }

  if (info.updateAvailable) {
    console.log();
    console.log(chalk.green("✓ Update available!"));
    console.log();
    console.log("To update, run:");
    console.log(chalk.yellow(`  sudocode update`));
    if (source !== "binary") {
      const packageName = await detectInstalledPackage();
      console.log();
      console.log("Or manually:");
      console.log(chalk.yellow(`  npm install -g ${packageName} --force`));
    }
  } else {
    console.log();
    console.log(chalk.green("✓ You are using the latest version"));
  }
}

/**
 * Handle update install command
 */
export async function handleUpdate(): Promise<void> {
  console.log(chalk.cyan("Checking for updates..."));

  const source = detectInstallSource();

  // Binary install → use binary update flow
  if (source === "binary") {
    const info = await checkForUpdates();
    if (info && !info.updateAvailable) {
      console.log(chalk.green("✓ Already on latest version:"), info.current);
      return;
    }
    if (info) {
      console.log(`Updating from ${info.current} to ${info.latest}...`);
    }
    await handleBinaryUpdate();
    return;
  }

  // npm/Volta install → existing npm flow
  const info = await checkForUpdates();

  if (!info) {
    console.log(chalk.yellow("Unable to check for updates"));
    console.log("Attempting to update anyway...");
  } else if (!info.updateAvailable) {
    console.log(chalk.green("✓ Already on latest version:"), info.current);
    return;
  } else {
    console.log(`Updating from ${info.current} to ${info.latest}...`);
  }

  // Detect which package to update
  const packageToUpdate = await detectInstalledPackage();

  if (source === "volta") {
    console.log(chalk.dim("Detected Volta-managed installation"));
  } else if (packageToUpdate === "sudocode") {
    console.log(
      chalk.dim("Detected metapackage installation - updating all components")
    );
  } else {
    console.log(chalk.dim("Detected standalone CLI installation"));
  }

  try {
    installPackageWithRetry(packageToUpdate);

    console.log();
    console.log(chalk.green("✓ Update completed successfully!"));
    console.log();
    console.log("Run 'sudocode --version' to verify the new version");

    // Best-effort: update Claude Code marketplace plugin
    updateClaudePlugin();
  } catch (error) {
    console.log();
    console.error(chalk.red("✗ Update failed"));
    console.log();
    console.log("Please try updating manually:");
    console.log(chalk.yellow(`  npm install -g ${packageToUpdate} --force`));
    console.log();

    if (error instanceof Error) {
      console.log("Error details:");
      console.log(chalk.dim(error.message));
    }

    process.exit(1);
  }
}

/**
 * Handle update dismiss command
 */
export async function handleUpdateDismiss(): Promise<void> {
  const info = await checkForUpdates();

  if (!info) {
    console.log(chalk.yellow("Unable to check for updates"));
    return;
  }

  if (!info.updateAvailable) {
    console.log(chalk.green("✓ Already on latest version:"), info.current);
    console.log("No update notifications to dismiss");
    return;
  }

  dismissUpdate(info.latest);
  console.log(chalk.green("✓ Update notifications dismissed for 30 days"));
  console.log();
  console.log(
    `You won't be notified about version ${info.latest} for the next 30 days`
  );
  console.log("To update now, run:", chalk.cyan("sudocode update"));
}
