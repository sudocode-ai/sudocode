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
**Status:** Not Started

Update CLI sync commands to respect config.

#### Files to Modify
- [ ] `cli/src/cli/sync-commands.ts` - Update `determineSyncDirection()`

#### Testing Checklist
- [ ] `sudocode sync` uses correct direction based on config
- [ ] `sudocode sync --from-markdown` forces markdown → DB
- [ ] `sudocode sync --to-markdown` forces DB → markdown

---

### Phase 3: Entity Operations
**Status:** Not Started

Update create/delete flows for entities.

#### Files to Modify
- [ ] `cli/src/cli/spec-commands.ts` - Update create/delete flow
- [ ] `cli/src/cli/issue-commands.ts` - Update create/delete flow

#### Testing Checklist
- [ ] `markdown` mode: Creating spec writes .md first
- [ ] `markdown` mode: Deleting spec deletes .md first
- [ ] `jsonl` mode: Current behavior preserved

---

### Phase 4: Import/Export Changes
**Status:** Not Started

Add `rebuildFromMarkdown()` and update import logic.

#### Files to Modify
- [ ] `cli/src/import.ts` - Add `rebuildFromMarkdown()`, skip import in markdown mode
- [ ] `cli/src/export.ts` - Config awareness

#### Testing Checklist
- [ ] `rebuildFromMarkdown()` correctly rebuilds DB from .md files
- [ ] JSONL import warns/skips in markdown mode
- [ ] JSONL export still works in both modes

---

### Phase 5: CLI Commands
**Status:** Not Started

Add CLI commands for config and sync.

#### Files to Modify
- [ ] `cli/src/cli/config-commands.ts` - Add `config set/get sourceOfTruth`

#### Testing Checklist
- [ ] `sudocode config set sourceOfTruth markdown` works
- [ ] `sudocode config get sourceOfTruth` works

---

### Phase 6: Server Changes
**Status:** Not Started

Update server export service.

#### Files to Modify
- [ ] `server/src/services/export.ts` - Config awareness

#### Testing Checklist
- [ ] Server respects `sourceOfTruth` setting
- [ ] API changes sync correctly in both modes

---

### Phase 7: Documentation
**Status:** Not Started

#### Files to Update
- [ ] `.claude/CLAUDE.md` - Update architecture diagram
- [ ] `docs/storage.md` - Document both modes
- [ ] `README.md` - Add configuration section

---

### Phase 8: Tests
**Status:** Not Started

#### Test Files to Update/Create
- [ ] `cli/tests/unit/config.test.ts` - Test config split
- [ ] `cli/tests/unit/watcher.test.ts` - Test both modes
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
