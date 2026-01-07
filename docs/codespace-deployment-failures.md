# Codespace Deployment Failures - Error Recovery Catalog

**Date**: 2026-01-06
**Spec**: s-6z5l - Remote Deployment - GitHub Codespaces Support
**Issue**: i-ykaw - Error Recovery and Cleanup Investigation

---

## Executive Summary

This document defines error handling and cleanup strategies for `sudocode deploy remote` failures. The guiding principle is:

**Automatic cleanup for infrastructure failures, preserve for user errors.**

- **Delete Codespace**: Infrastructure/setup failures where Codespace is unusable
- **Preserve Codespace**: User-related issues or debugging scenarios
- **Track partial state**: Always record what succeeded before failure

---

## Error Recovery Decision Matrix

| Failure Point | Delete Codespace? | Track in deployments.json? | User Action Required |
|---------------|-------------------|----------------------------|----------------------|
| **Pre-flight Failures** |
| `gh` CLI not found | N/A (no Codespace) | No | Install `gh` CLI |
| Not authenticated with GitHub | N/A (no Codespace) | No | Run `gh auth login` |
| Not a git repository | N/A (no Codespace) | No | Run `git init` |
| No remote configured | N/A (no Codespace) | No | Add GitHub remote |
| No agent selected | N/A (no Codespace) | No | Select agent |
| No auth token found | N/A (no Codespace) | No | Run `sudocode auth configure` |
| **Post-Codespace Creation** |
| Codespace creation fails | N/A (creation failed) | No | Check GitHub quota/permissions |
| Codespace creation times out | ❌ Delete | Yes (failed state) | Check GitHub status |
| npm install fails | ✅ Delete | Yes (failed state) | Check npm registry |
| npm build fails | ✅ Delete | Yes (failed state) | File GitHub issue |
| Agent auth config fails | ✅ Delete | Yes (failed state) | Check token validity |
| Server fails to start | ✅ Delete | Yes (failed state) | File GitHub issue |
| Server starts but port occupied | ✅ Delete | Yes (failed state) | Unexpected (fresh Codespace) |
| Port visibility change fails | ✅ Delete | Yes (failed state) | Check GitHub permissions |
| Health check times out | ⚠️ Preserve | Yes (warn state) | Manual debug |
| Browser opening fails | ⚠️ Preserve | Yes (success state) | Open manually |
| **User Interruption** |
| Ctrl+C before Codespace created | N/A (no Codespace) | No | Re-run command |
| Ctrl+C after Codespace created | ⚠️ Ask user | Yes (partial state) | Prompt: delete or keep? |

**Legend**:
- ✅ **Delete**: Auto-delete Codespace, show error
- ❌ **Delete**: No Codespace to delete
- ⚠️ **Preserve**: Keep Codespace, provide debug info
- **Track**: Record in `deployments.json` for visibility

---

## Detailed Failure Scenarios

### Phase 1: Pre-flight Checks (No Codespace Yet)

#### 1. GitHub CLI Not Found

**Error**: `gh` command not found

**Cleanup**:
- No Codespace created
- No tracking needed

**User Message**:
```
✗ GitHub CLI not found

Please install GitHub CLI:
  - macOS: brew install gh
  - Linux: See https://cli.github.com/manual/installation
  - Windows: winget install --id GitHub.cli

After installing, run: gh auth login
```

**Exit Code**: 1

---

#### 2. GitHub CLI Not Authenticated

**Detection**: `gh auth status` returns non-zero

**Cleanup**:
- No Codespace created
- No tracking needed

**User Message**:
```
✗ Not authenticated with GitHub

Please authenticate:
  gh auth login

Then re-run: sudocode deploy remote
```

**Exit Code**: 1

---

#### 3. Not a Git Repository

**Detection**: No `.git` directory

**Cleanup**:
- No Codespace created
- No tracking needed

**User Message**:
```
✗ Not a git repository

Current directory is not a git repository.
Please initialize git first:
  git init
  git add .
  git commit -m "Initial commit"
  git remote add origin https://github.com/user/repo.git
  git push -u origin main
```

