# Feedback Mechanisms Specification

## Overview

This spec defines how AI agents provide feedback on specifications and how code artifacts link back to issues, creating a bidirectional flow between design documents, implementation tracking, and actual code.

## Core Feedback Flows

### 1. Agent → Spec Feedback

AI agents (Claude Code, Cursor, etc.) analyze specs during implementation and provide structured feedback.

#### Feedback Types

**Implementation Feedback:**
- Ambiguities discovered during implementation
- Missing requirements or edge cases
- Technical constraints not mentioned in spec
- Suggested improvements based on actual implementation

**Validation Feedback:**
- Conflicts with existing code patterns
- Performance concerns
- Security considerations
- Scalability issues

**Completion Feedback:**
- Confirmation that spec requirements are met
- Test coverage validation
- Documentation completeness

**Informational Feedback**
- High-level implementation descriptions
- Supplementary information that is relevant to a user monitoring a spec

#### Storage Model

Feedback is stored as structured comments in a dedicated section:

**In SQLite:**
```sql
CREATE TABLE spec_feedback (
    id TEXT PRIMARY KEY,
    spec_id TEXT NOT NULL,
    feedback_type TEXT NOT NULL, -- 'implementation' | 'validation' | 'completion' | 'question'
    content TEXT NOT NULL,
    agent TEXT NOT NULL, -- 'claude-code' | 'cursor' | 'human'
    context TEXT, -- JSON: { issue_id, file_path, line_number, commit_sha }
    status TEXT DEFAULT 'open', -- 'open' | 'addressed' | 'dismissed'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (spec_id) REFERENCES specs(id)
);

CREATE INDEX idx_spec_feedback_spec_id ON spec_feedback(spec_id);
CREATE INDEX idx_spec_feedback_status ON spec_feedback(status);
```

**In Markdown (appended to spec):**
```markdown
---
id: spec-001
title: Authentication System
status: review
---

# Authentication System

[Main spec content...]

---

## Agent Feedback

### FB-001 (open) - Implementation
**Agent:** claude-code
**Date:** 2025-01-15
**Context:** issue-010, src/auth/tokens.ts:45

During implementation of token refresh logic, discovered that the spec doesn't specify:
- Token rotation policy for concurrent requests
- Behavior when refresh token is expired
- Grace period for token expiration

**Suggested addition:**
```
Token Refresh Policy:
- Only one refresh request per token allowed (concurrent requests return same new token)
- Expired refresh tokens return 401 with clear error message
- 5-minute grace period for access tokens to prevent race conditions
```

**Status:** Open
**Assignee:** @spec-author

### FB-002 (addressed) - Validation
**Agent:** cursor
**Date:** 2025-01-14
**Context:** commit abc123, src/auth/middleware.ts

Security concern: Spec requires storing refresh tokens in localStorage, but this is vulnerable to XSS attacks.

**Recommendation:** Use httpOnly cookies for refresh tokens instead.

**Resolution:** Updated spec section 3.2 to use httpOnly cookies. Issue-015 created to migrate existing implementation.

### FB-003 (dismissed) - Question
**Agent:** claude-code
**Date:** 2025-01-13

Should we support OAuth social logins in addition to email/password?

**Resolution:** Out of scope for v1. Added to backlog as spec-025.

---
```

**In JSONL:**
```jsonl
{"id":"spec-001","title":"Authentication System","feedback":[{"id":"FB-001","type":"implementation","content":"During implementation...","agent":"claude-code","context":{"issue_id":"issue-010","file_path":"src/auth/tokens.ts","line_number":45},"status":"open","created_at":"2025-01-15T10:30:00Z"}]}
```

#### Agent Feedback Workflow

```typescript
// Agent provides feedback during implementation
interface FeedbackContext {
  issueId?: string;
  filePath?: string;
  lineNumber?: number;
  commitSha?: string;
}

async function provideFeedback(
  specId: string,
  feedbackType: 'implementation' | 'validation' | 'completion' | 'question',
  content: string,
  context?: FeedbackContext
): Promise<string> {
  const feedback = {
    id: generateFeedbackId(), // FB-NNN
    spec_id: specId,
    feedback_type: feedbackType,
    content,
    agent: 'claude-code',
    context: JSON.stringify(context),
    status: 'open',
    created_at: new Date(),
  };

  // Insert into SQLite
  await db.insertFeedback(feedback);

  // Append to markdown
  await appendFeedbackToMarkdown(specId, feedback);

  // Sync to JSONL
  await syncSpecToJSONL(specId);

  // Notify spec author if configured
  await notifySpecAuthor(specId, feedback);

  return feedback.id;
}
```

