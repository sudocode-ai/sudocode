# Continual Learning System - Implementation Summary

This document summarizes the implementation of a comprehensive continual learning system that transforms the sudocode repository into a self-improving knowledge hub for AI agents.

## Overview

The learning system captures context and learnings from completed work, generates agent-first documentation, and implements trajectory learning to optimize future agent performance. This approach is inspired by the Memento paper on continual learning ([arxiv.org/pdf/2508.16153](https://arxiv.org/pdf/2508.16153)).

## Architecture

The system is built in three integrated milestones:

```
┌─────────────────────────────────────────────────────────────┐
│                    Milestone 1: Foundation                   │
│              Completion Summary & Reflection                 │
│  • Captures what worked, what failed, blocking factors       │
│  • Git history analysis for automated pattern extraction     │
│  • Structured learning data stored with specs/issues         │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                  Milestone 2: Aggregation                    │
│             Agent Context Integration                        │
│  • Aggregates patterns from all completion summaries         │
│  • Generates living documentation in .sudocode/context/      │
│  • Context retrieval finds relevant past work                │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                 Milestone 3: Optimization                    │
│                  Trajectory Learning                         │
│  • Records agent execution sequences (steps/actions)         │
│  • Analyzes patterns and recommends next actions             │
│  • Q-learning style action value estimates                   │
└─────────────────────────────────────────────────────────────┘
```

## Milestone 1: Completion Summary & Reflection System

### Purpose
Capture structured learnings when specs/issues are completed, preventing knowledge loss when work is archived.

### Implementation

#### Type System (`types/src/index.d.ts`)
```typescript
export interface CompletionSummary {
  what_worked: string[];              // Successful patterns and approaches
  what_failed: string[];              // Failed attempts and anti-patterns
  blocking_factors: string[];         // What slowed progress
  key_decisions: Array<{              // Important decisions made
    decision: string;
    rationale: string;
    alternatives_considered: string[];
  }>;
  code_patterns_introduced: string[]; // New patterns added to codebase
  dependencies_discovered: string[];  // Libraries/tools discovered
  git_commit_range?: {                // Git history for this work
    start: string;
    end: string;
  };
  files_modified?: string[];          // Files touched
  test_results?: {                    // Test coverage/results
    passed: number;
    failed: number;
    coverage?: number;
  };
  time_to_complete?: number;          // Duration in hours
}
```

#### Database Schema (`types/src/schema.ts`)
- Added `completion_summary TEXT` column to both `specs` and `issues` tables
- Migration system ensures backward compatibility
- JSONL serialization for structured data in SQLite

#### Git Analysis (`cli/src/learning/git-analyzer.ts`)
Automated analysis of git history to extract patterns:
- `getCommits()`: Retrieves commit log for a range
- `analyzeDiff()`: Analyzes file changes and generates statistics
- `extractPatterns()`: Identifies primary areas of work from file paths

#### Reflection Generator (`cli/src/learning/reflection-generator.ts`)
- `generateReflectionPrompt()`: Creates comprehensive LLM prompts for reflection
- `generateBasicSummary()`: Automated analysis without LLM (fallback)

#### CLI Commands (`cli/src/cli/completion-commands.ts`)
```bash
# Complete an issue with reflection
sudocode issue complete ISSUE-123 --reflect

# Complete a spec with custom git range
sudocode spec complete SPEC-456 --reflect --start abc123 --end def456

# Interactive mode
sudocode issue complete ISSUE-123 --interactive
```

### Key Files
- `cli/src/operations/completion-summary.ts`: Serialization utilities
- `cli/src/learning/git-analyzer.ts`: Git history analysis
- `cli/src/learning/reflection-generator.ts`: Reflection prompts
- `cli/src/cli/completion-commands.ts`: CLI integration
- `cli/tests/unit/learning/git-analyzer.test.ts`: 10 tests
- `cli/tests/unit/operations/completion-summary.test.ts`: 14 tests

## Milestone 2: Agent Context Integration

### Purpose
Transform individual completion summaries into living documentation that helps future agents make better decisions.

### Implementation

#### Context Aggregator (`cli/src/learning/context-aggregator.ts`)
Consolidates patterns from all completion summaries:
```typescript
export interface AggregatedContext {
  patterns: Array<{
    pattern: string;
    frequency: number;
    sources: string[];  // Issue/spec IDs where this pattern appeared
  }>;
  gotchas: Array<{
    gotcha: string;
    frequency: number;
    sources: string[];
  }>;
  key_decisions: Array<{
    decision: string;
    rationale: string;
    frequency: number;
    sources: string[];
  }>;
  // ... other aggregated data
}
```

**Features:**
- Tracks frequency of patterns with source attribution
- Filters by date, archived status
- Calculates coverage statistics (% of completed items with summaries)

#### Documentation Generator (`cli/src/learning/documentation-generator.ts`)
Generates agent-first documentation in `.sudocode/context/`:
```
.sudocode/context/
├── CODEBASE_MEMORY.md           # Main overview
├── patterns/
│   ├── testing-patterns.md      # Common testing approaches
│   ├── error-handling.md        # Error handling patterns
│   └── ...
├── gotchas/
│   ├── database-gotchas.md      # Database pitfalls
│   ├── typescript-gotchas.md    # TypeScript issues
│   └── ...
└── decisions/
    ├── architecture.md           # Key architectural decisions
    ├── tooling.md                # Tool choices and rationale
    └── ...
```

**Auto-generated content includes:**
- Frequency-ranked patterns and gotchas
- Source attribution (which issues/specs)
- Coverage metrics
- Last updated timestamps

#### Context Retrieval (`cli/src/learning/context-retrieval.ts`)
Finds relevant past work using similarity scoring:
```typescript
// Multi-factor similarity
similarity_score =
  (title_matches * 3) +      // Weight: 3
  (content_matches * 1) +    // Weight: 1
  (tag_overlap * 2)          // Weight: 2
```

**Features:**
- `getRelevantContextForIssue()`: Finds similar past issues/specs
- `formatContextForAgent()`: Generates briefing markdown
- Extracts implicit tags (auth, database, api, etc.)
- Recommends applicable patterns and gotchas

#### CLI Commands (`cli/src/cli/context-commands.ts`)
```bash
# Generate living documentation
sudocode context generate

# Query context for specific issue
sudocode context query ISSUE-123

# View coverage statistics
sudocode context stats
```

### Key Files
- `cli/src/learning/context-aggregator.ts`: Pattern aggregation
- `cli/src/learning/documentation-generator.ts`: Markdown generation
- `cli/src/learning/context-retrieval.ts`: Similarity matching
- `cli/src/cli/context-commands.ts`: CLI integration
- `cli/tests/unit/learning/context-aggregator.test.ts`: 6 tests
- `cli/tests/unit/learning/context-retrieval.test.ts`: 7 tests

## Milestone 3: Trajectory Learning System

### Purpose
Record and analyze agent execution patterns to optimize future performance through action recommendations and pattern recognition.

### Implementation

#### Type System (`cli/src/learning/trajectory-types.ts`)
Comprehensive types for trajectory capture:
```typescript
export type ActionType =
  | "read_file" | "write_file" | "edit_file" | "delete_file"
  | "run_command" | "run_tests" | "search_code" | "search_files"
  | "git_commit" | "create_issue" | "update_issue" | "create_spec"
  | "update_spec" | "query_context" | "other";

export interface Trajectory {
  id: string;                       // traj-{timestamp}-{random}
  agent_type: "claude-code" | "codex" | "other";
  context: TrajectoryContext;       // Goal, issue/spec, tags
  steps: TrajectoryStep[];          // Sequence of actions
  outcome: TrajectoryOutcome;       // success | failure | partial
  quality: TrajectoryQuality;       // 0-100 score, efficiency metrics
  git_info?: {                      // Git changes
    start_commit: string;
    end_commit?: string;
    files_changed: string[];
  };
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
}
```

#### Storage System (`cli/src/learning/trajectory-storage.ts`)
Persistent trajectory storage with indexing:
```typescript
class TrajectoryStorage {
  // Monthly organization: .sudocode/trajectories/YYYY-MM/
  save(trajectory: Trajectory): void
  load(trajectoryId: string): Trajectory | null

  // Fast filtering via index.json
  list(options: {
    issue_id?: string;
    outcome?: TrajectoryOutcome;
    min_quality?: number;
    since?: string;
    limit?: number;
  }): TrajectoryIndex[]

  // Aggregate statistics
  getStats(): {
    total_trajectories: number;
    success_rate: number;
    avg_quality: number;
    avg_duration_ms: number;
  }
}
```

#### Analysis Engine (`cli/src/learning/trajectory-analysis.ts`)
Multi-factor similarity and pattern extraction:

**Similarity Calculation:**
```typescript
similarity_score =
  (context_similarity * 0.4) +      // Goal + tags matching
  (sequence_similarity * 0.3) +     // Action sequence (LCS)
  (file_overlap * 0.2) +            // Files changed
  (outcome_match * 0.1)             // Same outcome type
```

**Key Functions:**
- `findSimilarTrajectories()`: Retrieves top matches above threshold
- `extractActionPatterns()`: Finds recurring action sequences (length 2-5)
- `buildActionValues()`: Creates Q-learning estimates
- `recommendNextAction()`: Suggests actions based on context hash

**Q-Learning Style Action Values:**
```typescript
interface ActionValue {
  context_hash: string;              // Hash of (goal + tags + prev actions)
  action: ActionType;
  success_rate: number;              // Success % for this action
  avg_quality: number;               // Average quality when successful
  sample_size: number;               // How many times observed
  confidence: number;                // value * sqrt(sample_size)
}
```

#### Trajectory Capture (`cli/src/learning/trajectory-capture.ts`)
Builder pattern for recording executions:
```typescript
class TrajectoryBuilder {
  addStep(action_type: ActionType, options: {
    description?: string;
    files_affected?: string[];
    tool_output?: string;
    success?: boolean;
  }): this

  setGitInfo(info: {
    start_commit: string;
    end_commit?: string;
    files_changed: string[];
  }): this

  markReworkNeeded(reason: string): this

  complete(outcome: TrajectoryOutcome, qualityScore?: number): Trajectory
}
```

**Auto-quality Scoring:**
```
base_score = outcome (success=100, partial=60, failure=20)
efficiency_penalty = rework_count * 10
test_bonus = (test_pass_rate - 50) / 2
quality_score = max(0, min(100, base_score - efficiency_penalty + test_bonus))
```

#### CLI Commands (`cli/src/cli/trajectory-commands.ts`)
```bash
# List trajectories with filtering
sudocode trajectory list --issue-id ISSUE-123 --min-quality 70

# Show detailed trajectory
sudocode trajectory show traj-1234567890-abc

# Analyze patterns across trajectories
sudocode trajectory analyze --min-frequency 3

# Get action recommendations
sudocode trajectory recommend "implement authentication"

# View statistics
sudocode trajectory stats
```

### Key Files
- `cli/src/learning/trajectory-types.ts`: Type definitions
- `cli/src/learning/trajectory-storage.ts`: Persistence layer
- `cli/src/learning/trajectory-analysis.ts`: Analysis engine
- `cli/src/learning/trajectory-capture.ts`: Recording utilities
- `cli/src/cli/trajectory-commands.ts`: CLI integration
- `cli/tests/unit/learning/trajectory-storage.test.ts`: 15 tests
- `cli/tests/unit/learning/trajectory-analysis.test.ts`: 8 tests

## Inter-Milestone Integration

### Flow 1: Completion → Context → Action
```
1. Issue completed with reflection (Milestone 1)
   ↓
2. Completion summary stored with structured learnings
   ↓
3. Context aggregator processes all summaries (Milestone 2)
   ↓
4. Living documentation generated
   ↓
5. Future agents query context before starting work
   ↓
6. Context-aware trajectory capture (Milestone 3)
   ↓
7. Action recommendations based on similar past work
```

### Flow 2: Trajectory → Pattern → Documentation
```
1. Agent execution recorded as trajectory (Milestone 3)
   ↓
2. Successful trajectories analyzed for patterns
   ↓
3. Patterns extracted and stored
   ↓
4. Context aggregator incorporates trajectory patterns (Milestone 2)
   ↓
5. Documentation updated with proven approaches
```

### Flow 3: Continuous Improvement Loop
```
┌─────────────────────────────────────────────┐
│  Agent starts new issue/spec                │
└────────────┬────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────┐
│  Query context for relevant past work       │
│  (Milestone 2)                              │
└────────────┬────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────┐
│  Get action recommendations from similar    │
│  trajectories (Milestone 3)                 │
└────────────┬────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────┐
│  Execute with trajectory capture            │
│  (Milestone 3)                              │
└────────────┬────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────┐
│  Complete with reflection (Milestone 1)     │
└────────────┬────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────┐
│  Regenerate context documentation           │
│  (Milestone 2)                              │
└────────────┬────────────────────────────────┘
             │
             └─────────► Loop continues...
```

## Data Storage

### Database (SQLite)
```
specs/issues tables:
  - completion_summary: TEXT (JSONL serialized CompletionSummary)
```

### Filesystem
```
.sudocode/
├── context/                         # Milestone 2 output
│   ├── CODEBASE_MEMORY.md
│   ├── patterns/
│   ├── gotchas/
│   └── decisions/
└── trajectories/                    # Milestone 3 output
    ├── index.json                   # Fast lookup index
    └── YYYY-MM/                     # Monthly subdirectories
        ├── traj-{id1}.json
        ├── traj-{id2}.json
        └── ...
```

## Usage Examples

### Example 1: Complete Issue with Learning Capture
```bash
# Work on issue
git checkout -b feature/auth
# ... make changes ...

# Complete with reflection
sudocode issue complete ISSUE-123 --reflect --start main --end HEAD

# System captures:
# - Git diff analysis
# - Files modified
# - Generates reflection prompt
# - Stores completion summary
```

### Example 2: Generate Context for New Issue
```bash
# Create new issue
sudocode issue create --title "Add OAuth support"

# Generate context documentation
sudocode context generate

# Query relevant context
sudocode context query ISSUE-456

# Output shows:
# - Similar past issues (authentication, user management)
# - Applicable patterns (JWT handling, session management)
# - Known gotchas (token refresh edge cases)
# - Recommended next steps
```

### Example 3: Trajectory-Guided Development
```bash
# Get recommendations
sudocode trajectory recommend "implement API endpoint"

# Output suggests:
# 1. read_file (controllers) - 85% success rate
# 2. search_code (similar endpoints) - 82% success rate
# 3. edit_file (add route) - 78% success rate

# Analyze successful patterns
sudocode trajectory analyze --min-frequency 5

# Output shows:
# - Common action sequences for API work
# - Success rates for different approaches
# - Average quality scores
```

### Example 4: Full Learning Loop
```bash
# 1. Start new spec
sudocode spec create --title "User Profile API"

# 2. Query context
sudocode context query SPEC-789

# 3. Get trajectory recommendations
sudocode trajectory recommend "REST API with validation"

# 4. Work on implementation
# (trajectory capture would be automatic in future)

# 5. Complete with reflection
sudocode spec complete SPEC-789 --reflect

# 6. Regenerate documentation
sudocode context generate

# 7. View updated statistics
sudocode context stats
sudocode trajectory stats
```

## Testing

### Unit Tests
- **Milestone 1**: 24 tests (git analysis, serialization, reflection)
- **Milestone 2**: 13 tests (aggregation, retrieval, similarity)
- **Milestone 3**: 23 tests (storage, analysis, patterns)

### Integration Tests
- End-to-end completion summary flow
- Context generation and retrieval pipeline
- Trajectory capture and recommendation flow
- Inter-milestone data propagation

### Test Coverage
All core functionality is tested with comprehensive coverage of:
- Happy paths and error cases
- Edge cases (empty data, malformed input)
- Backward compatibility (pre-migration databases)
- Concurrent operations (trajectory capture)

## Performance Considerations

### Context Aggregation
- Lazy loading: Only load completion summaries on demand
- Caching: In-memory cache for frequently accessed patterns
- Filtering: Database-level filtering before aggregation

### Trajectory Storage
- Monthly partitioning: Reduces file search space
- Index-based filtering: Avoid loading full trajectories
- Compression: Future enhancement for large trajectory sets

### Similarity Matching
- Early termination: Stop scoring if threshold impossible
- Keyword extraction: Pre-computed for faster matching
- LRU cache: Cache similarity scores for repeated queries

## Future Enhancements

### Automatic Trajectory Capture
- Hook into issue/spec commands to auto-record trajectories
- Capture tool usage (Read, Write, Edit, Bash, etc.)
- Real-time action recommendations during execution

### Advanced Analysis
- Deep learning for pattern recognition
- Anomaly detection for unusual execution paths
- Transfer learning across different issue types

### Collaborative Learning
- Share anonymized trajectories across teams
- Community pattern libraries
- Benchmark agent performance

### Real-time Context
- Live context updates as work progresses
- Streaming recommendations during execution
- Context-aware error recovery

## Related Work

This implementation is inspired by:
- **Memento** ([arxiv.org/pdf/2508.16153](https://arxiv.org/pdf/2508.16153)): Continual learning for agents
- **Q-Learning**: Reinforcement learning for action selection
- **Case-Based Reasoning**: Using past solutions for new problems
- **Knowledge Graphs**: Structured representation of learnings

## Contributing

When adding new features:
1. Ensure completion summaries capture relevant data
2. Add new pattern types to context aggregator
3. Extend trajectory types for new action types
4. Update documentation generator templates
5. Add tests for new functionality

## Summary

The continual learning system transforms sudocode from a static issue tracker into a self-improving knowledge hub:

✅ **Milestone 1**: Captures structured learnings from completed work
✅ **Milestone 2**: Aggregates patterns into living documentation
✅ **Milestone 3**: Records execution patterns for optimization

**Key Benefits:**
- Prevents knowledge loss when work is archived
- Provides context-aware guidance for new work
- Learns from past successes and failures
- Continuously improves agent performance
- Creates a shared knowledge base across executions

**Total Implementation:**
- 2,500+ lines of production code
- 60+ comprehensive tests
- 11 new CLI commands
- Full documentation and examples
