---
id: s-mdsot
title: Configurable Markdown Source of Truth
priority: 2
status: open
tags: [architecture, storage, configuration]
---

# Configurable Markdown Source of Truth

## Overview

Enable markdown files to be the configurable source of truth for entity data, inverting the current JSONL-first architecture. This allows teams who prefer human-readable, wiki-style documentation to treat markdown files as authoritative.

## Current Architecture

```
Markdown Files (.sudocode/specs/*.md)
    ↕ (syncs via watcher, timestamp-based conflict resolution)
JSONL Files (specs.jsonl, issues.jsonl) ← CURRENT SOURCE OF TRUTH
    ↕ (import/export)
SQLite Cache (cache.db) ← QUERY ENGINE (gitignored)
```

## Proposed Architecture (Configurable)

```
Mode: "markdown" (new)                    Mode: "jsonl" (current default)
─────────────────────────                 ─────────────────────────────────
Markdown Files ← SOURCE OF TRUTH          Markdown Files (optional)
    ↓ (derived)                               ↕ (syncs)
JSONL Files (cache/export)                JSONL Files ← SOURCE OF TRUTH
    ↓                                         ↓
SQLite Cache                              SQLite Cache
```

---

## Implementation Plan

### Phase 0: Config Split (Prerequisite)

Split `config.json` into tracked and local files. Currently `config.json` is gitignored, but `sourceOfTruth` needs to be shared across the team.

#### 0.1 New config file structure

```
.sudocode/
├── config.json        # Git-tracked, shared project settings
├── config.local.json  # Gitignored, machine-specific settings
└── ...
```

#### 0.2 Update types (`types/src/index.d.ts`)

```typescript
/**
 * Storage mode determines the source of truth for entity data
 */
export type StorageMode = "jsonl" | "markdown";

/**
 * Shared project configuration (git-tracked: .sudocode/config.json)
 */
export interface ProjectConfig {
  /** Source of truth for entity data (default: "jsonl") */
  sourceOfTruth?: StorageMode;
  /** Integration configurations (shared across team) */
  integrations?: IntegrationsConfig;
}

/**
 * Local machine configuration (gitignored: .sudocode/config.local.json)
 */
export interface LocalConfig {
  /** Worktree configuration (machine-specific paths) */
  worktree?: WorktreeConfig;
  /** Editor configuration (personal preference) */
  editor?: EditorConfig;
  /** Voice configuration (personal preference) */
  voice?: VoiceSettingsConfig;
}

/**
 * Merged configuration (ProjectConfig + LocalConfig)
 */
export interface Config extends ProjectConfig, LocalConfig {
  /** @deprecated Use ProjectConfig fields directly */
  version?: string;
}
```

#### 0.3 Update config.ts (`cli/src/config.ts`)

```typescript
const PROJECT_CONFIG_FILE = "config.json";
const LOCAL_CONFIG_FILE = "config.local.json";

/**
 * Read project config (git-tracked)
 */
function readProjectConfig(outputDir: string): ProjectConfig {
  const configPath = path.join(outputDir, PROJECT_CONFIG_FILE);
  if (!fs.existsSync(configPath)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

/**
 * Read local config (gitignored)
 */
function readLocalConfig(outputDir: string): LocalConfig {
  const configPath = path.join(outputDir, LOCAL_CONFIG_FILE);
  if (!fs.existsSync(configPath)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

/**
 * Get merged config (project + local)
 */
export function getConfig(outputDir: string): Config {
  const project = readProjectConfig(outputDir);
  const local = readLocalConfig(outputDir);
  return { ...project, ...local };
}

/**
 * Update project config (git-tracked)
 */
export function updateProjectConfig(
  outputDir: string,
  updates: Partial<ProjectConfig>
): void {
  const config = readProjectConfig(outputDir);
  Object.assign(config, updates);
  const configPath = path.join(outputDir, PROJECT_CONFIG_FILE);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
}

/**
 * Update local config (gitignored)
 */
export function updateLocalConfig(
  outputDir: string,
  updates: Partial<LocalConfig>
): void {
  const config = readLocalConfig(outputDir);
  Object.assign(config, updates);
  const configPath = path.join(outputDir, LOCAL_CONFIG_FILE);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
}

/**
 * Check if markdown is the source of truth
 */
export function isMarkdownFirst(config: Config): boolean {
  return config.sourceOfTruth === "markdown";
}
```

#### 0.4 Update .gitignore (`.sudocode/.gitignore`)

```diff
  cache.db*
  issues/
  specs/
  worktrees/
- config.json
+ config.local.json
  merge-driver.log
  deploy-config.json
  spawn-config.json
```

#### 0.5 Migration for existing projects