#### CLI Commands for Feedback

```bash
# List all feedback for a spec
sudocode feedback list spec-001

# Show open feedback across all specs
sudocode feedback list --status open

# Address feedback
sudocode feedback resolve FB-001 --comment "Updated spec section 3.2"

# Dismiss feedback
sudocode feedback dismiss FB-002 --reason "Out of scope"

# Add feedback manually
sudocode feedback add spec-001 --type question --content "Should we support MFA?"
```

### 2. Artifact → Issue Linking

Code artifacts (files, functions, classes) are linked back to the issues that created or modified them.

#### Storage Model

**In SQLite:**
```sql
CREATE TABLE artifacts (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL,
    artifact_type TEXT NOT NULL, -- 'file' | 'function' | 'class' | 'component' | 'test'
    file_path TEXT NOT NULL,
    name TEXT, -- Function/class/component name
    line_start INTEGER,
    line_end INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (issue_id) REFERENCES issues(id)
);

CREATE INDEX idx_artifacts_issue_id ON artifacts(issue_id);
CREATE INDEX idx_artifacts_file_path ON artifacts(file_path);
CREATE INDEX idx_artifacts_name ON artifacts(name);

-- Track artifact changes over time
CREATE TABLE artifact_changes (
    id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL,
    change_type TEXT NOT NULL, -- 'created' | 'modified' | 'deleted' | 'renamed'
    commit_sha TEXT,
    author TEXT,
    changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (artifact_id) REFERENCES artifacts(id)
);
```

**In code comments:**
```typescript
// @sudocode issue-010
// Created: 2025-01-15
// Purpose: Implement JWT token refresh logic
export async function refreshToken(refreshToken: string): Promise<AuthTokens> {
  // Implementation...
}

// @sudocode issue-010
// Modified: 2025-01-16 (added concurrent request handling)
export class TokenManager {
  // ...
}
```

**In special marker file (`.sudocode/artifacts.jsonl`):**
```jsonl
{"id":"artifact-001","issue_id":"issue-010","type":"function","file_path":"src/auth/tokens.ts","name":"refreshToken","line_start":45,"line_end":78,"created_at":"2025-01-15T10:00:00Z"}
{"id":"artifact-002","issue_id":"issue-010","type":"class","file_path":"src/auth/tokens.ts","name":"TokenManager","line_start":80,"line_end":150,"created_at":"2025-01-15T11:00:00Z"}
```

#### Artifact Tracking Workflow

**Automatic Tracking (via git hooks):**

```bash
# .git/hooks/post-commit
#!/bin/bash
sudocode artifacts scan --commit HEAD
```

```typescript
// Scan commit for artifacts
async function scanCommitForArtifacts(commitSha: string): Promise<void> {
  const diff = await git.diff([`${commitSha}^`, commitSha]);

  // Parse diff to find new/modified functions and classes
  const artifacts = parseArtifactsFromDiff(diff);

  // Extract issue references from commit message or comments
  const issueId = extractIssueFromCommit(commitSha);

  if (issueId) {
    for (const artifact of artifacts) {
      await trackArtifact({
        issue_id: issueId,
        artifact_type: artifact.type,
        file_path: artifact.filePath,
        name: artifact.name,
        line_start: artifact.lineStart,
        line_end: artifact.lineEnd,
      });
    }
  }
}
```

**Manual Tracking:**

```bash
# Link file to issue
sudocode artifact add issue-010 src/auth/tokens.ts

# Link specific function to issue
sudocode artifact add issue-010 src/auth/tokens.ts:refreshToken

# Link with line numbers
sudocode artifact add issue-010 src/auth/tokens.ts --lines 45:78
```

**Querying Artifacts:**

