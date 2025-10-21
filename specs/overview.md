# sudograph: Abstractions for Agent-Assisted Development

Agentic software development is difficult because managing human context, planning, agent implementations/trajectories, and code outputs/artifacts is difficult. User-initiated changes to a plan might live in the human user's mental context, but might not be made explicit. Changes might ripple through existing planning or spec docs and make documents stale. Agents might encounter issues in implementation that might require human intervention, or they might pivot to other directions without fully updating underlying issue or plan documents. Context is constantly turning stale, and traceability is often ad-hoc.

I propose a 4-tiered abstraction structure called the `sudograph` for representing context. The tiers correspond to increasing granularity from high-level requirements to low-level implementation.

1. Spec: a primitive for user intent. It can be a request for change (RFC) in implementing a code change, a set of requirements for a high-level task like answering deep research questions, etc. A specification/spec captures user intent and requirements. It captures the WHAT of what the user is doing and what they want. Specs can be thought of as a node in a graph structure with links to other specs. Specs can have hierarchical relationships to lower-level specs that capture more detailed context about a user intent, and they can have cross-cutting links to other specs.
2. Issue: a primitive for capturing agent intent. Issues are derived from the spec and capture work within the agent scope that might include tasks or implementation details. Issues can be thought of as nodes that link back to specific requirements and sections of a spec(s). Issues can also be hierarchically organized and have dependencies and relationships to other issues.
3. Agent: the agent-level abstraction represents the actual trajectory of an agentic loop that is run against an issue. During execution, an agent attempts to resolve an issue and complete all requirements scoped to the issue. The agent-level abstraction also captures details about the underlying agent system (e.g. Claude Code/Codex/Cursor) and any agent configs (e.g. sub/multi-agent structures, unique workflows). Issues to agents have a one-to-many relationship. An agent always runs for a single issue, and multiple agent executions can be run for a single issue.
4. Artifact: a primitive representing a state change as a result of an agent execution. For coding agents, this might be a code diff corresponding to changes in a code repo. For research agents, it might be a report. For a documentation agent, it might be a diff corresponding to updates to docs-as-code. An agent execution can produce multiple artifacts.

The goal is to organize information at each abstraction layer and maintain the graph of relationships between each of these elements. Ideally, a user making specs at the spec abstraction layer can focus on providing context and requirements, issues can be used to break down and track work items for agents, and agent executions can handle implementation details to turn requirements into artifacts. The stratification of abstraction layers will help a user to maintain high-level visibility and allow them to drill down into increasingly lower-level details when they need to debug problems or make adjustments.

## Lifecycle from spec to artifact

### 1. Creation of a spec

The user defines a spec detailing requirements and behaviors. The spec at this stage defines abstractions, outlines design decisions, and lays out any relevant context.

### 2. Creation of sub-specs (optional)

For complex specs, the user can create internal links to hierarchical specs to add additional context at different levels of detail. Sub-specs created in this way can structured hierarchically and even reference other specs for cross-cutting changes.

### 3. Planning and issue creation

The user invokes a (typically planning-focused) agent to collaboratively define a set of issues to implement a spec. Since agents are executed against issues, a planning issue (e.g. 'Formulate a plan to implement spec A') is actually created for a given spec node, and the agent is executed to co-formulate a plan with the user and populate issues. Issues created in this way are bidirectionally bound to a spec. In practice, this can look similar to an internal link in the spec document colocated with relevant spec requirements. There are also backlinks for issues linking back to the location in the spec document the issue is mentioned. In the data structure, these are effectively edges between spec nodes and issue nodes. The executing planning agent populates issues for the entire spec file, and can initiate recursive planning for sub-specs.

An important step in the planning step is also the specification of relationships between different issues. Issues generally have four types of relationships:

- 'blocks': hard blocker of the recipient task
- 'related': soft relationship in context that aids in context management
- 'parent-child': subtask hierarchy relationships
- 'discovered-from': tracks issues discovered while working on other issues

As for the structure of an issue itself, an issue specifies a title, description, priority, assignee, and optional labels. The issue description and title contain enough context for the issue to clearly state the task and aid in issue index searchability. The priority is a relative value that helps organize execution order. The assignee is one of the set of configured agents, and an issue can also be assigned to a human user. Labels are used to aid in indexing and issue searchability.

The agent modifying the spec with issues is a form of feedback from the lower issue abstraction to the higher spec abstraction.

- TODO: explain how bridging from lower to higher abstraction levels helps the user stay in-the-loop about agent changes.

### 4. Agent Execution

After issues are created, they can be executed. Actual issue execution can be manually triggered by the user but it can also be assigned automatically. Issues with no blocking dependencies and higher priorities will be executed first (topological order), and hierarchical issues are run in hierarchical order with handoffs between subtasks.

During execution, it's possible that agents come across other problems or unforeseen difficulties. If plans must change or the issues need to be updated, agents at this stage can update the spec with findings and feedback.

- TODO: Talk about how the feedback extends from the execution-level to the spec-level.

### 5. Execution Artifact Management

- artifacts are created as the agent executions run
- code changes can be marked for review or be directly committed depending on user settings.
- TODO: elaborate on a mechanism for artifact-level abstractiosn to provide feedback for upper levels.

- TODO: Add considerations for what eventually happens to issues, specs as they are completed and age out. They can possibly be archived and tracked through source control, or the specs can migrate into a docs-as-code type context map that tracks implemented specs as human-readable markdown files.

## Lifecycle of a plan pivot

## Specs-as-code, Issues-as-code, Agents-as-code

In the /.sudocode directory, we support the following structures:

1. Specs in /.sudocode/specs: This directory contains a list in the format of a standard file structure. The spec files have machine-generated YAML frontmatter with fields such as the id, title, relationships, and create/update metadata. This is also synced to a corresponding JSONL file that contains a structured json snapshot that contains the current state of the spec.
2. Issues in /.sudocode/issues: This directory contains a list of issues in a JSONL file (/.sudocode/issues/issues.jsonl). Issues are generally agent-generated and agent-managed. However, users can also make edits to issues in a human-readable expanded form, similar to specs. The issues are also flat-listed as markdown files, with frontmatter corresponding to their id, title, relationships, assignees, and create/update metadata. Updates to issue markdown files are synced to the JSONL file.
3. Agent configs in ./sudocode/agents: This contains configurations for different agent types. For example, for Claude Code agents, this might include definitions for specific agent behaviors, such as plugins, hooks, prompts, or MCP servers. Users can declaratively update their intented agent behavior. This agent directory also supports other coding agents like Codex, Gemini CLI, etc.

TODO: Expand to support environment configurations (worktrees, credentials, etc)

We can expand this to support sudograph-specific configs to modify behavior.

### Distributed Git Database

The repository is used as the source of truth, and a db is synced and derived from the repo data as a cache for access and queryability.

Each machine has a local SQLite cache (.sudocode/sudocode.db) - gitignored
Source of truth is JSONL (.sudocode/issues/issues.jsonl, .sudocode/specs/specs.jsonl, etc) - committed to git
Auto-export syncs SQLite → JSONL after CRUD operations (5-second debounce)
Auto-import syncs JSONL → SQLite when JSONL is newer (e.g., after git pull)
Git handles distribution while AI handles merge conflicts.

TODO: Expand on conflict resolution behavior
TODO: Expand on atomic interactions (e.g. claiming an issue) to help with agent synchronization/concurrency for multiple concurrent machines.

## Multi-Agent Interactions

TODO: Expand on behavior
- claiming issues
- automatic agent invocation
- issue/spec editing collisions
- git commit/merge behavior across issues