When loading config, migrate old `config.json` to new split:

```typescript
function migrateConfigIfNeeded(outputDir: string): void {
  const oldConfigPath = path.join(outputDir, "config.json");
  const localConfigPath = path.join(outputDir, LOCAL_CONFIG_FILE);

  if (fs.existsSync(oldConfigPath) && !fs.existsSync(localConfigPath)) {
    const oldConfig = JSON.parse(fs.readFileSync(oldConfigPath, "utf8"));

    // Extract local-only fields
    const localConfig: LocalConfig = {};
    if (oldConfig.worktree) localConfig.worktree = oldConfig.worktree;
    if (oldConfig.editor) localConfig.editor = oldConfig.editor;
    if (oldConfig.voice) localConfig.voice = oldConfig.voice;

    // Extract project fields
    const projectConfig: ProjectConfig = {};
    if (oldConfig.integrations) projectConfig.integrations = oldConfig.integrations;
    // sourceOfTruth would be new, not in old config

    // Write split configs
    if (Object.keys(localConfig).length > 0) {
      fs.writeFileSync(localConfigPath, JSON.stringify(localConfig, null, 2));
    }
    fs.writeFileSync(oldConfigPath, JSON.stringify(projectConfig, null, 2));
  }
}
```

#### 0.6 Files to modify

| File | Changes |
|------|---------|
| `types/src/index.d.ts` | Add `ProjectConfig`, `LocalConfig`, `StorageMode` |
| `cli/src/config.ts` | Split read/write, add migration |
| `.sudocode/.gitignore` | Track `config.json`, ignore `config.local.json` |
| `cli/src/cli/init-command.ts` | Create both config files on init |
| `cli/src/cli/config-commands.ts` | Route to correct file based on field |

---

### Phase 1: Watcher Logic Changes

#### 2.1 File Deletion Handling (`cli/src/watcher.ts:470-477`)

**Current behavior:**
```typescript
if (event === "unlink") {
  // File was deleted - DB/JSONL is source of truth, so we don't delete entities
  onLog(`[watch] Markdown file deleted: ${relPath} (DB/JSONL is source of truth)`);
}
```

**New behavior:**
```typescript
if (event === "unlink") {
  const config = getConfig(baseDir);
  if (isMarkdownFirst(config)) {
    // Markdown is source of truth - delete entity from DB
    const entityId = getEntityIdFromPath(filePath, db, entityType);
    if (entityId) {
      if (entityType === "spec") {
        deleteSpec(db, entityId);
      } else {
        deleteIssue(db, entityId);
      }
      onLog(`[watch] Deleted ${entityType} ${entityId} (markdown file removed)`);
      await exportToJSONL(db, { outputDir: baseDir });
    }
  } else {
    // JSONL is source of truth - ignore file deletion
    onLog(`[watch] Markdown file deleted: ${relPath} (JSONL is source of truth)`);
  }
}
```

#### 2.2 Orphaned File Handling (`cli/src/watcher.ts:540-554`)

**Current behavior:** Deletes markdown files without DB entries

**New behavior:**
```typescript
if (syncDirection === "orphaned") {
  const config = getConfig(baseDir);
  if (isMarkdownFirst(config)) {
    // Markdown is source of truth - CREATE entity from markdown
    const syncResult = await syncMarkdownToJSONL(db, baseDir, filePath, {
      autoInitialize: true,  // Generate ID, set defaults
      entityType,
    });
    if (syncResult.success) {
      onLog(`[watch] Created ${entityType} from markdown: ${relPath}`);
      await exportToJSONL(db, { outputDir: baseDir });
    }
  } else {
    // JSONL is source of truth - delete orphaned file
    fs.unlinkSync(filePath);
    onLog(`[watch] Deleted orphaned file: ${relPath}`);
  }
}
```

#### 2.3 Sync Direction Logic (`cli/src/watcher.ts:517-532`)

**Current behavior:** Timestamp comparison, DB wins in ties

**New behavior:**
```typescript
const config = getConfig(baseDir);
if (isMarkdownFirst(config)) {
  // Markdown is source of truth - always sync markdown → DB
  // (unless content matches, to prevent oscillation)
  syncDirection = "markdown-to-db";
} else {
  // JSONL/DB is source of truth - use timestamp comparison
  if (dbTime > fileTime) {
    syncDirection = "db-to-markdown";
  } else {
    syncDirection = "markdown-to-db";
  }
}
```

#### 2.4 Startup Orphan Cleanup (`cli/src/watcher.ts:928-994`)

**Current behavior:** Deletes all markdown files without DB entries on startup

