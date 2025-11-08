# Project Agent User Guide

**Version:** 1.0 (Phase 6 Complete)
**Last Updated:** 2025-11-08

---

## Table of Contents

1. [Overview](#overview)
2. [Getting Started](#getting-started)
3. [Configuration](#configuration)
4. [Configuration Presets](#configuration-presets)
5. [Features](#features)
6. [API Reference](#api-reference)
7. [Troubleshooting](#troubleshooting)
8. [Best Practices](#best-practices)
9. [Example Workflows](#example-workflows)

---

## Overview

The Project Agent is an autonomous AI assistant that helps manage your development workflow by:

- **Planning & Coordination**: Breaking down specs into actionable issues
- **Execution Orchestration**: Starting and monitoring issue executions
- **Intelligent Monitoring**: Detecting stalled executions and suggesting interventions
- **Spec Refinement**: Reviewing specs for completeness and quality
- **Progress Reporting**: Generating project status reports and metrics

### Key Benefits

- ⏱️ **Time Savings**: Automates routine project management tasks
- 🚀 **Faster Velocity**: Identifies and executes ready issues automatically
- 🔍 **Better Quality**: Catches issues early through monitoring and review
- 🎯 **Stay Focused**: Reduces context switching and manual overhead

---

## Getting Started

### Starting the Project Agent

**Via API:**
```bash
curl -X POST http://localhost:3000/api/project-agent/start \
  -H "Content-Type: application/json" \
  -d '{"config": {"mode": "full", "autoApprove": {"enabled": true}}}'
```

**Via Frontend:**
1. Navigate to the Project Agent tab
2. Click "Start Project Agent"
3. Select your desired configuration preset
4. Click "Confirm"

### Stopping the Project Agent

**Via API:**
```bash
curl -X POST http://localhost:3000/api/project-agent/stop
```

**Via Frontend:**
1. Open the Project Agent control panel
2. Click "Stop Project Agent"

### Checking Status

**Via API:**
```bash
curl http://localhost:3000/api/project-agent/status
```

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "running",
    "execution_id": "exec_proj_123",
    "uptime_seconds": 3600,
    "activity": {
      "events_processed": 42,
      "actions_proposed": 5,
      "actions_approved": 3
    }
  }
}
```

---

## Configuration

The project agent supports extensive configuration options to match your workflow.

### Configuration Structure

```typescript
interface ProjectAgentConfig {
  useWorktree: boolean;              // Use isolated git worktree
  worktreePath?: string;             // Path to worktree
  mode: "monitoring" | "planning" | "full";  // Agent mode
  autoApprove: AutoApprovalConfig;   // Auto-approval settings
  monitoring: MonitoringConfig;       // Monitoring settings
}
```

### Auto-Approval Configuration

```typescript
interface AutoApprovalConfig {
  enabled: boolean;                  // Enable/disable auto-approval
  allowedActions: ActionType[];      // Which actions can be auto-approved
  minConfidenceScore?: number;       // Min confidence (0-100, default: 70)
  maxRiskLevel?: "low" | "medium" | "high";  // Max acceptable risk
}
```

**Available Actions:**
- `add_feedback` - Add feedback to specs
- `create_issues_from_spec` - Create issues from spec analysis
- `start_execution` - Start execution for ready issues
- `pause_execution` - Pause stalled executions
- `resume_execution` - Resume paused executions
- `modify_spec` - Modify spec content (high risk)
- `create_relationship` - Create relationships between issues
- `update_issue_status` - Update issue status

### Monitoring Configuration

```typescript
interface MonitoringConfig {
  stallThresholdMinutes: number;     // When to flag execution as stalled
  checkIntervalSeconds: number;      // How often to check execution health
}
```

### Example: Custom Configuration

```json
{
  "useWorktree": true,
  "mode": "full",
  "autoApprove": {
    "enabled": true,
    "allowedActions": ["add_feedback", "create_issues_from_spec"],
    "minConfidenceScore": 75,
    "maxRiskLevel": "medium"
  },
  "monitoring": {
    "stallThresholdMinutes": 30,
    "checkIntervalSeconds": 60
  }
}
```

---

## Configuration Presets

Three predefined configurations for different use cases.

### Conservative Mode

**Best for:** Critical projects, first-time users

**Characteristics:**
- ❌ No auto-approval
- 👀 Monitoring only
- ✋ Requires manual approval for all actions
- 🔒 Maximum control

**When to use:**
- Production-critical projects
- Projects with strict change control
- Learning how the project agent works
- High-stakes development

### Balanced Mode (Default)

**Best for:** Most development projects

**Characteristics:**
- ✅ Auto-approves low-risk actions (feedback, issues)
- ⚖️ Requires approval for executions
- 🎯 70% confidence threshold
- 📊 Medium risk tolerance

**When to use:**
- General-purpose development
- Teams familiar with project agent
- Balance between automation and control
- Standard development workflows

### Aggressive Mode

**Best for:** Experimental projects, rapid prototyping

**Characteristics:**
- ✅ Auto-approves most actions (including executions)
- 🚀 60% confidence threshold
- ⚡ High risk tolerance
- 🏃 More frequent monitoring (30s interval)

**When to use:**
- Experimental/side projects
- Rapid prototyping
- Solo developers with high trust
- Non-critical development

### Using Presets

**List available presets:**
```bash
curl http://localhost:3000/api/project-agent/presets
```

**Get specific preset:**
```bash
curl http://localhost:3000/api/project-agent/presets/balanced
```

**Start with preset:**
```bash
curl -X POST http://localhost:3000/api/project-agent/start \
  -H "Content-Type: application/json" \
  -d '{"preset": "balanced"}'
```

---

## Features

### 1. Spec → Issues Flow

The agent analyzes specs and proposes breaking them down into actionable issues.

**How it works:**
1. You create a new spec (e.g., SPEC-042: "Add user authentication")
2. Project agent detects the new spec via filesystem watcher
3. Agent analyzes spec content for completeness
4. If spec has ambiguities, agent adds feedback questions
5. After you respond, agent proposes creating issues with:
   - Clear titles and descriptions
   - Priority levels
   - Dependencies (blocks/depends-on relationships)

**Example:**
```
Spec: "Add OAuth authentication system"
↓
Agent proposes 4 issues:
- ISS-150: Setup OAuth provider integration (P0)
- ISS-151: Implement JWT token generation (P0)
- ISS-152: Add auth middleware (P1, blocked by ISS-150, ISS-151)
- ISS-153: Write auth tests (P1)
```

### 2. Execution Orchestration

The agent monitors ready issues and proposes starting executions.

**How it works:**
1. Issue becomes ready (no blockers)
2. Agent evaluates priority and current execution load
3. Agent proposes starting execution with justification
4. On approval, execution starts automatically
5. Agent monitors execution progress

**Priority factors:**
- Issue priority (P0 > P1 > P2)
- Number of issues it blocks
- Age of the issue
- Current execution capacity (max 3 concurrent)

### 3. Execution Monitoring

The agent detects and responds to execution problems.

**Stall Detection:**
- No new events for 30 minutes (configurable)
- No file changes in worktree
- Process running but inactive

**When stall detected:**
1. Agent proposes pause action with analysis
2. Shows last activity and suspected cause
3. Suggests recovery actions
4. On approval, pauses execution and optionally creates follow-up

### 4. Spec Quality Review

The agent analyzes spec quality and suggests improvements.

**Quality Checks:**
- Missing required sections (Overview, Requirements, etc.)
- Ambiguous language ("should", "might", "probably")
- Missing acceptance criteria
- Lack of code examples
- Insufficient word count

**Quality Score (0-100):**
- 80-100: Excellent
- 60-79: Good
- 40-59: Needs improvement
- 0-39: Critical issues

**Request analysis:**
```bash
curl http://localhost:3000/api/project-agent/analyze-spec/SPEC-042
```

### 5. Progress Reporting

The agent generates comprehensive project status reports.

**Report Contents:**
- Summary (specs, issues, executions, agent activity)
- Progress trends (improving/stable/declining)
- Blockers and their durations
- Actionable recommendations
- Health score (0-100)

**Generate report:**
```bash
# JSON format
curl "http://localhost:3000/api/project-agent/report?format=json&period=7"

# Markdown format
curl "http://localhost:3000/api/project-agent/report?format=markdown&period=7"

# Save to file
curl "http://localhost:3000/api/project-agent/report?format=markdown&save=true"
```

### 6. Risk Assessment & Confidence Scoring

Every action includes confidence score (0-100) and risk level (low/medium/high).

**Risk Factors:**
- **Low Risk**: Adding feedback, creating relationships
- **Medium Risk**: Creating issues, starting executions
- **High Risk**: Modifying specs, cancelling issues

**Confidence Factors:**
- Action-specific heuristics
- Historical success rate
- Data completeness
- Context availability

**Auto-approval considers both:**
```
Auto-approve if:
  1. Action type is in allowed list, AND
  2. Confidence >= min threshold (default 70), AND
  3. Risk <= max level (default medium)
```

---

## API Reference

### Project Agent Management

#### Start Project Agent
```http
POST /api/project-agent/start
Content-Type: application/json

{
  "config": {
    "mode": "full",
    "autoApprove": { "enabled": true }
  }
}

Response 200:
{
  "success": true,
  "data": {
    "execution_id": "exec_proj_123",
    "status": "starting"
  }
}
```

#### Stop Project Agent
```http
POST /api/project-agent/stop

Response 200:
{
  "success": true,
  "message": "Project agent stopped"
}
```

#### Get Status
```http
GET /api/project-agent/status

Response 200:
{
  "success": true,
  "data": {
    "status": "running",
    "uptime_seconds": 3600,
    "activity": {
      "events_processed": 42,
      "actions_proposed": 5,
      "actions_approved": 3
    }
  }
}
```

### Action Management

#### List Actions
```http
GET /api/project-agent/actions?status=proposed&limit=10

Response 200:
{
  "success": true,
  "data": {
    "actions": [
      {
        "id": "action_123",
        "action_type": "create_issues_from_spec",
        "status": "proposed",
        "confidence_score": 85,
        "risk_level": "medium",
        "justification": "Spec is complete...",
        "created_at": "2025-11-08T10:00:00Z"
      }
    ]
  }
}
```

#### Approve Action
```http
POST /api/project-agent/actions/action_123/approve

Response 200:
{
  "success": true,
  "data": {
    "action_id": "action_123",
    "status": "approved"
  }
}
```

#### Reject Action
```http
POST /api/project-agent/actions/action_123/reject
Content-Type: application/json

{
  "reason": "Not the right time for this"
}

Response 200:
{
  "success": true,
  "data": {
    "action_id": "action_123",
    "status": "rejected"
  }
}
```

### Reports & Analytics

#### Generate Report
```http
GET /api/project-agent/report?format=json&period=7&save=false

Response 200:
{
  "success": true,
  "data": {
    "generated_at": "2025-11-08T10:00:00Z",
    "period": {
      "start": "2025-11-01T10:00:00Z",
      "end": "2025-11-08T10:00:00Z"
    },
    "summary": {
      "specs": { "total": 12, "active": 8, "needs_attention": 2 },
      "issues": { "ready": 5, "in_progress": 3, "blocked": 1 },
      "executions": { "success_rate": 85 }
    },
    "health_score": 78
  }
}
```

### Configuration Presets

#### List Presets
```http
GET /api/project-agent/presets

Response 200:
{
  "success": true,
  "data": {
    "presets": [
      {
        "id": "conservative",
        "name": "Conservative",
        "description": "Requires manual approval for all actions",
        "use_cases": ["Critical projects", "First-time users"]
      },
      ...
    ]
  }
}
```

#### Get Preset Config
```http
GET /api/project-agent/presets/balanced

Response 200:
{
  "success": true,
  "data": {
    "preset": "balanced",
    "config": { ... }
  }
}
```

### Performance & Monitoring

#### Cache Statistics
```http
GET /api/project-agent/cache/stats

Response 200:
{
  "success": true,
  "data": {
    "hits": 1234,
    "misses": 456,
    "size": 250,
    "hit_rate": 73.02
  }
}
```

#### Clear Cache
```http
POST /api/project-agent/cache/clear

Response 200:
{
  "success": true,
  "message": "Cache cleared successfully"
}
```

---

## Troubleshooting

### Project Agent Won't Start

**Symptom:** Start request returns error

**Common Causes:**
1. Another project agent already running
2. Database connection issues
3. Invalid configuration

**Solutions:**
```bash
# Check if already running
curl http://localhost:3000/api/project-agent/status

# Stop existing agent
curl -X POST http://localhost:3000/api/project-agent/stop

# Try starting again
curl -X POST http://localhost:3000/api/project-agent/start
```

### No Actions Being Proposed

**Symptom:** Agent is running but not proposing any actions

**Common Causes:**
1. No events to process (no new specs/issues)
2. Agent in monitoring-only mode
3. All issues already being worked on

**Solutions:**
```bash
# Check agent status and activity
curl http://localhost:3000/api/project-agent/status

# Create a new spec to trigger analysis
# Check events log
curl http://localhost:3000/api/project-agent/events

# Verify mode is "full" not "monitoring"
curl http://localhost:3000/api/project-agent/config
```

### Actions Not Auto-Approving

**Symptom:** Actions stay in "proposed" status

**Common Causes:**
1. Auto-approval disabled
2. Confidence score below threshold
3. Risk level exceeds max
4. Action type not in allowed list

**Solutions:**
```bash
# Check current config
curl http://localhost:3000/api/project-agent/config

# View action details (including confidence/risk)
curl http://localhost:3000/api/project-agent/actions

# Adjust config if needed
curl -X PATCH http://localhost:3000/api/project-agent/config \
  -H "Content-Type: application/json" \
  -d '{"autoApprove": {"minConfidenceScore": 60}}'
```

### Poor Performance

**Symptom:** Agent is slow or unresponsive

**Common Causes:**
1. Too many events processing simultaneously
2. Cache not working effectively
3. Database queries slow

**Solutions:**
```bash
# Check cache statistics
curl http://localhost:3000/api/project-agent/cache/stats

# Clear cache if hit rate is low
curl -X POST http://localhost:3000/api/project-agent/cache/clear

# Check event processing backlog
curl http://localhost:3000/api/project-agent/events?limit=100

# Reduce check interval
curl -X PATCH http://localhost:3000/api/project-agent/config \
  -d '{"monitoring": {"checkIntervalSeconds": 120}}'
```

### Execution Monitoring Not Working

**Symptom:** Stalled executions not detected

**Common Causes:**
1. Stall threshold too high
2. Monitoring disabled
3. Agent not subscribed to execution events

**Solutions:**
```bash
# Lower stall threshold
curl -X PATCH http://localhost:3000/api/project-agent/config \
  -d '{"monitoring": {"stallThresholdMinutes": 20}}'

# Check if monitoring is enabled
curl http://localhost:3000/api/project-agent/config

# Verify agent is processing execution events
curl http://localhost:3000/api/project-agent/events?type=execution:updated
```

---

## Best Practices

### 1. Start Conservative, Get Aggressive

Begin with **Conservative** mode to understand how the agent works, then move to **Balanced**, and finally **Aggressive** if appropriate.

### 2. Review Proposed Actions Carefully

Even with auto-approval enabled, periodically review the action history to ensure the agent is making good decisions.

```bash
# Review recent actions
curl http://localhost:3000/api/project-agent/actions?limit=20
```

### 3. Use Confidence & Risk Thresholds

Adjust thresholds based on your comfort level:
- Start with 80% confidence minimum
- Lower gradually as you build trust
- Never go below 60% for production projects

### 4. Monitor Health Score

Generate weekly reports and track your project health score:
- 80+ is excellent
- 60-79 is good
- Below 60 needs attention

### 5. Provide Clear Spec Content

The better your specs, the better the agent's proposals:
- Include clear acceptance criteria
- Define success metrics
- Add code examples where relevant
- Respond to agent feedback promptly

### 6. Don't Over-Automate

Some actions should always require approval:
- `modify_spec` - Keep this manual
- Critical issue status changes
- Actions affecting production

### 7. Use Progress Reports

Generate reports regularly to:
- Track velocity trends
- Identify bottlenecks
- Prioritize blockers
- Share with team

### 8. Clear Cache Periodically

If you notice stale data or performance issues:
```bash
curl -X POST http://localhost:3000/api/project-agent/cache/clear
```

---

## Example Workflows

### Workflow 1: New Feature from Spec to Completion

**Scenario:** You want to add a new feature

**Steps:**
1. **Create Spec**
   ```bash
   # Create spec via CLI or UI
   sc spec create "Add user profile editing" --description "Users should be able to edit their profiles..."
   ```

2. **Agent Analyzes** (automatic)
   - Detects new spec
   - Checks for completeness
   - Adds feedback if needed

3. **Respond to Feedback**
   ```bash
   # View feedback
   sc feedback list --spec-id SPEC-042

   # Respond via UI or add note to spec
   ```

4. **Agent Proposes Issues** (automatic)
   - Creates action: `create_issues_from_spec`
   - Shows proposed issues with dependencies

5. **Approve Issue Creation**
   ```bash
   # List pending actions
   curl http://localhost:3000/api/project-agent/actions?status=proposed

   # Approve action
   curl -X POST http://localhost:3000/api/project-agent/actions/action_123/approve
   ```

6. **Agent Starts Execution** (if auto-approve enabled)
   - Detects ready issues
   - Proposes starting execution
   - Auto-approves if configured

7. **Monitor Progress**
   ```bash
   # Check execution status
   curl http://localhost:3000/api/executions

   # View agent activity
   curl http://localhost:3000/api/project-agent/status
   ```

8. **Agent Detects Completion**
   - Updates issue status
   - Unblocks dependent issues
   - Proposes next execution

### Workflow 2: Handling Stalled Execution

**Scenario:** An execution has been running for too long

**Steps:**
1. **Agent Detects Stall** (automatic)
   - No activity for 30+ minutes
   - Proposes pause action

2. **Review Stall Analysis**
   ```bash
   # View proposed action
   curl http://localhost:3000/api/project-agent/actions?status=proposed

   # Check action details
   curl http://localhost:3000/api/project-agent/actions/action_456
   ```

3. **Approve Pause**
   ```bash
   curl -X POST http://localhost:3000/api/project-agent/actions/action_456/approve
   ```

4. **Inspect Execution**
   - View execution logs
   - Check worktree state
   - Identify root cause

5. **Resume with Context**
   ```bash
   # Resume with additional context
   curl -X POST http://localhost:3000/api/executions/{id}/resume \
     -d '{"additional_context": "Previous run stalled on npm install. Use --force flag."}'
   ```

### Workflow 3: Weekly Project Review

**Scenario:** Generate and review project status

**Steps:**
1. **Generate Report**
   ```bash
   curl "http://localhost:3000/api/project-agent/report?format=markdown&period=7&save=true"
   ```

2. **Review Report**
   ```bash
   cat .sudocode/reports/project-report-2025-11-08.md
   ```

3. **Act on Recommendations**
   - Start executions for ready issues
   - Review specs needing attention
   - Resolve blockers
   - Archive old issues

4. **Adjust Configuration**
   ```bash
   # If approval rate is low, increase confidence threshold
   curl -X PATCH http://localhost:3000/api/project-agent/config \
     -d '{"autoApprove": {"minConfidenceScore": 65}}'
   ```

5. **Share with Team**
   - Export report as PDF
   - Include in standup
   - Track trends over time

---

## Support & Feedback

- **Documentation**: https://docs.sudocode.ai
- **Issues**: https://github.com/sudocode-ai/sudocode/issues
- **Discord**: https://discord.gg/sudocode

---

**Next Steps:**
- Try the [Conservative preset](#conservative-mode) to get started
- Read the [Configuration Reference](#configuration) for advanced options
- Explore the [API Reference](#api-reference) for integration options