**Exit Code**: 1

---

#### 4. No GitHub Remote

**Detection**: `git remote -v` has no GitHub remote

**Cleanup**:
- No Codespace created
- No tracking needed

**User Message**:
```
✗ No GitHub remote found

Please add a GitHub remote:
  git remote add origin https://github.com/user/repo.git
  git push -u origin main

Then re-run: sudocode deploy remote
```

**Exit Code**: 1

---

#### 5. No Agent Selected

**Detection**: `selectedAgent` missing from `deployments.json`

**Cleanup**:
- No Codespace created
- No tracking needed

**User Message**:
```
No agent configured. Let's set one up!

Select an AI coding agent:
  ❯ Claude Code (recommended)
    Codex (coming soon)
    Copilot (coming soon)
    Cursor (coming soon)
```

**Recovery**: Interactive prompt, save to `deployments.json`

---

#### 6. No Authentication Token

**Detection**: `user_credentials.json` missing or `claudeCodeOAuthToken` empty

**Cleanup**:
- No Codespace created
- No tracking needed

**User Message**:
```
✗ No Claude Code token found

Please run: sudocode auth configure

This will guide you through generating a long-lived authentication token.
```

**Exit Code**: 1

---

### Phase 2: Codespace Creation

#### 7. Codespace Creation Fails

**Error Examples**:
- GitHub API error
- Insufficient quota
- Repository access denied
- Invalid machine type

**Detection**: `gh codespace create` returns non-zero

**Cleanup**:
- No Codespace created (or creation incomplete)
- No tracking needed

**User Message**:
```
✗ Failed to create Codespace

Error: {error message from gh CLI}

Possible causes:
  - Codespace quota exceeded (check GitHub settings)
  - Repository access denied (check permissions)
  - Invalid machine type

Check GitHub Codespaces dashboard:
  https://github.com/codespaces
```

**Exit Code**: 1

---

#### 8. Codespace Creation Times Out

**Scenario**: `gh codespace create` hangs or takes >5 minutes

**Detection**: Timeout after 5 minutes

**Cleanup**:
- ✅ **Delete Codespace** (if name known)
- Track in `deployments.json` with `status: "failed"`

**User Message**:
```
✗ Codespace creation timed out after 5 minutes

Cleaning up...
✓ Codespace deleted

This is unusual. Check GitHub status:
  https://www.githubstatus.com
```

**Tracking**:
```json
{
  "name": "codespace-abc123",
  "status": "failed",
  "error": "Creation timeout after 5 minutes",
  "createdAt": "...",
  "deletedAt": "..."
}
```

**Exit Code**: 1

---

### Phase 3: Installation & Configuration

#### 9. npm install Fails

**Error Examples**:
- Network timeout
- Package not found
- Disk full (unlikely)

**Detection**: `npm install` returns non-zero

**Cleanup**:
- ✅ **Delete Codespace**
- Track failure in `deployments.json`

**User Message**:
```
✗ Failed to install sudocode packages

Codespace: {codespace-name}

Error log:
{last 20 lines of npm install output}

Cleaning up...
✓ Codespace deleted

This is likely a transient npm registry issue. Please retry:
  sudocode deploy remote
```

**Tracking**:
```json
{
  "name": "codespace-abc123",
  "status": "failed",
  "error": "npm install failed",
  "phase": "installation",
  "createdAt": "...",
  "deletedAt": "..."
}
```

**Exit Code**: 1

---

#### 10. npm build Fails

**Error Examples**:
- TypeScript compilation errors
- Missing dependencies
- Build script bugs

**Detection**: `npm run build` returns non-zero

**Cleanup**:
- ✅ **Delete Codespace**
- Track failure in `deployments.json`

**User Message**:
```
✗ Failed to build sudocode

Codespace: {codespace-name}

Build error:
{last 20 lines of build output}

Cleaning up...
✓ Codespace deleted

This indicates a bug in the sudocode repository.
Please file an issue:
  https://github.com/sudocode-ai/sudocode/issues
```

