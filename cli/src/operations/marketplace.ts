/**
 * Team preset marketplace and sharing
 */

import * as fs from "fs";
import * as path from "path";
import type { AgentPreset } from "@sudocode-ai/types";
import { getAgentPreset, createAgentPreset } from "./agents.js";
import { createAgentPresetFile } from "../markdown.js";

export interface PresetPackage {
  id: string;
  name: string;
  version: string;
  description: string;
  author: {
    name: string;
    email?: string;
    url?: string;
  };

  // Package contents
  presets: string[]; // Preset IDs included
  workflows?: string[]; // Workflow IDs included

  // Metadata
  tags?: string[];
  category?: string;
  license?: string;
  repository?: string;
  homepage?: string;

  // Dependencies
  dependencies?: Record<string, string>; // Other packages required
  peer_dependencies?: Record<string, string>; // Other packages recommended

  // Stats
  downloads?: number;
  stars?: number;

  // Publishing
  published_at?: string;
  updated_at?: string;
}

export interface MarketplaceEntry {
  package: PresetPackage;
  readme?: string;
  changelog?: string;
  files: Array<{
    path: string;
    content: string;
  }>;
}

export interface MarketplaceRegistry {
  version: string;
  packages: Record<string, PresetPackage>;
  last_updated_at: string;
}

/**
 * Create preset package
 */
