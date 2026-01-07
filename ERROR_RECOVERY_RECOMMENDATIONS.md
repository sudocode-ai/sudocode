# Error Recovery Recommendations for Spec s-6z5l

**Date**: 2026-01-06
**Issue**: i-ykaw - Error Recovery and Cleanup Investigation

---

## Executive Summary

Based on analysis of 18 failure scenarios across 5 deployment phases, we recommend:

1. **Automatic cleanup** for infrastructure failures (delete Codespace)
2. **Preserve Codespace** for debugging scenarios (health check timeout)
3. **Interactive prompt** for user interruption (Ctrl+C)
4. **Track all failures** in `deployments.json` for visibility

Complete failure catalog: `docs/codespace-deployment-failures.md`

---

## Key Changes to Spec s-6z5l

### 1. Remove Ambiguity Section 3 ("Error Recovery & Cleanup")

**Current text** (lines under "### 3. Error Recovery & Cleanup"):
```markdown
### 3. Error Recovery & Cleanup

**Question**: What happens if deployment partially fails?

**Decision**: Clean up Codespace on any failure

**Approach**:

- Codespace created but installation fails → Delete Codespace
- Server fails to start → Delete Codespace
- Port forwarding fails after 20 attempts → Delete Codespace
- Browser opening fails → Leave Codespace (non-critical failure)

**Implementation**: Wrap deployment in try/catch, cleanup in finally block
```

**Replace with**: Link to detailed error handling section

---

### 2. Add New Section: "Error Handling & Recovery"

Insert after "Port Forwarding Implementation" section:

```markdown
## Error Handling & Recovery

### Error Recovery Strategy

Deployment failures are handled based on the phase where failure occurs:

| Failure Type | Codespace Action | Tracking | Rationale |
|--------------|------------------|----------|-----------|
| **Pre-flight** (gh CLI, auth, git) | N/A (no Codespace) | None | User must fix environment |
| **Infrastructure** (install, build, server) | Auto-delete | Track failure | Codespace unusable, no debugging value |
| **Health check timeout** | Preserve | Track warning | May be transient, preserve for debugging |
| **Browser opening** | Preserve | Track success | Non-critical, deployment succeeded |
| **User interruption** | Ask user | Track partial | User decides: delete or debug |

### Failure Tracking

All failures (except pre-flight) are tracked in `~/.config/sudocode/deployments.json`:

```json
{
  "deployments": [
    {
      "name": "codespace-abc123",
      "status": "failed" | "warning" | "partial",
      "error": "Error description",
      "phase": "installing" | "configuring" | "starting_server" | "port_forwarding" | "health_check",
      "createdAt": "...",
      "deletedAt": "..."  // Only for auto-deleted Codespaces
    }
  ]
}
```

### Implementation Pattern

```typescript
export async function deployRemote(options: DeployOptions): Promise<Deployment> {
  let codespaceName: string | null = null;

  try {
    // Pre-flight checks (no cleanup needed if these fail)
    await checkPrerequisites();
    await ensureAgentSelected();
    await checkAuthentication();

    // Codespace creation (cleanup needed after this point)
    const codespace = await createCodespace({
      machine: options.machine || 'basicLinux32gb',
      idleTimeout: 240,
      retentionPeriod: options.retentionPeriod || 14
    });

    codespaceName = codespace.name;
    await trackPartialDeployment(codespaceName, 'creating');

    // Subsequent phases with phase tracking
    await updatePhase(codespaceName, 'installing');
    await installSudocode(codespace.name);

    await updatePhase(codespaceName, 'configuring');
    await configureAgentAuth(codespace.name);

    await updatePhase(codespaceName, 'starting_server');
    const port = await startServer(codespace.name);

    await updatePhase(codespaceName, 'port_forwarding');
    const sudocodeUrl = await setupPortForwarding(codespace.name, port);

    // Health check (non-throwing)
    await updatePhase(codespaceName, 'health_check');
    const healthCheckPassed = await healthCheck(sudocodeUrl, {
      throwOnFailure: false
    });

    const deployment = createDeploymentRecord(codespace, port, sudocodeUrl);
    await addDeployment(deployment);

    if (!healthCheckPassed) {
      console.warn(formatHealthCheckWarning(deployment));
      return deployment; // Preserve Codespace for debugging
    }

    // Open browsers (ignore failures)
    if (options.open !== false) {
      await openBrowsers(deployment).catch(() => {
        console.warn('⚠️  Failed to open browser automatically');
      });
    }

    return deployment;

  } catch (error) {
    if (codespaceName) {
      const phase = await getCurrentPhase(codespaceName);

      if (shouldAutoDelete(phase, error)) {
        console.log('\nCleaning up...');
        await deleteCodespace(codespaceName);
        await removeDeployment(codespaceName);
        console.log('✓ Codespace deleted\n');
      } else {
        console.warn(formatPreserveMessage(codespaceName, phase, error));
      }
    }

    throw error;
  }
}