**Tracking**: Same as npm install failure

**Exit Code**: 1

---

#### 11. Agent Authentication Configuration Fails

**Error Examples**:
- Token invalid/expired
- Auth command not found
- Permission denied

**Detection**: `sudocode auth claude --token` returns non-zero

**Cleanup**:
- ✅ **Delete Codespace**
- Track failure in `deployments.json`

**User Message**:
```
✗ Failed to configure agent authentication

Codespace: {codespace-name}

Error:
{error output}

Cleaning up...
✓ Codespace deleted

Your authentication token may be invalid or expired.
Please re-run: sudocode auth configure
```

**Tracking**:
```json
{
  "name": "codespace-abc123",
  "status": "failed",
  "error": "Agent auth configuration failed",
  "phase": "configuration",
  "createdAt": "...",
  "deletedAt": "..."
}
```

**Exit Code**: 1

---

### Phase 4: Server Startup & Port Forwarding

#### 12. Server Fails to Start

**Error Examples**:
- Server crashes on startup
- Missing dependencies
- Port bind fails (unexpected on fresh Codespace)

**Detection**: Server not responding on localhost:3000 after 30 seconds (15 retries × 2s)

**Cleanup**:
- ✅ **Delete Codespace**
- Track failure in `deployments.json`

**User Message**:
```
✗ Server failed to start

Codespace: {codespace-name}

Server log:
{last 30 lines of /tmp/sudocode.log}

Cleaning up...
✓ Codespace deleted

This indicates a server startup issue.
Please file an issue with the log above:
  https://github.com/sudocode-ai/sudocode/issues
```

**Tracking**:
```json
{
  "name": "codespace-abc123",
  "status": "failed",
  "error": "Server failed to start after 30 seconds",
  "phase": "server_startup",
  "createdAt": "...",
  "deletedAt": "..."
}
```

**Exit Code**: 1

---

#### 13. Port Already Occupied (Unexpected)

**Scenario**: Port 3000 occupied on fresh Codespace (should never happen)

**Detection**: Server log shows "Address already in use"

**Cleanup**:
- ✅ **Delete Codespace**
- Track failure in `deployments.json`

**User Message**:
```
✗ Port 3000 is already occupied

Codespace: {codespace-name}

This is unexpected on a fresh Codespace.

Cleaning up...
✓ Codespace deleted

If this persists, please file an issue:
  https://github.com/sudocode-ai/sudocode/issues
```

**Tracking**: Same as server startup failure

**Exit Code**: 1

---

#### 14. Port Visibility Change Fails

**Error Examples**:
- `gh codespace ports visibility` fails
- Insufficient permissions
- Port doesn't exist

**Detection**: `gh codespace ports visibility` returns non-zero

**Cleanup**:
- ✅ **Delete Codespace**
- Track failure in `deployments.json`

**User Message**:
```
✗ Failed to make port 3000 public

Codespace: {codespace-name}

Error:
{error output from gh CLI}

Cleaning up...
✓ Codespace deleted

Check your GitHub Codespaces permissions.
```

**Tracking**:
```json
{
  "name": "codespace-abc123",
  "status": "failed",
  "error": "Port visibility change failed",
  "phase": "port_forwarding",
  "createdAt": "...",
  "deletedAt": "..."
}
```

**Exit Code**: 1

---

#### 15. Health Check Times Out

**Scenario**: Server started, port made public, but health check fails after 20 seconds (10 retries × 2s)

**Cleanup**:
- ⚠️ **Preserve Codespace** (for debugging)
- Track as "warning" state in `deployments.json`

**User Message**:
```
⚠️  Health check timed out

Codespace: {codespace-name}
URL: https://{codespace-name}-3000.app.github.dev

Server appears to be running, but health check failed after 20 seconds.

Codespace has been PRESERVED for debugging.

Manual steps:
  1. Check server logs:
       gh codespace ssh --codespace {codespace-name} -- 'tail -50 /tmp/sudocode.log'

  2. Try accessing URL manually:
       {url}

  3. If server is working, ignore this warning

  4. To delete Codespace:
       sudocode deploy stop {codespace-name}

Deployment partially tracked for reference.
```