export function createPresetPackage(
  sudocodeDir: string,
  input: {
    id: string;
    name: string;
    version: string;
    description: string;
    author: PresetPackage["author"];
    preset_ids: string[];
    workflow_ids?: string[];
    tags?: string[];
    category?: string;
    license?: string;
  }
): PresetPackage {
  // Validate presets exist
  for (const presetId of input.preset_ids) {
    const preset = getAgentPreset(sudocodeDir, presetId);
    if (!preset) {
      throw new Error(`Preset not found: ${presetId}`);
    }
  }

  const pkg: PresetPackage = {
    id: input.id,
    name: input.name,
    version: input.version,
    description: input.description,
    author: input.author,
    presets: input.preset_ids,
    workflows: input.workflow_ids,
    tags: input.tags,
    category: input.category,
    license: input.license || "MIT",
    published_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  return pkg;
}

/**
 * Package presets for distribution
 */
export function packagePresetsForDistribution(
  sudocodeDir: string,
  pkg: PresetPackage,
  options?: {
    include_readme?: boolean;
    include_changelog?: boolean;
  }
): MarketplaceEntry {
  const files: Array<{ path: string; content: string }> = [];

  // Package metadata
  files.push({
    path: "package.json",
    content: JSON.stringify(pkg, null, 2),
  });

  // Include presets
  for (const presetId of pkg.presets) {
    const preset = getAgentPreset(sudocodeDir, presetId);
    if (preset) {
      const presetPath = path.join(
        sudocodeDir,
        "agents",
        "presets",
        `${presetId}.agent.md`
      );
      if (fs.existsSync(presetPath)) {
        files.push({
          path: `presets/${presetId}.agent.md`,
          content: fs.readFileSync(presetPath, "utf-8"),
        });
      }
    }
  }

  // Include workflows if any
  if (pkg.workflows) {
    for (const workflowId of pkg.workflows) {
      const workflowPath = path.join(
        sudocodeDir,
        "agents",
        "workflows",
        `${workflowId}.workflow.json`
      );
      if (fs.existsSync(workflowPath)) {
        files.push({
          path: `workflows/${workflowId}.workflow.json`,
          content: fs.readFileSync(workflowPath, "utf-8"),
        });
      }
    }
  }

  const entry: MarketplaceEntry = {
    package: pkg,
    files,
  };

  // Include README if requested
  if (options?.include_readme) {
    const readmePath = path.join(
      sudocodeDir,
      "agents",
      "presets",
      "README.md"
    );
    if (fs.existsSync(readmePath)) {
      entry.readme = fs.readFileSync(readmePath, "utf-8");
    }
  }

  return entry;
}

/**
 * Install package from marketplace
 */
export function installPackage(
  sudocodeDir: string,
  entry: MarketplaceEntry,
  options?: {
    overwrite?: boolean;
    skip_dependencies?: boolean;
  }
): {
  success: boolean;
  installed_presets: string[];
  installed_workflows: string[];
  errors?: string[];
} {
  const installedPresets: string[] = [];
  const installedWorkflows: string[] = [];
  const errors: string[] = [];

  try {
    // Create directories if needed
    const presetsDir = path.join(sudocodeDir, "agents", "presets");
    const workflowsDir = path.join(sudocodeDir, "agents", "workflows");

    if (!fs.existsSync(presetsDir)) {
      fs.mkdirSync(presetsDir, { recursive: true });
    }
    if (!fs.existsSync(workflowsDir)) {
      fs.mkdirSync(workflowsDir, { recursive: true });
    }

    // Install files
    for (const file of entry.files) {
      if (file.path === "package.json") {
        continue; // Skip package.json
      }

      const targetPath = path.join(sudocodeDir, "agents", file.path);

      // Check if file exists
      if (fs.existsSync(targetPath) && !options?.overwrite) {
        errors.push(`File already exists: ${file.path}`);
        continue;
      }

      // Ensure directory exists
      const dir = path.dirname(targetPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Write file
      fs.writeFileSync(targetPath, file.content);

      // Track installed items
      if (file.path.startsWith("presets/")) {
        const presetId = path.basename(file.path, ".agent.md");
        installedPresets.push(presetId);
      } else if (file.path.startsWith("workflows/")) {
        const workflowId = path.basename(file.path, ".workflow.json");
        installedWorkflows.push(workflowId);
      }
    }

    return {
      success: errors.length === 0,
      installed_presets: installedPresets,
      installed_workflows: installedWorkflows,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error) {
    return {
      success: false,
      installed_presets: installedPresets,
      installed_workflows: installedWorkflows,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

/**
 * Export package to tarball
 */
export function exportPackageToTarball(
  entry: MarketplaceEntry,
  outputPath: string
): void {
  // Create a simple archive format (JSON-based for simplicity)
  const archive = {
    package: entry.package,
    readme: entry.readme,
    changelog: entry.changelog,
    files: entry.files,
  };

  fs.writeFileSync(outputPath, JSON.stringify(archive, null, 2));
}

/**
 * Import package from tarball
 */
export function importPackageFromTarball(tarballPath: string): MarketplaceEntry {
  const content = fs.readFileSync(tarballPath, "utf-8");
  return JSON.parse(content);
}

/**
 * Initialize local marketplace registry
 */
export function initializeMarketplaceRegistry(
  sudocodeDir: string
): MarketplaceRegistry {
  const registryPath = getMarketplaceRegistryPath(sudocodeDir);

  if (fs.existsSync(registryPath)) {
    return JSON.parse(fs.readFileSync(registryPath, "utf-8"));
  }

  const registry: MarketplaceRegistry = {
    version: "1.0.0",
    packages: {},
    last_updated_at: new Date().toISOString(),
  };

  saveMarketplaceRegistry(sudocodeDir, registry);
  return registry;
}

/**
 * Get marketplace registry path
 */
function getMarketplaceRegistryPath(sudocodeDir: string): string {
  return path.join(sudocodeDir, "agents", "marketplace.json");
}

/**
 * Save marketplace registry
 */
export function saveMarketplaceRegistry(
  sudocodeDir: string,
  registry: MarketplaceRegistry
): void {
  const registryPath = getMarketplaceRegistryPath(sudocodeDir);
  const dir = path.dirname(registryPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  registry.last_updated_at = new Date().toISOString();
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
}

/**
 * Add package to local registry
 */
export function addToLocalRegistry(
  sudocodeDir: string,
  pkg: PresetPackage
): void {
  const registry = initializeMarketplaceRegistry(sudocodeDir);
  registry.packages[pkg.id] = pkg;
  saveMarketplaceRegistry(sudocodeDir, registry);
}

/**
 * Search packages in registry
 */
export function searchPackages(
  sudocodeDir: string,
  query: {
    text?: string;
    tags?: string[];
    category?: string;
    author?: string;
  }
): PresetPackage[] {
  const registry = initializeMarketplaceRegistry(sudocodeDir);
  let packages = Object.values(registry.packages);

  // Filter by text search
  if (query.text) {
    const searchLower = query.text.toLowerCase();
    packages = packages.filter(
      (pkg) =>
        pkg.name.toLowerCase().includes(searchLower) ||
        pkg.description.toLowerCase().includes(searchLower) ||
        pkg.id.toLowerCase().includes(searchLower)
    );
  }

  // Filter by tags
  if (query.tags && query.tags.length > 0) {
    packages = packages.filter((pkg) =>
      query.tags!.some((tag) => pkg.tags?.includes(tag))
    );
  }

  // Filter by category
  if (query.category) {
    packages = packages.filter((pkg) => pkg.category === query.category);
  }

  // Filter by author
  if (query.author) {
    const authorLower = query.author.toLowerCase();
    packages = packages.filter((pkg) =>
      pkg.author.name.toLowerCase().includes(authorLower)
    );
  }

  return packages;
}

/**
 * Get package from registry
 */
export function getPackageFromRegistry(
  sudocodeDir: string,
  packageId: string
): PresetPackage | null {
  const registry = initializeMarketplaceRegistry(sudocodeDir);
  return registry.packages[packageId] || null;
}

/**
 * Share package to team repository
 */
export function sharePackageToTeam(
  sudocodeDir: string,
  packageId: string,
  teamRepoPath: string
): {
  success: boolean;
  package_path?: string;
  error?: string;
} {
  try {
    const pkg = getPackageFromRegistry(sudocodeDir, packageId);
    if (!pkg) {
      return {
        success: false,
        error: `Package not found: ${packageId}`,
      };
    }

    const entry = packagePresetsForDistribution(sudocodeDir, pkg, {
      include_readme: true,
      include_changelog: true,
    });

    // Create package directory
    const packageDir = path.join(teamRepoPath, "packages", packageId);
    if (!fs.existsSync(packageDir)) {
      fs.mkdirSync(packageDir, { recursive: true });
    }

    // Export to tarball
    const tarballPath = path.join(packageDir, `${packageId}-${pkg.version}.json`);
    exportPackageToTarball(entry, tarballPath);

    return {
      success: true,
      package_path: tarballPath,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Install package from team repository
 */
export function installFromTeamRepo(
  sudocodeDir: string,
  teamRepoPath: string,
  packageId: string,
  version?: string
): {
  success: boolean;
  installed_presets?: string[];
  installed_workflows?: string[];
  error?: string;
} {
  try {
    const packageDir = path.join(teamRepoPath, "packages", packageId);
    if (!fs.existsSync(packageDir)) {
      return {
        success: false,
        error: `Package not found in team repository: ${packageId}`,
      };
    }

    // Find tarball
    const files = fs.readdirSync(packageDir);
    let tarballFile: string | undefined;

    if (version) {
      tarballFile = files.find((f) => f === `${packageId}-${version}.json`);
    } else {
      // Get latest version
      tarballFile = files
        .filter((f) => f.startsWith(packageId) && f.endsWith(".json"))
        .sort()
        .pop();
    }

    if (!tarballFile) {
      return {
        success: false,
        error: `No tarball found for package: ${packageId}`,
      };
    }

    const tarballPath = path.join(packageDir, tarballFile);
    const entry = importPackageFromTarball(tarballPath);

    const result = installPackage(sudocodeDir, entry);

    if (result.success) {
      // Add to local registry
      addToLocalRegistry(sudocodeDir, entry.package);
    }

    return {
      success: result.success,
      installed_presets: result.installed_presets,
      installed_workflows: result.installed_workflows,
      error: result.errors?.join(", "),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * List available packages in team repository
 */
export function listTeamPackages(teamRepoPath: string): PresetPackage[] {
  const packagesDir = path.join(teamRepoPath, "packages");

  if (!fs.existsSync(packagesDir)) {
    return [];
  }

  const packages: PresetPackage[] = [];
  const packageDirs = fs.readdirSync(packagesDir);

  for (const dir of packageDirs) {
    const packagePath = path.join(packagesDir, dir);
    if (!fs.statSync(packagePath).isDirectory()) {
      continue;
    }

    // Find latest tarball
    const files = fs.readdirSync(packagePath);
    const tarballFile = files
      .filter((f) => f.endsWith(".json"))
      .sort()
      .pop();

    if (tarballFile) {
      const tarballPath = path.join(packagePath, tarballFile);
      try {
        const entry = importPackageFromTarball(tarballPath);
        packages.push(entry.package);
      } catch {
        // Skip invalid packages
      }
    }
  }

  return packages;
}