function shouldAutoDelete(phase: string, error: Error): boolean {
  const autoDeletePhases = [
    'creating',
    'installing',
    'configuring',
    'starting_server',
    'port_forwarding'
  ];

  // Always preserve health check failures (for debugging)
  if (phase === 'health_check') {
    return false;
  }

  return autoDeletePhases.includes(phase);
}
```

### User Interruption Handling (Ctrl+C)

When user presses Ctrl+C after Codespace creation:

```
Deployment interrupted by user.

Codespace created: friendly-space-adventure-abc123

What would you like to do?
  1) Delete Codespace and clean up
  2) Keep Codespace for manual configuration

Choice [1]:
```

**Implementation**:

```typescript
process.on('SIGINT', async () => {
  if (!currentCodespaceName) {
    process.exit(130);
  }

  console.log('\n\nDeployment interrupted by user.\n');
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
  console.log('✓ Codespace deleted\n');
  process.exit(130);
});
```

### Error Messages

#### Infrastructure Failure (Auto-Delete)

Example: npm install fails

```
✗ Failed to install sudocode packages

Codespace: friendly-space-adventure-abc123

Error log:
npm ERR! code ENOTFOUND
npm ERR! network request to https://registry.npmjs.org/... failed
...

Cleaning up...
✓ Codespace deleted

This is likely a transient npm registry issue. Please retry:
  sudocode deploy remote
```

#### Health Check Timeout (Preserve)

```
⚠️  Health check timed out

Codespace: friendly-space-adventure-abc123
URL: https://friendly-space-adventure-abc123-3000.app.github.dev

Server appears to be running, but health check failed after 20 seconds.

Codespace has been PRESERVED for debugging.

Manual steps:
  1. Check server logs:
       gh codespace ssh --codespace friendly-space-adventure-abc123 -- \
         'tail -50 /tmp/sudocode.log'

  2. Try accessing URL manually:
       https://friendly-space-adventure-abc123-3000.app.github.dev

  3. If server is working, ignore this warning

  4. To delete Codespace:
       sudocode deploy stop friendly-space-adventure-abc123

Deployment tracked for reference.
```

#### Pre-flight Failure (No Cleanup)

Example: GitHub CLI not found

```
✗ GitHub CLI not found

Please install GitHub CLI:
  - macOS: brew install gh
  - Linux: See https://cli.github.com/manual/installation
  - Windows: winget install --id GitHub.cli

After installing, run: gh auth login
```

### Manual Recovery

For preserved Codespaces, users can:

**Debug via SSH**:
```bash
gh codespace ssh --codespace <name> -- 'tail -100 /tmp/sudocode.log'
```

**Open in VS Code**:
```bash
gh codespace code --codespace <name>
```

**Delete when done**:
```bash
sudocode deploy stop <name>
```

### Stale Deployment Cleanup

Before creating new Codespace, clean up stale tracking entries:

```typescript
async function cleanupStaleDeployments(): Promise<void> {
  const tracked = await listDeployments();
  const active = await listActiveCodespaces(); // Via gh CLI

  const stale = tracked.filter(d =>
    !active.some(c => c.name === d.name)
  );

  for (const deployment of stale) {
    await removeDeployment(deployment.name);
  }

  if (stale.length > 0) {
    console.log(`Cleaned up ${stale.length} stale deployment(s)`);
  }
}
```

### Complete Failure Scenarios

See `docs/codespace-deployment-failures.md` for:
- 18 detailed failure scenarios
- Cleanup decision for each
- User messages for each
- Manual recovery steps
- Testing protocol
```

---

### 3. Update Implementation Checklist

**Add to Phase 1 checklist** (under "Deployment Commands"):

```markdown
- Error handling with phase-based cleanup:
  - Track deployment phase (creating, installing, configuring, etc.)
  - Auto-delete Codespace for infrastructure failures
  - Preserve Codespace for health check timeout
  - Interactive prompt for user interruption (Ctrl+C)
  - Track all failures in deployments.json
  - Clean up stale deployments on next deploy
```

**Add to Phase 1 checklist** (under "Server Updates"):

```markdown
- Signal handling:
  - Handle SIGINT/SIGTERM gracefully
  - Prompt user to delete or preserve Codespace
  - Clean up on user choice
```

---

### 4. Update Testing Section

**Replace "Manual tests - Ambiguity validation" with**:

```markdown
### Manual tests - Error handling:

**Infrastructure failures** (should auto-delete):
- Simulate npm install failure → Verify Codespace deleted
- Simulate npm build failure → Verify Codespace deleted
- Simulate server startup failure → Verify Codespace deleted
- Simulate port visibility failure → Verify Codespace deleted

**Debugging scenarios** (should preserve):
- Simulate health check timeout → Verify Codespace preserved
- Verify user can access preserved Codespace
- Verify error message includes manual recovery steps

**User interruption**:
- Press Ctrl+C before Codespace creation → No cleanup needed
- Press Ctrl+C after Codespace creation → Interactive prompt shown
- Choose option 1 (delete) → Verify Codespace deleted
- Choose option 2 (keep) → Verify Codespace preserved with instructions

**Failure tracking**:
- Trigger failure → Verify entry in deployments.json
- Verify entry includes: name, status, error, phase, timestamps
- Run `sudocode deploy list` → Verify failed deployments shown
- Clean up stale entries → Verify removed from deployments.json

**Pre-flight failures** (no cleanup):
- Run without gh CLI → Verify clean exit with instructions
- Run without auth → Verify clean exit with instructions
- Run without token → Verify clean exit with instructions
```