**Tracking**:
```json
{
  "name": "codespace-abc123",
  "status": "warning",
  "error": "Health check timeout (server may still be working)",
  "phase": "health_check",
  "port": 3000,
  "urls": {
    "codespace": "https://codespace-abc123.github.dev",
    "sudocode": "https://codespace-abc123-3000.app.github.dev"
  },
  "createdAt": "..."
}
```

**Exit Code**: 0 (warning, not failure)

---

#### 16. Browser Opening Fails

**Scenario**: Everything succeeded, but `open` command fails

**Cleanup**:
- ⚠️ **Preserve Codespace** (deployment successful!)
- Track as successful deployment

**User Message**:
```
✓ Deployment successful!

⚠️  Failed to open browser automatically

Codespace: {codespace-name}

Please open manually:
  🌐 Codespace:   https://{codespace-name}.github.dev
  🚀 Sudocode UI: https://{codespace-name}-3000.app.github.dev

Commands:
  sudocode deploy list   - View all deployments
  sudocode deploy stop   - Stop this deployment
```

**Tracking**: Normal successful deployment (no special handling)

**Exit Code**: 0 (success)

---

### Phase 5: User Interruption

#### 17. Ctrl+C Before Codespace Created

**Detection**: SIGINT/SIGTERM before `gh codespace create` completes

**Cleanup**:
- No Codespace to delete
- No tracking needed

**User Message**:
```
Deployment cancelled by user.
No Codespace was created.
```

**Exit Code**: 130 (128 + SIGINT signal number)

---

#### 18. Ctrl+C After Codespace Created

**Detection**: SIGINT/SIGTERM after Codespace name known

**Cleanup**:
- ⚠️ **Ask user** whether to delete or preserve

**User Message**:
```
Deployment interrupted by user.

Codespace created: {codespace-name}

What would you like to do?
  1) Delete Codespace and clean up
  2) Keep Codespace for manual configuration

Choice [1]:
```

**If user chooses Delete**:
```
Cleaning up...
✓ Codespace deleted

Deployment cancelled.
```

**If user chooses Keep**:
```
Codespace preserved: {codespace-name}

To manually continue setup:
  gh codespace code --codespace {codespace-name}

To delete later:
  sudocode deploy stop {codespace-name}
```

**Tracking** (if kept):
```json
{
  "name": "codespace-abc123",
  "status": "partial",
  "error": "User interrupted deployment",
  "phase": "...",
  "createdAt": "..."
}
```

**Exit Code**: 130

---

## Implementation Guidelines

### Error Handling Pattern

