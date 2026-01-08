# Experiment i-8mge: Backgrounded Server with Keep-Alive Findings

**Date:** 2026-01-07
**Codespace:** verbose-enigma-vrjqwprjq2p9vr
**Status:** Partially Complete (blocked on implementation)

## Experiment Goal

Validate that sudocode server functions correctly and keeps Codespace alive when running in background with `nohup`.

## Setup

### 1. Codespace Creation ✅

```bash
gh codespace create \
  --repo sudocodeai/sudocode \
  --machine basicLinux32gb \
  --idle-timeout 240m \
  --retention-period 24h
```

**Result:** Created Codespace `verbose-enigma-vrjqwprjq2p9vr`

### 2. Installation ✅

```bash
# Build from source (npm packages had build errors)
cd /workspaces/sudocode
npm run build
```

**Result:** All packages built successfully

### 3. Initialization ✅

```bash
cd /workspaces/sudocode
sudocode init
```

**Result:** Initialized with 51 specs, 503 issues

### 4. Background Server Start ✅

```bash
nohup node server/dist/cli.js --port 3000 > /tmp/sudocode-3000.log 2>&1 &
```

**Result:**
- Server started with PID: 3270
- Process confirmed running: `ps aux | grep node.*server/dist/cli.js`
- Port 3000 listening: `lsof -i:3000`
- Server accessible internally: `curl http://localhost:3000` returns HTML

## Key Findings

### 1. Background Mode Works ✅

**Finding:** The server runs successfully in background using `nohup`.

**Evidence:**
- Process continues running after backgrounding
- Logs properly redirected to `/tmp/sudocode-3000.log`
- Server responds to requests from inside Codespace
- No immediate crashes or errors

**Command that works:**
```bash
nohup node server/dist/cli.js --port 3000 > /tmp/sudocode-3000.log 2>&1 &
```

### 2. --keep-alive Flag Not Implemented ⚠️

**Finding:** The `--keep-alive` parameter doesn't exist in current codebase.

**Evidence:**
```bash
$ sudocode server --help
Usage: sudocode server [options]

Start the sudocode local server

Options:
  -p, --port <port>  Port to run server on
  -d, --detach       Run server in background
  -h, --help         display help for command
```

**Impact:**
- Cannot test keep-alive functionality as documented in experiment
- This was expected based on spec s-6z5l (Phase 1 vs Phase 2)
- Implementation needed before full validation

**Next Steps:**
- Implement `--keep-alive` flag in `cli/src/cli/server-commands.ts`
- Pass parameter to server in `server/src/index.ts`
- Implement keep-alive mechanism in server

### 3. Port Forwarding Challenges 🔍

**Finding:** GitHub Codespaces port forwarding requires manual intervention or configuration.

**Attempted approaches:**

1. **gh CLI port visibility command:**
   ```bash
   gh codespace ports visibility 3000:public --codespace <name>
   ```
   **Result:** Error - "404 Not Found" because port not yet forwarded

2. **Manual URL access:**
   ```bash
   curl https://verbose-enigma-vrjqwprjq2p9vr-3000.app.github.dev
   ```
   **Result:** HTTP 404 (connection succeeds but port not forwarded)

3. **devcontainer.json configuration:**
   Created `.devcontainer/devcontainer.json` with:
   ```json
   {
     "forwardPorts": [3000],
     "portsAttributes": {
       "3000": {
         "label": "Sudocode Server",
         "visibility": "public"
       }
     }
   }
   ```
   **Result:** Would require Codespace rebuild to take effect

**Root cause:**
- GitHub Codespaces only exposes ports that are detected by VS Code
- Detection typically happens when:
  - Port is opened WHILE VS Code web is active
  - User manually forwards port via VS Code interface
  - devcontainer.json is present BEFORE Codespace creation

**Implications for deployment:**
- `sudocode deploy remote` needs to:
  1. Create `.devcontainer/devcontainer.json` with port config BEFORE Codespace creation
  2. OR manually trigger port forwarding after server starts
  3. OR provide instructions for user to manually forward port

