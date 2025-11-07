# Cross-Repo Federation: Outstanding Decisions

This document outlines the critical decisions that must be made before implementing cross-repository federation. Each decision includes options, trade-offs, and recommendations.

**Last Updated**: 2025-11-07
**Status**: Awaiting decisions

---

## 🔴 Critical Decisions (Block MVP)

These decisions must be made before starting Phase 1 implementation.

### D1. Transport and Protocol Strategy

**Question**: Which transport mechanism(s) should we implement first?

**Options**:

#### Option A: HTTP-Only (Recommended for MVP)
```
Phase 1: REST API only
Phase 2: Add WebSocket
Phase 3: Add git-native transport
```

**Pros**:
- Fastest to implement (reuse Express server)
- Familiar to developers (standard REST patterns)
- Good debugging tools (curl, Postman, browser DevTools)
- Works with existing MCP infrastructure

**Cons**:
- Requires running server (not pure git-native)
- Network dependency for all operations
- No offline capability initially

#### Option B: Git-Native First
```
Phase 1: Git notes/refs for cross-repo data
Phase 2: Add HTTP for real-time queries
```

**Pros**:
- Truly distributed, no server required
- Works offline
- Leverages git's existing sync mechanisms
- Pure philosophy alignment

**Cons**:
- Slower to implement (custom git plumbing)
- Less intuitive for developers unfamiliar with git internals
- Harder to debug
- No real-time updates without polling

#### Option C: Hybrid from Day 1
```
Phase 1: Both HTTP and git-native
```

**Pros**:
- Best of both worlds
- Flexibility for different use cases

**Cons**:
- Double the implementation effort
- Two code paths to maintain
- Complexity in keeping them in sync

**Recommendation**: **Option A** - HTTP-only for MVP (Phase 1-2), add git-native in Phase 3 as optimization

**Decision Needed**: [ ] Approved [ ] Modified: ___________

---

### D2. Canonical Identity Format

**Question**: How do we represent cross-repo entity references?

**Options**:

#### Option A: GitHub-Style (Recommended)
```
org/repo#issue-042
sudocode-ai/sudocode#spec-015
```

**Pros**:
- Familiar to GitHub users
- Compact and readable
- Easy to parse

**Cons**:
- Assumes GitHub-like structure
- What about self-hosted or other platforms?

#### Option B: Full URL
```
github.com/org/repo#issue-042
gitlab.com/org/repo#spec-015
git.company.com/team/repo#issue-001
```

**Pros**:
- Unambiguous (includes host)
- Supports multiple git platforms
- Future-proof

**Cons**:
- Longer, less readable
- Verbose in markdown

#### Option C: UUID-Only
```
550e8400-e29b-41d4-a716-446655440000
```

**Pros**:
- Globally unique
- Platform-agnostic
- No collision risk

**Cons**:
- Not human-readable
- Requires lookup to understand what it references
- Markdown full of UUIDs is unreadable

#### Option D: Hybrid (Recommended)
```
# In markdown (human-readable)
[[org/repo#issue-042]]

# In database/API (canonical)
{
  "display_ref": "org/repo#issue-042",
  "canonical_uuid": "550e8400-...",
  "repo_url": "github.com/org/repo"
}
```

**Pros**:
- Human-friendly in markdown
- Machine-friendly in DB/API
- Best of all worlds

**Cons**:
- Need to resolve display_ref → canonical data
- Resolution can fail if remote unreachable

**Recommendation**: **Option D** - Display refs in markdown, UUIDs for canonical identity

**Decision Needed**: [ ] Approved [ ] Modified: ___________

---

### D3. Trust Model Defaults

**Question**: What's the default trust level for newly added remote repos?

**Options**:

#### Option A: Untrusted by Default (Recommended)
```
New remote repos start as "untrusted"
User must explicitly upgrade to "verified" or "trusted"
```

**Pros**:
- Secure by default
- Prevents accidental data exposure
- Forces explicit security thinking

**Cons**:
- More friction for internal repos
- Requires manual upgrade step

#### Option B: Verified by Default
```
New repos start as "verified" (read + manual-approve mutations)
```

**Pros**:
- Better UX for trusted environments
- Fewer steps to get started

**Cons**:
- Less secure
- Wrong default for public/open repos