**New behavior:**
```typescript
// For each markdown file without DB entry:
const config = getConfig(baseDir);
if (isMarkdownFirst(config)) {
  // Create entity from markdown file
  await syncMarkdownToJSONL(db, baseDir, filePath, { autoInitialize: true });
} else {
  // Delete orphaned file (current behavior)
  fs.unlinkSync(filePath);
}
```

---

### Phase 2: Sync Commands

#### 3.1 Update `determineSyncDirection()` (`cli/src/cli/sync-commands.ts:416-538`)

**Current behavior:** Prefers database in conflicts (line 531)

**New behavior:**
```typescript
function determineSyncDirection(ctx: CommandContext): {
  direction: "to-markdown" | "from-markdown" | "no-sync";
  reason: string;
} {
  const config = getConfig(ctx.outputDir);

  if (isMarkdownFirst(config)) {
    return { direction: "from-markdown", reason: "Markdown is source of truth" };
  } else {
    // Use existing timestamp-based logic for jsonl mode
    return existingTimestampLogic();
  }
}
```

---

### Phase 3: Entity Operations

#### 4.1 Spec Creation (`cli/src/cli/spec-commands.ts`)

**Current flow:** Generate ID → Create in SQLite → Export JSONL → Sync markdown

**New flow (markdown-first):**
```typescript
if (isMarkdownFirst(config)) {
  // 1. Generate ID
  // 2. Write markdown file with frontmatter
  // 3. Sync markdown → DB (watcher or explicit)
  // 4. Export JSONL (always exported)
} else {
  // Current flow
}
```

#### 4.2 Spec Deletion (`cli/src/cli/spec-commands.ts:415-448`)

**Current flow:** Delete from DB → Delete markdown file → Export JSONL

**New flow (markdown-first):**
```typescript
if (isMarkdownFirst(config)) {
  // 1. Delete markdown file
  // 2. Watcher triggers DB deletion
  // 3. Export JSONL (always exported)
} else {
  // Current flow
}
```

#### 4.3 Issue Operations (`cli/src/cli/issue-commands.ts`)

Same pattern as specs.

---

### Phase 4: Import/Export Changes

#### 5.1 Add `rebuildFromMarkdown()` (`cli/src/import.ts`)

New function to rebuild JSONL + DB from markdown files:

```typescript
/**
 * Rebuild database and JSONL from markdown files (markdown-first mode)
 */
export async function rebuildFromMarkdown(
  db: Database,
  outputDir: string,
  options?: { entityType?: "spec" | "issue" }
): Promise<{ specs: number; issues: number }> {
  const specsDir = path.join(outputDir, "specs");
  const issuesDir = path.join(outputDir, "issues");

  let specCount = 0;
  let issueCount = 0;

  // Process spec markdown files
  if (!options?.entityType || options.entityType === "spec") {
    for (const file of glob.sync("**/*.md", { cwd: specsDir })) {
      await syncMarkdownToJSONL(db, outputDir, path.join(specsDir, file), {
        autoInitialize: true,
        entityType: "spec",
      });
      specCount++;
    }
  }

  // Process issue markdown files
  if (!options?.entityType || options.entityType === "issue") {
    for (const file of glob.sync("**/*.md", { cwd: issuesDir })) {
      await syncMarkdownToJSONL(db, outputDir, path.join(issuesDir, file), {
        autoInitialize: true,
        entityType: "issue",
      });
      issueCount++;
    }
  }

  // Export to JSONL
  await exportToJSONL(db, { outputDir });

  return { specs: specCount, issues: issueCount };
}
```

#### 5.2 Update JSONL import (`cli/src/import.ts`)

Add config check before importing:

```typescript
export async function importFromJSONL(db: Database, outputDir: string): Promise<ImportResult> {
  const config = getConfig(outputDir);

  // In markdown-first mode, JSONL is derived - skip import or warn
  if (isMarkdownFirst(config)) {
    console.warn("JSONL import skipped: markdown is source of truth");
    console.warn("Run 'sudocode sync --from-markdown' to rebuild from markdown files");
    return { specs: 0, issues: 0, skipped: true };
  }

  // Existing import logic...
}
```

---

### Phase 5: CLI Commands

#### 6.1 New sync subcommand

```bash
# Rebuild DB + JSONL from markdown (markdown-first mode)
sudocode sync --from-markdown

# Rebuild markdown from JSONL (jsonl-first mode)
sudocode sync --to-markdown

# Auto-detect based on config
sudocode sync --auto
```

#### 6.2 Config command for storage mode

```bash
# Set source of truth
sudocode config set sourceOfTruth markdown

# View current setting
sudocode config get sourceOfTruth
```

---

### Phase 6: Server Changes

#### 7.1 Export service (`server/src/services/export.ts`)

Add config awareness:

