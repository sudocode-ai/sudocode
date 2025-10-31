---
name: sudocode
description: Use when starting development sessions with issues and specs, planning multi-component features, breaking down complex work, tracking work across sessions, managing dependencies, or providing implementation feedback - spec and issue management with hierarchical organization and dependency graphs
---

# sudocode: Spec & Issue Management

Spec-driven development and issue management system. Work persists across sessions, specs guide implementation, dependency graphs ensure correct execution order, feedback loops close requirements gaps.

## Core Concepts

- **Specs**: Requirements/design documents (markdown in `.sudocode/specs/`) - user-initiated, capture intent
- **Issues**: Work items with status tracking (markdown in `.sudocode/issues/`) - agent work, actionable tasks
- **Feedback**: Anchored comments on specs documenting what happened during implementation
- **Relationships**: Dependency graphs between issues and specs (blocks, implements, parent-child, discovered-from)

**Create issues when:** Concrete actionable work, can be completed and closed, implements a spec, is a bug/task
**Create specs when:** Documenting user intent and requirements, architecture decisions, API designs, feature specifications

## Quick Reference

### Session Start (Always Do This)

```
- [ ] Use ready tool to find unblocked work
- [ ] Use list_issues with status=in_progress to see current work
- [ ] Ask user which work to pursue (if not specified)
```

### Essential Tools

```
ready                → Find unblocked work
show_issue/show_spec → Get details with relationships
upsert_issue/spec    → Create/update (status, priority, parent)
link                 → Create relationships (blocks, implements, parent-child)
add_feedback         → Document implementation results on specs
```

### Relationship Types

| Type | Purpose | Effect on ready |
|------|---------|-----------------|
| `implements` | Issue → Spec connection | None (documentation) |
| `blocks` | Execution ordering | Blocked issue not ready until blocker closes |
| `parent-child` | Hierarchical organization | None (hierarchy only) |
| `discovered-from` | Provenance tracking | None (documentation) |

### Status Flow

Standard flow:
```
open → in_progress  → closed
  ↓         ↓            ↑
  └─────────┴────────────┘
    blocked (when waiting on dependencies)
```

When requirements are not fully met or unforeseen issues arise during execution:
```
in_progress → needs_review → closed
```

## When to Use Hierarchies

**Hierarchical specs:** Multiple subsystems, multiple layers, natural abstraction levels
**Hierarchical issues:** Epic with subtasks, clear dependencies, progress tracking at different granularity

### Pattern: Hierarchical Feature with Dependencies

**Example:** "Implement authentication system"

**Create hierarchy:**
```
SPEC-001: Auth System (parent)
├── SPEC-002: OAuth (child)
├── SPEC-003: Sessions (child)
└── SPEC-004: Permissions (child)

ISSUE-001: Implement auth (parent epic, implements SPEC-001)
├── ISSUE-002: OAuth flow (child, implements SPEC-002)
├── ISSUE-003: Session storage (child, implements SPEC-003)
└── ISSUE-004: Permissions (child, implements SPEC-004)
```

**Add execution order:**
```
link: ISSUE-002 blocks ISSUE-003 (OAuth before sessions)
link: ISSUE-003 blocks ISSUE-004 (sessions before permissions)
```

**Result:** `ready` shows ISSUE-002 → close it → `ready` shows ISSUE-003 → etc.

## Dependency Graphs

**Use `blocks` for:** Execution ordering (A must finish before B starts)
**Use `parent-child` for:** Hierarchical organization (tracking progress at multiple levels)
**Use both:** Parent-child for hierarchy + blocks for ordering

### Building Dependency Graphs

```
- [ ] Identify foundation work (must happen first)
- [ ] Identify parallel work (no dependencies)
- [ ] Create all issues first (don't worry about order)
- [ ] Add parent-child for hierarchy
- [ ] Add blocks for execution order
- [ ] Verify no circular dependencies
- [ ] Use ready to verify graph correct
```

**Pattern:** Foundation blocks everything else → parallel work in middle → validation at end

---

## Feedback Loop

**Always provide feedback when implementing specs.**

### When to Provide Feedback

- Complete implementing an issue that references a spec
- Discover requirements were unclear/incomplete
- Encounter implementation challenges not in spec
- Make design decisions that deviate from spec
- Have evidence requirements were met (tests, observations)

### Feedback Checklist

```
- [ ] Update issue status
- [ ] Use add_feedback on spec with requirements met, design decisions, challenges, evidence
- [ ] Choose type: comment (informational), suggestion (spec update), request (clarification)
- [ ] Anchor feedback to relevant spec sections
```

### Feedback Pattern Example

**Good feedback:**
```
✅ Requirements met: OAuth flow working per spec
📝 Design decisions: Used Redis for tokens (horizontal scaling), added rate limiting
⚠️ Challenges: PKCE needed for mobile (not in spec), token refresh race condition solved with 10s buffer
✅ Evidence: 47 tests passing, 3 OAuth providers tested, security scan clean
💡 Suggestions: Add mobile requirements, document token refresh edge case
```

**Bad feedback:** "Implemented the feature. It works."

---

## Status Transitions

### closed vs request_review

**Close (status=closed) when:**
- All requirements met
- Tests passing with good coverage
- Confident in approach
- No blocking questions

**Set needs_review when:**
- Uncertain about approach (multiple valid options)
- Partial completion (need priority guidance)
- Quality concerns
- Spec ambiguities found
- Trade-offs need approval

**Self-check:** "Could another developer deploy this to production as-is?"
- Yes confidently → Close
- Yes with caveats → Close + flag concerns in feedback
- Need guidance → Set needs_review + request clarification
- Incomplete → Set needs_review + explain gaps

### Closing Checklist

```
- [ ] All requirements met
- [ ] Tests passing
- [ ] No blocking questions
- [ ] Implementation sound or uncertainties flagged
- [ ] Evidence provided
- [ ] Feedback on spec documenting what was done
```

If any item is ✗, set needs_review with feedback explaining gaps/questions

---

## Common Workflows

**Spec-driven feature:** Create spec → Create issues that implement spec → Add blocks dependencies to establish execution order → Use ready to find next work → Provide feedback on spec when done

**Bug discovery:** Create issue for discovered work → Link with discovered-from → If blocker: add blocks relationship + set original to blocked

**Complex hierarchical feature:** Create parent spec + child specs → Create parent issue + child issues → Link issues to specs with implements → Add parent-child + blocks relationships → Use ready to execute in order → Provide feedback on each spec

---

## Integration with TodoWrite

**Use TodoWrite for:** Session-scoped checklists, immediate execution tracking
**Use Issues for:** Multi-session work, dependencies, spec implementation

**Pattern:** Start session with ready → Create TodoWrite for immediate tasks → Update issue status as you work → Close issue when complete