#### Option C: Context-Aware Defaults
```
- Same org/company → "verified"
- External → "untrusted"
```

**Pros**:
- Smart defaults based on context
- Balances security and UX

**Cons**:
- Need to detect "same org" (how?)
- Complexity in heuristics

**Recommendation**: **Option A** - Untrusted by default, with easy upgrade path

**Decision Needed**: [ ] Approved [ ] Modified: ___________

---

### D4. Approval Workflow Interface

**Question**: Where do users approve/reject incoming cross-repo requests?

**Options**:

#### Option A: CLI-First
```bash
$ sudocode requests pending
$ sudocode request approve req-abc123
$ sudocode request reject req-abc123 --reason "Out of scope"
```

**Pros**:
- Consistent with current sudocode CLI-first design
- Scriptable/automatable
- Works in SSH/terminal-only environments

**Cons**:
- Not as user-friendly for non-technical users
- Requires context switching from web UI

#### Option B: Web UI-First
```
Dashboard → Pending Requests → [Approve] [Reject]
Email notifications with approval links
```

**Pros**:
- Better UX for most users
- Rich context display (show full issue details, diff, etc.)
- Notifications can link directly

**Cons**:
- Requires web UI implementation (more work)
- Not scriptable without API calls

#### Option C: Both (Recommended)
```
CLI for power users / automation
Web UI for interactive review
Both operate on same data
```

**Pros**:
- Best of both worlds
- Users choose their preference

**Cons**:
- Double implementation effort
- Need to keep UX consistent

**Recommendation**: **Option C** - Implement CLI first (Phase 1), add web UI (Phase 2)

**Decision Needed**: [ ] Approved [ ] Modified: ___________

---

### D5. Sync Strategy

**Question**: How do we keep cached remote data fresh?

**Options**:

#### Option A: On-Demand (Pull)
```
Data fetched when user views cross-repo ref
Cache for N minutes, then refetch on next view
```

**Pros**:
- Simple implementation
- No background jobs needed
- Only fetch what's actually used

**Cons**:
- Slower UX (loading spinner when viewing)
- Stale data between fetches

#### Option B: Background Sync (Push-like)
```
Background worker polls remote repos every N minutes
Updates cache proactively
User always sees cached data (fast)
```

**Pros**:
- Fast UX (data always cached)
- Can detect changes proactively

**Cons**:
- Need background job infrastructure
- Wastes bandwidth fetching unused data

#### Option C: Webhook-Based (Push)
```
Remote repo sends webhook when data changes
Update cache immediately
```

**Pros**:
- Real-time updates
- Efficient (only update when needed)

**Cons**:
- Requires webhook setup
- Firewall/networking complexity
- Not all repos support webhooks

#### Option D: Hybrid (Recommended)
```
- On-demand fetch on first view (cache miss)
- Background refresh for "watched" entities
- Webhooks for real-time when available
```

**Pros**:
- Flexible, adapts to context
- Fast for hot data, efficient for cold data

**Cons**:
- Most complex to implement
- Multiple code paths

**Recommendation**: **Option A for Phase 1** (simplest), **Option D for Phase 3** (optimize)

**Decision Needed**: [ ] Approved [ ] Modified: ___________

---

## 🟡 Important Decisions (Affect API Design)

These should be decided before API implementation begins.

### D6. A2A Protocol Scope

**Question**: Which A2A message types should we implement in Phase 1?

**Options**:

#### Option A: Minimal (Discover + Query)
```
Phase 1: discover, query (read-only)
Phase 2: mutate
Phase 3: subscribe, delegate
```

**Pros**:
- Smallest scope for Phase 1
- Low risk (no mutations)
- Validate concept before complexity

