# Markdown Source of Truth - Implementation Plan

## Overview

This document tracks the implementation of configurable markdown source of truth for sudocode. The feature allows teams to choose whether JSONL files (default) or markdown files are the authoritative source for entity data.

**Branch:** `claude/markdown-source-of-truth-tdF4t`

**Spec:** [markdown-source-of-truth.md](./markdown-source-of-truth.md)

---

## Configuration Design

Single config option in `config.json` (git-tracked):

```json
{
  "sourceOfTruth": "markdown"
}
```

- `"jsonl"` (default): JSONL files are authoritative, markdown is derived
- `"markdown"`: Markdown files are authoritative, JSONL is derived

JSONL is always exported regardless of mode (for git tracking).

---

## Implementation Phases

### Phase 0: Config Split (Prerequisite)
**Status:** In Progress

Split configuration into tracked and local files:
- `config.json` - Git-tracked, shared project settings
- `config.local.json` - Gitignored, machine-specific settings

#### Files Modified
- [x] `types/src/index.d.ts` - Add `ProjectConfig`, `LocalConfig`, `StorageMode`
- [x] `cli/src/config.ts` - Split read/write, add migration, add `isMarkdownFirst()`
- [x] `.sudocode/.gitignore` - Track `config.json`, ignore `config.local.json`
- [x] `cli/src/cli/init-commands.ts` - Create both config files on init
- [x] `cli/tests/unit/config.test.ts` - Test config split functionality

#### Testing Checklist
- [ ] New projects create both config files
- [ ] Existing projects migrate correctly
- [ ] `getConfig()` merges both files
- [ ] `updateProjectConfig()` only writes to `config.json`
- [ ] `updateLocalConfig()` only writes to `config.local.json`
- [ ] Git correctly tracks `config.json` and ignores `config.local.json`

---

### Phase 1: Watcher Logic Changes
**Status:** Complete

Update watcher to respect `sourceOfTruth` setting.

#### Files Modified
- [x] `cli/src/watcher.ts` - Conditional logic for both modes
  - Added imports for `getConfig`, `isMarkdownFirst`, `deleteSpec`, `deleteIssue`
  - Added file path to entity ID cache (`filePathToEntityCache`) for deletion handling
  - Added helper functions: `updateFilePathCache`, `removeFilePathFromCache`, `getEntityFromFilePathCache`

#### Key Changes Implemented
1. **File deletion handling** (lines ~507-560)
   - `jsonl` mode: Ignore markdown file deletion, preserve entity
   - `markdown` mode: Delete entity from DB, export JSONL, clean up cache

2. **Orphaned file handling** (lines ~625-706)
   - `jsonl` mode: Delete orphaned markdown files (current behavior)
   - `markdown` mode: Create entity from orphaned file via `syncMarkdownToJSONL`

3. **Sync direction logic** (lines ~604-630)
   - `jsonl` mode: Timestamp-based comparison (current behavior)
   - `markdown` mode: Always sync markdown → DB

4. **Startup cleanup** (lines ~1085-1200)
   - `jsonl` mode: Delete orphaned files (current behavior)
   - `markdown` mode: Create entities from orphaned files, batch export
   - Both modes: Populate file path cache for existing entities

#### Testing Checklist (Watch for debounce issues!)
- [ ] `jsonl` mode: Deleting .md file does NOT delete entity
- [ ] `markdown` mode: Deleting .md file DOES delete entity
- [ ] `jsonl` mode: Orphaned .md files are deleted
- [ ] `markdown` mode: Orphaned .md files create entities
- [ ] No oscillation/infinite loops in either mode
- [ ] Content hash caching works in both modes
- [ ] File mtime synchronization works in both modes
- [ ] File path cache is populated on startup
- [ ] File path cache is updated on sync success

---

### Phase 2: Sync Commands
**Status:** Complete

Update CLI sync commands to respect config.

#### Files Modified
- [x] `cli/src/cli/sync-commands.ts` - Updated `determineSyncDirection()`
  - Added imports for `getConfig` and `isMarkdownFirst`
  - Check `sourceOfTruth` config at start of function
  - If markdown-first, always return `from-markdown` direction
  - Otherwise use existing timestamp-based logic

#### Testing Checklist
- [ ] `sudocode sync` uses correct direction based on config
- [ ] `sudocode sync --from-markdown` forces markdown → DB
- [ ] `sudocode sync --to-markdown` forces DB → markdown

---

### Phase 3: Entity Operations
**Status:** Complete (No Changes Needed)

The existing create/delete flows work for both modes. The watcher handles the behavioral differences:
- In markdown-first mode, deleting a .md file triggers entity deletion via watcher
- CLI commands work the same way in both modes

