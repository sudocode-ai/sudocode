## Why

Manual setup for new changes leads to formatting mistakes and inconsistent directory structures. Developers frequently forget required files or use incorrect markdown formats.

## What Changes

- Add an `openspec scaffold <change-id>` CLI command
- Generate standard directory structure with template files
- Pre-fill common sections in proposal.md
- Create empty tasks.md with checkbox format guide

## Impact

- Affected specs: `specs/cli-scaffold`
- Affected code: `src/cli/index.ts`, `src/commands`, `docs/`