**Cons**:
- Limited usefulness (can't create remote issues yet)
- Might need to redesign when adding mutate

#### Option B: Core Set (Discover + Query + Mutate)
```
Phase 1: discover, query, mutate
Phase 2: subscribe, delegate
```

**Pros**:
- Useful immediately (can create remote issues)
- Most common use case covered

**Cons**:
- Larger scope
- Need approval workflow in Phase 1

#### Option C: All at Once
```
Phase 1: All 5 message types
```

**Pros**:
- Complete from day 1
- No incremental API changes

**Cons**:
- Too much scope
- Higher risk

**Recommendation**: **Option B** - Discover + Query + Mutate in Phase 1

**Decision Needed**: [ ] Approved [ ] Modified: ___________

---

### D7. API Authentication

**Question**: Which authentication methods should we support?

**Options**:

#### Option A: Bearer Tokens Only (Recommended for MVP)
```
Authorization: Bearer <token>
```

**Pros**:
- Simple to implement
- Standard, well-understood
- Works with curl, Postman, etc.

**Cons**:
- Need token management/rotation
- No built-in expiry (unless JWT)

#### Option B: API Keys
```
X-API-Key: <key>
```

**Pros**:
- Even simpler than bearer
- Easy to generate/revoke

**Cons**:
- Less standard
- No scoping/permissions in key itself

#### Option C: OAuth 2.0
```
Full OAuth flow with refresh tokens
```

**Pros**:
- Industry standard for delegated access
- Built-in expiry and refresh
- Scoped permissions

**Cons**:
- Complex to implement
- Overkill for MVP

#### Option D: Mutual TLS
```
Client certificates for authentication
```

**Pros**:
- Most secure
- No tokens to steal

**Cons**:
- Complex setup
- Certificate management burden

**Recommendation**: **Option A for Phase 1** (Bearer tokens), **Add OAuth in Phase 3** (enterprise)

**Decision Needed**: [ ] Approved [ ] Modified: ___________

---

### D8. API Versioning Strategy

**Question**: How do we version the federation API?

**Options**:

#### Option A: URL-Based
```
/api/v1/federation/query
/api/v2/federation/query
```

**Pros**:
- Clear, explicit
- Easy to route different versions to different handlers

**Cons**:
- URL clutter
- Need to maintain multiple endpoints

#### Option B: Header-Based
```
Accept: application/vnd.sudocode.v1+json
```

**Pros**:
- Clean URLs
- Standard REST practice

**Cons**:
- Less discoverable
- Harder to test (need to set headers)

#### Option C: No Versioning Initially
```
/api/federation/query
Add versioning when we have breaking changes
```

**Pros**:
- Simplest for MVP
- YAGNI principle

**Cons**:
- Harder to add later
- Forces careful API design up front

**Recommendation**: **Option A** - Start with `/api/v1/` from day 1 (easier to add v2 later)

**Decision Needed**: [ ] Approved [ ] Modified: ___________

---

### D9. Error Handling Format

**Question**: What error format should the API use?

**Options**:

#### Option A: RFC 7807 (Problem Details)
```json
{
  "type": "https://sudocode.dev/errors/permission-denied",
  "title": "Permission Denied",
  "status": 403,
  "detail": "Remote repo 'org/repo' does not allow mutations from your repo",
  "instance": "/api/v1/federation/mutate",
  "request_id": "req-abc123"
}
```

**Pros**:
- Standard format (RFC 7807)
- Rich error details
- Machine-parseable

**Cons**:
- More verbose
- Need to maintain error documentation

#### Option B: Simple Format
```json
{
  "error": "Permission denied",
  "message": "Remote repo 'org/repo' does not allow mutations",
  "code": "PERMISSION_DENIED"
}
```

**Pros**:
- Simple and concise
- Easy to understand

**Cons**:
- Less structured
- Harder to handle programmatically

**Recommendation**: **Option A** - Use RFC 7807 for consistency with best practices

**Decision Needed**: [ ] Approved [ ] Modified: ___________

---

## 🟢 Deferred Decisions (Can Decide During Implementation)

These can be decided later without blocking progress.

### D10. Cache Eviction Policy

**Options**: LRU, LFU, TTL-only, Adaptive

**Recommendation**: Start with simple TTL, optimize later based on metrics

**Timeline**: Can decide in Phase 2

---

### D11. Rate Limit Defaults

**Options**:
- Conservative (10 req/min)
- Moderate (60 req/min) ← Recommended starting point
- Aggressive (600 req/min)

**Recommendation**: Start moderate, make configurable, adjust based on usage

**Timeline**: Can decide in Phase 2

---

### D12. Notification Channels

**Options**: Email, Slack, Discord, Webhook, In-app only

**Recommendation**: In-app only for Phase 1, add Slack/email in Phase 2

**Timeline**: Can decide in Phase 2

---

### D13. Discovery Mechanism

**Question**: How do repos find each other?

**Options**:
- Manual only (user provides URL)
- DNS-based (TXT records)
- Central registry (opt-in)
- Git submodules metadata

**Recommendation**: Manual only for Phase 1, explore DNS/registry later

**Timeline**: Can defer to Phase 3+

---

### D14. Conflict Resolution Strategy

**Question**: When cached remote data conflicts with local view, which wins?

**Options**:
- Remote always wins (last-write-wins)
- Local always wins (local override)
- Manual resolution
- AI-assisted merge

**Recommendation**: Remote wins for Phase 1 (simplest), add manual/AI options in Phase 3

**Timeline**: Can decide in Phase 2

---

### D15. Subscription Delivery Guarantee

**Question**: What guarantees do we provide for webhook delivery?

**Options**:
- Best effort (fire and forget)
- At-least-once (retries with dedup)
- Exactly-once (complex, requires state)

**Recommendation**: Best effort for Phase 1, at-least-once for Phase 3

**Timeline**: Can decide in Phase 3

---

## Summary of Recommendations

### Phase 1 MVP Decisions (Must Make Now)

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| **D1. Transport** | HTTP-only | Fastest to implement, familiar |
| **D2. Identity** | Hybrid (display refs + UUIDs) | Human-friendly + machine-friendly |
| **D3. Trust Defaults** | Untrusted by default | Secure by default |
| **D4. Approval UI** | CLI first, Web UI in Phase 2 | Incremental, CLI matches sudocode philosophy |
| **D5. Sync Strategy** | On-demand (Phase 1), Hybrid (Phase 3) | Simple first, optimize later |
| **D6. A2A Scope** | Discover + Query + Mutate | Useful immediately |
| **D7. Authentication** | Bearer tokens | Standard, simple |
| **D8. API Versioning** | `/api/v1/` from day 1 | Easier to evolve |
| **D9. Error Format** | RFC 7807 | Standard, structured |

### Estimated Impact on Timeline

**If all recommendations approved**: Phase 1 remains **2-3 weeks**

**If major changes needed** (e.g., git-native first, full OAuth): Phase 1 becomes **4-6 weeks**

---

## Open Questions for Stakeholders

### Q1. Target Use Case Priority

Which use case should we optimize for first?

- [ ] Microservices (internal org, many repos)
- [ ] Open source (external repos, untrusted)
- [ ] Monorepo (logical boundaries within one repo)

**Why it matters**: Affects trust model defaults, authentication choice, discovery mechanism

---

### Q2. Server Requirements

Are users OK running a server (Express) for cross-repo to work?

- [ ] Yes, already running server for web UI
- [ ] No, must work without server (git-native only)
- [ ] Optional: server for enhanced features, fallback to git-native

**Why it matters**: Determines if we can start with HTTP-only or must do git-native

---

### Q3. Security Posture

How paranoid should we be?

- [ ] High security (untrusted default, manual approvals, audit everything)
- [ ] Balanced (verified default for same-org, auto-approve low-priority)
- [ ] Low friction (trusted default, auto-approve most things)

**Why it matters**: Affects trust model, approval workflow, default policies

---

### Q4. AI Agent Autonomy

Should AI agents be able to autonomously approve cross-repo requests?

- [ ] Yes, within policy limits (e.g., auto-approve priority >= 2)
- [ ] No, always require human approval
- [ ] Only for specific trusted repos

**Why it matters**: Core to "multiagent" vision, but has security implications

---

### Q5. Backwards Compatibility

Should we support upgrading existing sudocode installations?

- [ ] Yes, must be seamless (migration script, backward-compatible schema)
- [ ] No, fresh installs only (breaking change OK)
- [ ] Best effort (migration guide, but manual steps OK)

**Why it matters**: Affects schema design, migration complexity, testing scope

---

## Next Steps

1. **Review this document** with stakeholders
2. **Mark decisions** as [ ] Approved or [ ] Modified
3. **Answer open questions** (Q1-Q5)
4. **Create Phase 1 implementation plan** based on approved decisions
5. **Begin implementation** once all critical decisions (D1-D9) are resolved

---

## Decision Log

| Date | Decision ID | Approved By | Final Decision | Notes |
|------|-------------|-------------|----------------|-------|
| | | | | |
| | | | | |
| | | | | |