---

### 5. Update Success Criteria

**Add**:

```markdown
14. ✅ Infrastructure failures trigger automatic Codespace cleanup
15. ✅ Health check timeout preserves Codespace for debugging
16. ✅ User interruption (Ctrl+C) prompts for cleanup decision
17. ✅ All failures tracked in deployments.json with phase information
18. ✅ Error messages include manual recovery steps
19. ✅ Stale deployments cleaned up before new deployment
```

---

## Deployment Schema Updates

### Extended deployments.json

```typescript
interface Deployment {
  name: string;
  status: 'success' | 'failed' | 'warning' | 'partial';
  error?: string;  // Present for failed/warning/partial
  phase?: 'creating' | 'installing' | 'configuring' | 'starting_server' |
          'port_forwarding' | 'health_check';
  repository: string;
  projectPath: string;
  hostname: string;
  port: number;
  createdAt: string;
  deletedAt?: string;  // Present for auto-deleted Codespaces
  machine: string;
  codespaceIdleTimeout: number;
  keepAliveDuration: number;
  retentionPeriod: number;
  urls: {
    codespace: string;
    sudocode: string;
  };
}
```

---

## File Updates Required

### New Files

1. `docs/codespace-deployment-failures.md` ✅ (created)
   - Complete failure catalog
   - 18 detailed scenarios
   - Cleanup decisions
   - User messages
   - Recovery steps

### Files to Update

1. **Spec `s-6z5l`** (via feedback):
   - Remove "Error Recovery & Cleanup" ambiguity section
   - Add "Error Handling & Recovery" section
   - Update implementation checklist
   - Update testing section
   - Update success criteria

2. **`types/src/index.d.ts`**:
   - Add `status`, `error`, `phase`, `deletedAt` to Deployment interface

3. **`cli/src/deploy/codespaces.ts`**:
   - Implement phase tracking
   - Implement cleanup logic
   - Implement signal handlers
   - Implement health check with `throwOnFailure: false`

4. **`cli/src/deploy/config/deployments.ts`**:
   - Add `updateDeploymentPhase()` function
   - Add `trackPartialDeployment()` function
   - Add `cleanupStaleDeployments()` function

---

## Testing Strategy

### Unit Tests

```typescript
describe('Error Recovery', () => {
  test('infrastructure failure triggers auto-delete', async () => {
    // Mock npm install failure
    // Verify deleteCodespace called
    // Verify deployment tracked with status: 'failed'
  });

  test('health check timeout preserves Codespace', async () => {
    // Mock health check timeout
    // Verify deleteCodespace NOT called
    // Verify deployment tracked with status: 'warning'
  });

  test('user interruption prompts for cleanup', async () => {
    // Simulate SIGINT
    // Verify prompt shown
    // Mock user choice
    // Verify cleanup based on choice
  });

  test('stale deployments cleaned up', async () => {
    // Mock deployments.json with stale entries
    // Mock gh codespace list (no matching Codespaces)
    // Run cleanupStaleDeployments()
    // Verify stale entries removed
  });
});
```

### Integration Tests

```typescript
describe('Deployment Error Scenarios', () => {
  test('npm install fails - Codespace deleted', async () => {
    // Create real Codespace (test environment)
    // Inject npm install failure
    // Verify Codespace deleted via gh CLI
    // Verify deployments.json entry
  });

  test('health check timeout - Codespace preserved', async () => {
    // Create Codespace
    // Start server (real)
    // Mock health check to timeout
    // Verify Codespace still exists
    // Manual cleanup
  });
});
```

---

## Summary of Recommendations

### ✅ Approved Decisions

1. **Auto-delete** for infrastructure failures:
   - npm install/build failures
   - Server startup failures
   - Port forwarding failures
   - Agent config failures

2. **Preserve** for debugging scenarios:
   - Health check timeout (server may be working)
   - Browser opening failure (non-critical)

3. **Interactive** for user interruption:
   - Prompt user to delete or keep
   - Default to delete

4. **Track all failures**:
   - Store in `deployments.json`
   - Include phase, error, timestamps
   - Clean up stale entries

5. **Clear error messages**:
   - Show what failed
   - Show what was cleaned up
   - Provide manual recovery steps
   - Link to GitHub issues when appropriate

### 📋 Implementation Checklist

- [x] Create failure catalog document
- [ ] Update spec s-6z5l via feedback
- [ ] Update TypeScript types
- [ ] Implement phase tracking
- [ ] Implement cleanup logic
- [ ] Implement signal handlers
- [ ] Write unit tests
- [ ] Write integration tests
- [ ] Test with real Codespace
- [ ] Document in README

### 🎯 Next Steps

1. Review this document
2. Provide feedback on spec s-6z5l
3. Begin implementation in Phase 1
4. Test each failure scenario
5. Document actual error messages
6. Iterate based on testing