#### Files Modified
- None (watcher handles behavioral differences)

#### Testing Checklist
- [ ] CLI create works in both modes
- [ ] CLI delete works in both modes
- [ ] Manual file deletion handled by watcher in markdown-first mode

---

### Phase 4: Import/Export Changes
**Status:** Complete

Added warning for JSONL import when markdown is source of truth.

#### Files Modified
- [x] `cli/src/import.ts` - Added warning when importing in markdown-first mode
  - Import still works (useful for initial setup/recovery)
  - Warns user that markdown should be authoritative

#### Testing Checklist
- [ ] JSONL import warns in markdown-first mode
- [ ] JSONL import still works (doesn't block)
- [ ] JSONL export works in both modes

---

### Phase 5: CLI Commands
**Status:** Complete

Add CLI commands for config and sync.

#### Files Modified
- [x] `cli/src/cli/config-commands.ts` - Created with `config get/set/show` commands
- [x] `cli/src/cli.ts` - Added config command imports and definitions

#### Key Changes Implemented
1. `sudocode config get [key]` - Get config value or show all
2. `sudocode config set <key> <value>` - Set config value with validation
3. `sudocode config show` - Show current source of truth info

#### Testing Checklist
- [x] `sudocode config set sourceOfTruth markdown` works
- [x] `sudocode config get sourceOfTruth` works
- [x] Invalid values are rejected with helpful error messages

---

### Phase 6: Server Changes
**Status:** Complete

Update server export service for config awareness.

#### Files Modified
- [x] `server/src/services/export.ts` - Added config imports and logging

#### Key Changes Implemented
1. Import `getConfig` and `isMarkdownFirst` from CLI
2. Added documentation explaining behavior in both modes
3. Added logging when markdown is source of truth

#### Testing Checklist
- [x] Server builds successfully with config imports
- [x] JSONL export happens in both modes (for git tracking)

---

### Phase 7: Documentation
**Status:** Complete

#### Files Updated
- [x] `.claude/CLAUDE.md` - Updated storage section, config section, quick reference
  - Added source of truth configuration explanation
  - Documented config split (config.json vs config.local.json)
  - Added config CLI commands reference
  - Updated storage layout

#### Remaining (future work)
- [ ] `docs/storage.md` - Document both modes in detail
- [ ] `README.md` - Add configuration section

---

### Phase 8: Tests
**Status:** Complete (existing tests pass)

#### Test Files
- [x] `cli/tests/unit/config.test.ts` - 18 tests for config split (all passing)
  - getConfig, getProjectConfig, getLocalConfig
  - updateProjectConfig, updateLocalConfig, updateConfig
  - migrateConfigIfNeeded
  - isMarkdownFirst

#### Remaining (future work)
- [ ] `cli/tests/unit/watcher.test.ts` - Test both modes (needs watcher mock)
- [ ] `cli/tests/integration/markdown-first.test.ts` - End-to-end tests

---

## Known Challenges

### Debouncing / Oscillation Prevention

The watcher uses multiple strategies to prevent infinite loops:

1. **Content hash caching** - SHA256 per file, skip if unchanged
2. **Canonical content hash** - For JSONL, ignores timestamps
3. **Async mutex** - Serializes file processing
4. **Files-being-processed guard** - Tracks active processing

When implementing markdown-first mode, ensure:
- Content hash is updated AFTER writing derived files
- Mutex is held during the full sync cycle
- No race conditions between markdown → DB → JSONL → markdown

### Git Merge Conflicts

JSONL is optimized for line-based merges (one entity per line, sorted by `created_at`). Markdown files may have more complex merge conflicts. Consider:
- How to detect/handle markdown conflicts
- Whether to auto-resolve or require manual intervention

---

## Progress Log

| Date | Phase | Status | Notes |
|------|-------|--------|-------|
| 2026-02-02 | Spec | Complete | Initial spec created |
| 2026-02-02 | Plan | Complete | Implementation plan created |
| 2026-02-02 | Phase 0 | Complete | Config split (config.json + config.local.json) |
| 2026-02-02 | Phase 1 | Complete | Watcher logic changes |
| 2026-02-02 | Phase 2 | Complete | Sync commands |
| 2026-02-02 | Phase 3 | Complete | Entity operations (no changes needed) |
| 2026-02-02 | Phase 4 | Complete | Import/export changes |
| 2026-02-03 | Phase 5 | Complete | CLI config commands |
| 2026-02-03 | Phase 6 | Complete | Server config awareness |
| 2026-02-03 | Phase 7 | Complete | Documentation (CLAUDE.md updated) |
| 2026-02-03 | Phase 8 | Complete | Existing config tests pass (18 tests) |