```bash
# List all artifacts for an issue
sudocode artifact list issue-010

# Find what issue created/modified a file
sudocode artifact find src/auth/tokens.ts

# Find what issue created a specific function
sudocode artifact find src/auth/tokens.ts:refreshToken

# Show artifact history
sudocode artifact history artifact-001
```

#### Artifact Analysis

Use TypeScript AST parsing to extract artifacts:

```typescript
import * as ts from 'typescript';

interface CodeArtifact {
  type: 'function' | 'class' | 'interface' | 'type' | 'component';
  name: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  issueId?: string; // From comment annotation
}

function extractArtifactsFromFile(filePath: string): CodeArtifact[] {
  const sourceCode = fs.readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceCode,
    ts.ScriptTarget.Latest,
    true
  );

  const artifacts: CodeArtifact[] = [];

  function visit(node: ts.Node) {
    // Extract function declarations
    if (ts.isFunctionDeclaration(node) && node.name) {
      const { line: lineStart } = sourceFile.getLineAndCharacterOfPosition(node.pos);
      const { line: lineEnd } = sourceFile.getLineAndCharacterOfPosition(node.end);

      // Check for @sudocode comment
      const issueId = extractIssueFromComments(node, sourceFile);

      artifacts.push({
        type: 'function',
        name: node.name.text,
        filePath,
        lineStart: lineStart + 1,
        lineEnd: lineEnd + 1,
        issueId,
      });
    }

    // Extract class declarations
    if (ts.isClassDeclaration(node) && node.name) {
      const { line: lineStart } = sourceFile.getLineAndCharacterOfPosition(node.pos);
      const { line: lineEnd } = sourceFile.getLineAndCharacterOfPosition(node.end);

      const issueId = extractIssueFromComments(node, sourceFile);

      artifacts.push({
        type: 'class',
        name: node.name.text,
        filePath,
        lineStart: lineStart + 1,
        lineEnd: lineEnd + 1,
        issueId,
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return artifacts;
}

function extractIssueFromComments(
  node: ts.Node,
  sourceFile: ts.SourceFile
): string | undefined {
  const commentRanges = ts.getLeadingCommentRanges(
    sourceFile.getFullText(),
    node.pos
  );

  if (!commentRanges) return undefined;

  for (const range of commentRanges) {
    const comment = sourceFile.getFullText().substring(range.pos, range.end);
    const match = comment.match(/@sudocode\s+(issue-\d+)/);
    if (match) {
      return match[1];
    }
  }

  return undefined;
}
```

### 3. Bidirectional Navigation

Enable navigation from specs to code and code to specs.

#### In IDE (VS Code Extension)

**Features:**
- Hover over spec ID to see spec summary
- Click spec ID to open spec file
- CodeLens showing "Implemented in: issue-010" above spec sections
- CodeLens showing "Created by: issue-010" above functions/classes
- Command: "Go to Spec" from code
- Command: "View Implementation" from spec

**Example VS Code extension:**

```typescript
// VS Code Extension: sudocode
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  // Hover provider for spec IDs
  const hoverProvider = vscode.languages.registerHoverProvider(
    { scheme: 'file', pattern: '**/*.{ts,tsx,js,jsx}' },
    {
      async provideHover(document, position) {
        const range = document.getWordRangeAtPosition(
          position,
          /spec-\d+|issue-\d+/
        );

        if (!range) return;

        const id = document.getText(range);
        const entity = await fetchEntity(id);

        if (!entity) return;

        const markdown = new vscode.MarkdownString();
        markdown.appendMarkdown(`**${entity.title}**\n\n`);
        markdown.appendMarkdown(`Status: ${entity.status}\n\n`);
        markdown.appendMarkdown(entity.summary);

        return new vscode.Hover(markdown);
      },
    }
  );

  // CodeLens provider
  const codeLensProvider = vscode.languages.registerCodeLensProvider(
    { scheme: 'file', pattern: '**/*.{ts,tsx,js,jsx}' },
    {
      async provideCodeLenses(document) {
        const artifacts = await getArtifactsForFile(document.fileName);
        const lenses: vscode.CodeLens[] = [];

        for (const artifact of artifacts) {
          const range = new vscode.Range(
            artifact.lineStart - 1,
            0,
            artifact.lineStart - 1,
            0
          );

          lenses.push(
            new vscode.CodeLens(range, {
              title: `📋 Created by: ${artifact.issue_id}`,
              command: 'sudocode.openIssue',
              arguments: [artifact.issue_id],
            })
          );
        }

        return lenses;
      },
    }
  );

  context.subscriptions.push(hoverProvider, codeLensProvider);
}
```