```typescript
export async function scheduleExport(outputDir: string) {
  const config = getConfig(outputDir);

  // Always export JSONL (for git tracking, regardless of mode)
  await exportToJSONL(db, { outputDir });

  if (isMarkdownFirst(config)) {
    // In markdown-first mode, also update markdown files from DB
    // (for changes made via API that didn't go through markdown)
    await syncDBToMarkdown(db, outputDir);
  }
}
```

---

### Phase 7: Documentation Updates

#### 8.1 Files to update

| File | Changes |
|------|---------|
| `.claude/CLAUDE.md` | Update architecture diagram, add storage modes |
| `docs/storage.md` | Document both modes, migration guide |
| `docs/overview.md` | Update source of truth description |
| `README.md` | Add storage configuration section |

---

### Phase 8: Test Updates

#### 9.1 Test files requiring changes

| Test File | Changes Needed |
|-----------|----------------|
| `cli/tests/unit/watcher.test.ts` | Add tests for both modes, update orphan tests |
| `cli/tests/unit/watcher-frontmatter-writeback.test.ts` | Test markdown-first writeback |
| `cli/tests/unit/watcher-callbacks.test.ts` | Test callbacks in both modes |
| `cli/tests/unit/cli/sync-commands.test.ts` | Test direction logic per config |
| `cli/tests/integration/round-trip.test.ts` | Test both directions |

#### 8.2 New test scenarios

```typescript
describe("markdown-first mode", () => {
  it("creates entity when new markdown file is added");
  it("deletes entity when markdown file is removed");
  it("markdown changes always sync to DB");
  it("JSONL is regenerated after markdown changes");
  it("orphaned markdown files create new entities");
  it("git pull with JSONL changes does not override markdown");
});

describe("jsonl-first mode (default)", () => {
  it("orphaned markdown files are deleted");
  it("JSONL changes override markdown");
  it("entity deletion removes markdown file");
});
```

---

## File Change Summary

### Phase 0: Config Split (Prerequisite)

| File | Lines Affected | Description |
|------|----------------|-------------|
| `types/src/index.d.ts` | +25 | Add `ProjectConfig`, `LocalConfig`, `StorageMode` |
| `cli/src/config.ts` | +80 | Split read/write functions, migration logic |
| `.sudocode/.gitignore` | ~1 | Track `config.json`, ignore `config.local.json` |
| `cli/src/cli/init-command.ts` | ~20 | Create both config files on init |
| `cli/src/cli/config-commands.ts` | ~30 | Route to correct file based on field |

### Phase 1-4: Core Logic

| File | Lines Affected | Description |
|------|----------------|-------------|
| `cli/src/watcher.ts` | ~150 | Conditional logic for both modes |
| `cli/src/cli/sync-commands.ts` | ~80 | Update sync direction logic |
| `cli/src/import.ts` | +80 | Add rebuildFromMarkdown() |
| `cli/src/cli/spec-commands.ts` | ~50 | Update create/delete flow |
| `cli/src/cli/issue-commands.ts` | ~50 | Update create/delete flow |
| `cli/src/export.ts` | ~30 | Config awareness |
| `server/src/services/export.ts` | ~20 | Config awareness |

### Low Impact (Tests & Docs)

| File | Lines Affected | Description |
|------|----------------|-------------|
| `cli/tests/unit/watcher.test.ts` | +200 | New test scenarios |
| `cli/tests/unit/watcher-*.test.ts` | +100 | Mode-specific tests |
| `.claude/CLAUDE.md` | ~50 | Update architecture |
| `docs/storage.md` | ~100 | Document both modes |

---

## Migration Guide

### Converting existing project to markdown-first

```bash
# 1. Ensure all entities have markdown files
sudocode sync --to-markdown

# 2. Update config
sudocode config set sourceOfTruth markdown

# 3. Verify
sudocode sync --from-markdown --dry-run
```

### Recommended configurations

**Markdown-first (wiki-style documentation):**
```json
{
  "sourceOfTruth": "markdown"
}
```

**JSONL-first (default, CLI-heavy workflow):**
```json
{
  "sourceOfTruth": "jsonl"
}
```

Or simply omit the field (jsonl is default).

---

## Open Questions

1. **Default for new projects?** Keep `jsonl` as default for backwards compatibility?

2. **Git merge conflicts in markdown?** JSONL is optimized for line-based merges. Markdown conflicts need different handling.

3. **Entities without markdown?** In markdown-first mode, should entities without `.md` files be:
   - Auto-deleted from DB?
   - Auto-generated as `.md` files?
   - Warned about?

4. **Performance at scale?** Markdown parsing is slower than JSONL. Acceptable tradeoff?

5. **Real-time collaboration?** How does markdown-first interact with multiple editors?