```typescript
export async function deployRemote(options: DeployOptions): Promise<Deployment> {
  let codespaceName: string | null = null;

  try {
    // Pre-flight checks (no cleanup needed if these fail)
    await checkGhCli();
    await checkGhAuth();
    await checkGitRepo();
    await checkGitRemote();
    await ensureAgentSelected();
    await checkAuthentication();

    // Codespace creation (cleanup needed after this point)
    const codespace = await createCodespace({
      machine: options.machine || 'basicLinux32gb',
      idleTimeout: 240,
      retentionPeriod: options.retentionPeriod || 14,
      timeout: 5 * 60 * 1000 // 5 minute timeout
    });

    codespaceName = codespace.name;

    // Track partial state immediately
    await trackPartialDeployment(codespaceName, 'creating');

    // Wait for ready
    await waitForReady(codespace.name, { timeout: 2 * 60 * 1000 });

    // Installation
    await updateDeploymentPhase(codespaceName, 'installing');
    await installSudocode(codespace.name);

    // Configuration
    await updateDeploymentPhase(codespaceName, 'configuring');
    await configureAgentAuth(codespace.name);

    // Server startup
    await updateDeploymentPhase(codespaceName, 'starting_server');
    const port = await startServer(codespace.name);

    // Port forwarding
    await updateDeploymentPhase(codespaceName, 'port_forwarding');
    const sudocodeUrl = await setupPortForwarding(codespace.name, port);

    // Health check
    await updateDeploymentPhase(codespaceName, 'health_check');
    const healthCheckPassed = await healthCheck(sudocodeUrl, {
      retries: 10,
      interval: 2000,
      throwOnFailure: false // Don't throw, just return false
    });

    // Create deployment record
    const deployment: Deployment = {
      name: codespace.name,
      repository: await getCurrentRepo(),
      projectPath: process.cwd(),
      hostname: `${codespace.name}.github.dev`,
      port,
      createdAt: new Date().toISOString(),
      machine: options.machine || 'basicLinux32gb',
      codespaceIdleTimeout: 240,
      keepAliveDuration: parseKeepAliveDuration(options.keepAlive || '72h'),
      retentionPeriod: options.retentionPeriod || 14,
      urls: {
        codespace: codespace.url,
        sudocode: sudocodeUrl
      }
    };

    await addDeployment(deployment);

    if (!healthCheckPassed) {
      // Warning scenario - preserve Codespace
      console.warn(formatHealthCheckWarning(deployment));
      return deployment;
    }

    // Open browsers (ignore failures)
    if (options.open !== false) {
      await openBrowsers(deployment).catch(err => {
        console.warn('⚠️  Failed to open browser automatically');
      });
    }

    return deployment;

  } catch (error) {
    // Cleanup strategy based on phase
    if (codespaceName) {
      const phase = await getCurrentPhase(codespaceName);

      if (shouldDeleteCodespace(phase, error)) {
        console.log('\nCleaning up...');
        await deleteCodespace(codespaceName).catch(err => {
          console.warn(`Failed to delete Codespace: ${err.message}`);
        });
        await removeDeployment(codespaceName);
        console.log('✓ Codespace deleted\n');
      } else {
        console.warn(formatPreserveMessage(codespaceName, phase, error));
      }
    }

    throw error;
  }
}

function shouldDeleteCodespace(phase: string, error: Error): boolean {
  // Delete for infrastructure/setup failures
  const deletePhases = [
    'creating',
    'installing',
    'configuring',
    'starting_server',
    'port_forwarding'
  ];

  // Preserve for user-actionable issues
  if (error.message.includes('health check')) {
    return false; // Preserve for debugging
  }

  if (error.message.includes('browser')) {
    return false; // Browser opening not critical
  }

  return deletePhases.includes(phase);
}
```

### Signal Handling (Ctrl+C)

```typescript
let deploymentInProgress = false;
let currentCodespaceName: string | null = null;

process.on('SIGINT', async () => {
  if (!deploymentInProgress) {
    process.exit(130);
  }

  console.log('\n\nDeployment interrupted by user.\n');

  if (!currentCodespaceName) {
    console.log('No Codespace was created.');
    process.exit(130);
  }

  console.log(`Codespace created: ${currentCodespaceName}\n`);

  const choice = await promptUser(
    'What would you like to do?\n' +
    '  1) Delete Codespace and clean up\n' +
    '  2) Keep Codespace for manual configuration\n' +
    '\nChoice [1]: '
  );

  if (choice === '2') {
    console.log(`\nCodespace preserved: ${currentCodespaceName}`);
    console.log('\nTo manually continue setup:');
    console.log(`  gh codespace code --codespace ${currentCodespaceName}`);
    console.log('\nTo delete later:');
    console.log(`  sudocode deploy stop ${currentCodespaceName}`);
    process.exit(130);
  }

  console.log('\nCleaning up...');
  await deleteCodespace(currentCodespaceName);
  await removeDeployment(currentCodespaceName);
  console.log('✓ Codespace deleted');
  console.log('\nDeployment cancelled.');
  process.exit(130);
});
```

---

## Tracking Partial Deployments

### deployments.json Schema (Extended)