#### In CLI

```bash
# From spec, find implementations
sudocode spec show spec-001 --implementations

# Output:
# spec-001: Authentication System
#
# Implemented by:
#   issue-010: Implement JWT tokens
#   issue-012: Add token refresh
#
# Code artifacts:
#   src/auth/tokens.ts:refreshToken (issue-010)
#   src/auth/tokens.ts:TokenManager (issue-010)
#   src/auth/middleware.ts:authMiddleware (issue-012)

# From code file, find related issues/specs
sudocode artifact find src/auth/tokens.ts

# Output:
# Artifacts in src/auth/tokens.ts:
#
# refreshToken (lines 45-78)
#   Created by: issue-010 (Implement JWT tokens)
#   Spec: spec-001 (Authentication System)
#
# TokenManager (lines 80-150)
#   Created by: issue-010 (Implement JWT tokens)
#   Modified by: issue-015 (Fix concurrent refresh)
#   Spec: spec-001 (Authentication System)
```

## Workflow Examples

### Example 1: Agent discovers spec ambiguity

```bash
# While implementing issue-010, Claude discovers ambiguity
# Claude runs:
sudocode feedback add spec-001 \
  --type implementation \
  --content "Token rotation policy for concurrent requests not specified" \
  --context '{"issue_id":"issue-010","file_path":"src/auth/tokens.ts","line_number":45}'

# Spec author reviews feedback
sudocode feedback list --status open

# Spec author updates spec and resolves feedback
vim specs/spec-001-auth.md  # Add token rotation policy
sudocode feedback resolve FB-001 --comment "Added section 3.3 on token rotation"
```

### Example 2: Tracking implementation artifacts

```bash
# Developer starts work on issue-010
sudocode issue update issue-010 --status in_progress

# During implementation, annotate code
# In src/auth/tokens.ts:
# @sudocode issue-010
# export async function refreshToken(...)

# After commit, scan for artifacts
git commit -m "feat: implement token refresh (issue-010)"
sudocode artifacts scan --commit HEAD

# View artifacts created
sudocode artifact list issue-010

# Later, find what created a function
sudocode artifact find src/auth/tokens.ts:refreshToken
# Output: Created by issue-010 (Implement JWT tokens)
```

### Example 3: Spec to code navigation

```bash
# View spec and see implementations
sudocode spec show spec-001 --implementations

# Jump to specific artifact
sudocode artifact open src/auth/tokens.ts:refreshToken

# Or in IDE: Hover over spec-001 in code → Click "View Spec"
```

## Implementation Tasks

These feedback mechanisms should be tracked as implementation issues:

1. **sudocode-20:** Implement spec feedback table and CRUD operations
2. **sudocode-21:** Add feedback commands to CLI (add, list, resolve, dismiss)
3. **sudocode-22:** Implement artifact tracking table and CRUD operations
4. **sudocode-23:** Add artifact commands to CLI (add, list, find, history)
5. **sudocode-24:** Implement TypeScript AST parser for artifact extraction
6. **sudocode-25:** Create git post-commit hook for automatic artifact scanning
7. **sudocode-26:** Build VS Code extension with hover and CodeLens providers
8. **sudocode-27:** Add bidirectional navigation in CLI (spec→code, code→spec)

## Future Enhancements

- **AI-powered suggestions:** Agent analyzes implementation and suggests spec improvements
- **Test coverage tracking:** Link test files as artifacts with coverage metrics
- **Documentation generation:** Auto-generate docs from specs + artifacts
- **Impact analysis:** Show which code will be affected by spec changes
- **Stale artifact detection:** Find artifacts that no longer match their linked issues

## User <-> Agent Feedback/Iterations

After initial spec creation and implementation, it's possible for users to adjust existing specs.

- Account for a user changing specs and capturing the spec diff
- Allow for generating issues to account for changes to 