### 4. Server Process Stability ✅

**Finding:** Background server remains stable and responsive.

**Monitoring:**
- Process ID: 3270
- Memory usage: ~119 MB (reasonable)
- CPU usage: ~11.9% (during startup, expected to drop)
- No errors in logs
- Server startup logs show clean initialization:
  ```
  sudocode local server running on: http://localhost:3000
  WebSocket server available at: ws://localhost:3000/ws
  [watch] Watching 4 files in /workspaces/sudocode/.sudocode
  ```

## Recommendations

### For Spec s-6z5l Implementation

1. **Port Forwarding Strategy:**
   - Create `.devcontainer/devcontainer.json` BEFORE creating Codespace
   - Include port 3000 in `forwardPorts` with `"visibility": "public"`
   - This ensures port is automatically exposed when server starts

2. **Server Start Command:**
   - Use: `nohup node <path-to-server>/dist/cli.js --port 3000 --keep-alive <duration> > /tmp/sudocode-3000.log 2>&1 &`
   - Or if using global install: `nohup sudocode-server --port 3000 --keep-alive <duration> > /tmp/sudocode-3000.log 2>&1 &`
   - Capture PID to `/tmp/sudocode.pid` for later management

3. **Implementation Order:**
   - Phase 1: Add `--keep-alive` parameter support (accept but don't implement)
   - Phase 1: Add `.devcontainer/devcontainer.json` creation in deployment
   - Phase 2: Implement actual keep-alive mechanism
   - Phase 2: Run extended test (4+ hours) to validate keep-alive

4. **Verification Steps:**
   After deployment, verify:
   ```bash
   # Check process
   gh codespace ssh -- 'ps aux | grep sudocode-server'

   # Check port
   gh codespace ssh -- 'lsof -i:3000'

   # Check logs
   gh codespace ssh -- 'tail -f /tmp/sudocode-3000.log'

   # Check accessibility
   curl https://<codespace-name>-3000.app.github.dev
   ```

## What We Still Need to Test

Once `--keep-alive` is implemented:

1. **Short duration test (10 minutes):**
   - Start server with `--keep-alive 10m`
   - Monitor logs for keep-alive activity
   - Verify keep-alive stops after 10 minutes

2. **Extended duration test (4+ hours):**
   - Create Codespace with 240-minute idle timeout
   - Start server with `--keep-alive 2h`
   - Monitor keep-alive activity for 2 hours
   - Verify Codespace stays alive during keep-alive period
   - Verify keep-alive stops after 2 hours
   - Verify Codespace eventually idles and shuts down

3. **Resource usage monitoring:**
   - Check memory usage over time (watch for leaks)
   - Monitor CPU usage during keep-alive
   - Verify keep-alive mechanism is efficient

4. **Error handling:**
   - Test server crash during keep-alive
   - Test manual server stop
   - Verify cleanup and logging

## Experiment Status

- ✅ Server background mode validated
- ✅ Process stability confirmed
- ✅ Internal accessibility verified
- ⚠️ Port forwarding requires configuration approach
- ❌ Keep-alive functionality blocked on implementation
- ❌ Extended duration testing pending

## Next Steps

1. Implement `--keep-alive` parameter support in CLI and server
2. Update deployment to create `.devcontainer/devcontainer.json` before Codespace creation
3. Re-run experiment with full keep-alive implementation
4. Conduct extended test (4+ hours) to validate full lifecycle
5. Update spec s-6z5l with final findings and recommendations

## Codespace Information

- Name: `verbose-enigma-vrjqwprjq2p9vr`
- Status: Running
- Server PID: 3270
- Server Port: 3000 (internal only)
- Logs: `/tmp/sudocode-3000.log`

To clean up:
```bash
gh codespace delete --codespace verbose-enigma-vrjqwprjq2p9vr --force
```