```json
{
  "selectedAgent": "claude-code",
  "deployments": [
    {
      "name": "codespace-abc123",
      "status": "success" | "failed" | "warning" | "partial",
      "error": "Optional error message",
      "phase": "creating" | "installing" | "configuring" | "starting_server" | "port_forwarding" | "health_check",
      "repository": "username/repo",
      "projectPath": "/Users/randy/myproject",
      "hostname": "codespace-abc123.github.dev",
      "port": 3000,
      "createdAt": "2026-01-06T12:00:00Z",
      "deletedAt": "2026-01-06T12:05:00Z",  // Only for failed/deleted
      "machine": "basicLinux32gb",
      "codespaceIdleTimeout": 240,
      "keepAliveDuration": 72,
      "retentionPeriod": 14,
      "urls": {
        "codespace": "https://codespace-abc123.github.dev",
        "sudocode": "https://codespace-abc123-3000.app.github.dev"
      }
    }
  ]
}
```

### Cleanup on Next Deploy

Before creating new Codespace, check for and clean up stale entries:

```typescript
async function cleanupStaleDeployments(): Promise<void> {
  const deployments = await listDeployments();
  const activeCodespaces = await listActiveCodespaces();

  const stale = deployments.filter(d =>
    !activeCodespaces.some(c => c.name === d.name)
  );

  for (const deployment of stale) {
    await removeDeployment(deployment.name);
  }

  if (stale.length > 0) {
    console.log(`Cleaned up ${stale.length} stale deployment(s)`);
  }
}
```

---

## Manual Recovery Steps

### Scenario: Health Check Failed, Codespace Preserved

**User wants to debug**:
```bash
# SSH into Codespace
gh codespace ssh --codespace {codespace-name}

# Check server logs
tail -100 /tmp/sudocode.log

# Check server status
curl localhost:3000

# Exit Codespace
exit
```

**User wants to delete**:
```bash
sudocode deploy stop {codespace-name}
```

---

### Scenario: npm install Failed, Codespace Deleted

**User wants to retry with logs**:
```bash
# Deploy with verbose logging (future feature)
sudocode deploy remote --verbose

# Or check GitHub status first
open https://www.githubstatus.com
open https://status.npmjs.org
```

---

### Scenario: User Interrupted, Codespace Kept

**Continue setup manually**:
```bash
# Open Codespace in VS Code
gh codespace code --codespace {codespace-name}

# Or SSH and continue from where it stopped
gh codespace ssh --codespace {codespace-name}
cd /workspaces/*
npm install
npm run build
node server/dist/cli.js start --host 0.0.0.0
```

**Delete if no longer needed**:
```bash
sudocode deploy stop {codespace-name}
```

---

## Testing Protocol

For each failure scenario:

1. **Trigger failure intentionally**
   - Use mock/stub for external commands
   - Inject errors at specific phases
   - Test with real Codespace when possible

2. **Verify cleanup behavior**
   - Check if Codespace deleted (or preserved)
   - Verify `deployments.json` state
   - Confirm user message accuracy

3. **Test manual recovery**
   - Follow manual recovery steps
   - Verify Codespace is accessible
   - Confirm deletion works

4. **Document findings**
   - Actual error messages
   - Time to cleanup
   - User experience notes

---

## Summary

### Automatic Cleanup (Delete Codespace)

- Codespace creation timeout
- npm install fails
- npm build fails
- Agent auth config fails
- Server fails to start
- Port occupied (unexpected)
- Port visibility change fails

### Manual Cleanup (Preserve Codespace)

- Health check timeout (debugging)
- Browser opening fails (non-critical)
- User interruption (ask user)

### No Cleanup Needed

- Pre-flight checks (no Codespace created)
- Codespace creation fails (creation incomplete)

### Tracking Philosophy

**Always track failures** with:
- Codespace name
- Error message
- Phase where failure occurred
- Timestamp

This provides visibility into:
- Recurring issues
- GitHub/npm outages
- Setup problems

And helps users:
- Understand what went wrong
- Know what was cleaned up
- Avoid ghost Codespaces
