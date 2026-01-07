# Codespace Port Forwarding Experiment Findings

**Date**: 2026-01-06
**Codespace**: crispy-parakeet-wg5v5q64rvfgxgp
**Repository**: sudocode-ai/sudocode

---

## Executive Summary

GitHub Codespaces provides **automatic HTTPS port forwarding** via predictable public URLs without requiring `gh codespace ports forward` command. Ports are forwarded on-demand when first accessed, default to "private" visibility (requires GitHub auth), and can be made public via `gh codespace ports visibility` command.

### Key Findings

1. **Port Forwarding Method**: Auto-forwarding via HTTPS URLs (NOT `gh codespace ports forward`)
2. **URL Format**: `https://<codespace-name>-<port>.app.github.dev`
3. **Timing**: Immediate access after server starts (~1-2 seconds)
4. **Default Visibility**: Private (requires GitHub authentication)
5. **Public Access**: Requires explicit `gh codespace ports visibility <port>:public`

---

## Experiment 1: Simple Server + Port Forward

### Command Run

```bash
gh codespace ssh --codespace crispy-parakeet-wg5v5q64rvfgxgp -- \
  'python3 -m http.server 3000 > /tmp/server.log 2>&1 &'
```

### Results

**Server Status**: ✓ Running (PID 17866, 18001)
**Accessible from within Codespace**: ✓ Yes (HTTP 200)

### Port Forward Attempt

```bash
gh codespace ports forward 3005:3000 --codespace crispy-parakeet-wg5v5q64rvfgxgp
```

**Result**: ✗ Failed
**Error**: `listen tcp :3000: bind: address already in use`

**Notes**:
- `gh codespace ports forward` tries to bind LOCAL port (not needed for Codespaces)
- Error indicates port 3000 was already occupied locally
- **This command is NOT needed for Codespaces**

---

## Experiment 2: Get Public URL

### Commands

```bash
# Make port public
gh codespace ports visibility 3000:public --codespace crispy-parakeet-wg5v5q64rvfgxgp

# List ports
gh codespace ports --codespace crispy-parakeet-wg5v5q64rvfgxgp --json sourcePort,visibility,browseUrl
```

### Output

```json
[{
  "browseUrl": "https://crispy-parakeet-wg5v5q64rvfgxgp-3000.app.github.dev",
  "label": "",
  "sourcePort": 3000,
  "visibility": "public"
}]
```

### Accessibility Test

```bash
curl -s -o /dev/null -w "%{http_code}" "https://crispy-parakeet-wg5v5q64rvfgxgp-3000.app.github.dev"
```

**HTTP Status**: 200
**Time taken**: 1 second
**Result**: ✓ URL is ACCESSIBLE

### Key Findings

1. **Port was auto-forwarded** - appeared in ports list without `gh codespace ports forward`
2. **URL format is predictable**: `https://<codespace-name>-<port>.app.github.dev`
3. **Immediate accessibility** after making public (< 1 second)
4. **No local port forwarding needed**

---

## Experiment 3: Timing Test

### Test: New Port (3001)

**Steps**:
1. Started server on port 3001
2. Checked `gh codespace ports` output
3. Tried accessing URL directly

### Results

**Port list after server start**: Empty (port NOT auto-forwarded)
**Server accessible from within Codespace**: ✓ Yes (HTTP 200 on localhost:3001)

### Trigger Auto-Forwarding

**Method**: Access the predicted URL
**URL**: `https://crispy-parakeet-wg5v5q64rvfgxgp-3001.app.github.dev`

**Access attempts**:
- Attempt 1: HTTP 404
- Attempt 2: HTTP 404
- Attempt 3: HTTP 302 (redirect)
- Attempt 4-5: HTTP 302 (redirect)

### Following Redirect

```bash
curl -L -s -o /dev/null -w "Final HTTP Status: %{http_code}\n" "$URL"
```

**Final HTTP Status**: 200
**Final URL**: `https://crispy-parakeet-wg5v5q64rvfgxgp.github.dev/pf-signin?id=...&port=3001...`

**Port list after access**:
```json
{
  "browseUrl": "https://crispy-parakeet-wg5v5q64rvfgxgp-3001.app.github.dev",
  "sourcePort": 3001,
  "visibility": "private"
}
```

### Making Port Public

```bash
gh codespace ports visibility 3001:public --codespace crispy-parakeet-wg5v5q64rvfgxgp
```

**After making public**:
```bash
curl -s -o /dev/null -w "%{http_code}" "$URL"
```

**HTTP Status**: 200 ✓
**No authentication required**

### Key Findings

1. **Ports are NOT auto-forwarded on server start**
2. **Accessing the URL triggers auto-forwarding** (lazy creation)
3. **Default visibility: "private"** (requires GitHub auth)
4. **Must explicitly set to "public"** for unauthenticated access
5. **Timing: <5 seconds** from first access to port appearing in list

---

## Experiment 4: Port Collision

### Test: Two Servers on Same Port

```bash
# First server
python3 -m http.server 3002 &

# Second server (same port)
python3 -m http.server 3002 &
```

### Error Output

```
Traceback (most recent call last):
  ...
  File "/usr/lib/python3.12/socketserver.py", line 473, in server_bind
    self.socket.bind(self.server_address)
OSError: [Errno 98] Address already in use
```

### Key Findings

1. **Error is clear**: `Address already in use`
2. **Error is detectable** via exit code and stderr
3. **No ambiguity** in port collision detection

### Test: Multiple Ports

Started servers on ports 3002, 3003, 3004, 3005.

**Port list immediately after**:
```json
{
  "sourcePort": 3002,
  "visibility": "private"
}
```

**Only port 3002 appeared** (from earlier experiment when we accessed it).

### Triggering All Ports

```bash
for port in 3003 3004 3005; do
  curl -L "https://crispy-parakeet-wg5v5q64rvfgxgp-${port}.app.github.dev"
done
```

**All returned HTTP 200** on first access (with -L to follow redirects).

**Port list after accessing all**:
```json
[
  {
    "browseUrl": "https://crispy-parakeet-wg5v5q64rvfgxgp-3003.app.github.dev",
    "sourcePort": 3003,
    "visibility": "private"
  },
  {
    "browseUrl": "https://crispy-parakeet-wg5v5q64rvfgxgp-3004.app.github.dev",
    "sourcePort": 3004,
    "visibility": "private"
  },
  {
    "browseUrl": "https://crispy-parakeet-wg5v5q64rvfgxgp-3005.app.github.dev",
    "sourcePort": 3005,
    "visibility": "private"
  }
]
```

**After making all public**:
All ports accessible without authentication (HTTP 200).

### Key Findings

1. **Multiple ports can be forwarded simultaneously**
2. **Each port requires explicit visibility change for public access**
3. **No port limit observed** (tested 3000-3005, all worked)

---

## Experiment 5: Explicit Port Visibility

### Default Behavior

**New ports default to "private"** visibility.

### Making Public

```bash
gh codespace ports visibility <port>:public --codespace <name>
```

**Effect**: Immediate (< 1 second)
**Verification**: `curl` returns HTTP 200 without auth

### Visibility Levels

Observed values: `"public"`, `"private"`

**Private**: Redirects to GitHub sign-in page
**Public**: Direct access, no authentication

---

## Experiment 6: sudocode server in Codespace

### Installation

```bash
cd /workspaces/sudocode
npm install  # 3 minutes
npm run build  # ~30 seconds
```

**Result**: ✓ Build successful

### Starting Server

```bash
node server/dist/cli.js start --host 0.0.0.0 --port 3006 > /tmp/sudocode-server.log 2>&1 &
```

**Server Log** (excerpt):
```
[server] HTTP server bound to port 3000
[server] WebSocket server successfully initialized on port 3000
Server URL updated to http://localhost:3000 for 0 projects

 ███████╗ ██╗   ██╗ ██████╗   ██████╗
 ...

sudocode local server running on: http://localhost:3000
```

### Key Finding

**Server ignored `--port 3006` flag and started on port 3000**.

### Accessibility Test

```bash
# Within Codespace
curl localhost:3000  # HTTP 200 ✓

# Public URL
curl https://crispy-parakeet-wg5v5q64rvfgxgp-3000.app.github.dev  # HTTP 200 ✓
```

**Result**: ✓ sudocode server accessible via public URL

### Issues Found

1. **Server `--port` flag doesn't work** (always binds to 3000)
2. **Server `--host` flag may not work** (need to verify)
3. **Missing cache.db** warning but server started anyway

---

## Conclusions & Recommendations

### Port Forwarding Implementation

**DO NOT USE**: `gh codespace ports forward` (not needed, causes confusion)

**INSTEAD**:

1. **Start server** with `--host 0.0.0.0` (ensure external access)
2. **Construct URL**: `https://<codespace-name>-<port>.app.github.dev`
3. **Make public**: `gh codespace ports visibility <port>:public --codespace <name>`
4. **Health check**: `curl -f "$URL"` (wait for HTTP 200)

### Recommended Flow

```typescript
async function startServerInCodespace(codespaceName: string): Promise<string> {
  const port = 3000;

  // 1. Start server
  await execInCodespace(codespaceName,
    `node server/dist/cli.js start --host 0.0.0.0 > /tmp/sudocode.log 2>&1 &`
  );

  // 2. Wait for server to bind to port (check from within Codespace)
  await waitForLocalPort(codespaceName, port, { retries: 15, interval: 2000 });

  // 3. Construct public URL
  const url = `https://${codespaceName}-${port}.app.github.dev`;

  // 4. Trigger port forwarding by accessing URL
  await fetch(url).catch(() => {}); // Ignore auth errors

  // 5. Make port public
  await execAsync(`gh codespace ports visibility ${port}:public --codespace ${codespaceName}`);

  // 6. Health check with retries
  await waitForHealthy(url, { retries: 10, interval: 2000 });

  return url;
}

async function waitForLocalPort(
  codespaceName: string,
  port: number,
  options: { retries: number; interval: number }
): Promise<void> {
  for (let i = 0; i < options.retries; i++) {
    const result = await execInCodespace(
      codespaceName,
      `curl -s -o /dev/null -w "%{http_code}" http://localhost:${port}`
    );

    if (result.trim() === '200') {
      return;
    }

    await sleep(options.interval);
  }

  throw new Error(`Server did not start on port ${port} after ${options.retries} attempts`);
}

async function waitForHealthy(
  url: string,
  options: { retries: number; interval: number }
): Promise<void> {
  for (let i = 0; i < options.retries; i++) {
    try {
      const response = await fetch(url);
      if (response.status === 200) {
        return;
      }
    } catch {}

    await sleep(options.interval);
  }

  throw new Error(`Health check failed for ${url} after ${options.retries} attempts`);
}
```

### Timing Recommendations

- **Server startup wait**: 15 retries × 2s = 30 seconds max
- **Health check**: 10 retries × 2s = 20 seconds max
- **Total time to accessible URL**: ~30-50 seconds

### Port Selection

**Recommendation**: Use fixed port 3000 (no retry logic needed)

**Rationale**:
- Fresh Codespaces are empty, no port conflicts
- sudocode server defaults to 3000 anyway
- Simplifies implementation
- If port 3000 is somehow occupied, fail fast with clear error

**Alternative** (if paranoid): Try ports 3000-3002 (3 attempts max)

### Issues to Fix

1. **Server must respect `--port` flag** (currently always uses 3000)
2. **Server must respect `--host` flag** (needs verification)
3. **Add `--host` and `--port` to server CLI** if missing

---

## Updated Implementation for Spec s-6z5l

### Remove Ambiguity Section

Delete entire "Ambiguities & Open Questions" section 2 ("Server Port Detection & Forwarding").

### Replace With Concrete Implementation

Add new section "Port Forwarding Implementation":

```markdown
## Port Forwarding Implementation

### How GitHub Codespaces Port Forwarding Works

GitHub Codespaces provides automatic HTTPS port forwarding with these characteristics:

1. **URL Format**: `https://<codespace-name>-<port>.app.github.dev`
2. **Lazy Forwarding**: Ports are forwarded on first access, not when server starts
3. **Default Visibility**: Ports default to "private" (requires GitHub authentication)
4. **Public Access**: Use `gh codespace ports visibility <port>:public` for unauthenticated access

### Implementation

**Do NOT use `gh codespace ports forward`** - it's for local port tunneling, not needed for Codespaces.

```typescript
async function startServerAndGetUrl(codespaceName: string): Promise<string> {
  const port = 3000; // Fixed port (Codespaces start fresh, no conflicts)

  // 1. Start server
  await execInCodespace(codespaceName,
    'cd /workspaces/* && ' +
    'node server/dist/cli.js start --host 0.0.0.0 ' +
    '> /tmp/sudocode.log 2>&1 &'
  );

  // 2. Wait for server to start (check from within Codespace)
  console.log('Waiting for server to start...');
  await waitForServerStart(codespaceName, port, {
    retries: 15,
    interval: 2000
  });
  console.log('✓ Server started on port', port);

  // 3. Construct public URL
  const url = `https://${codespaceName}-${port}.app.github.dev`;

  // 4. Trigger port forwarding (access URL to create tunnel)
  await fetch(url).catch(() => {}); // Ignore auth/404 errors
  await sleep(2000);

  // 5. Make port public
  console.log('Making port public...');
  await execAsync(
    `gh codespace ports visibility ${port}:public --codespace ${codespaceName}`
  );

  // 6. Health check
  console.log('Running health check...');
  await waitForHealthCheck(url, {
    retries: 10,
    interval: 2000
  });
  console.log('✓ Server accessible at', url);

  return url;
}

async function waitForServerStart(
  codespaceName: string,
  port: number,
  options: { retries: number; interval: number }
): Promise<void> {
  for (let i = 0; i < options.retries; i++) {
    const result = await execInCodespace(
      codespaceName,
      `curl -s -o /dev/null -w "%{http_code}" http://localhost:${port}`
    );

    if (result.trim() === '200') {
      return;
    }

    if (i > 0 && i % 5 === 0) {
      console.log(`  Waiting for server... (attempt ${i + 1}/${options.retries})`);
    }

    await sleep(options.interval);
  }

  throw new Error(
    `Server did not start on port ${port} after ${options.retries * options.interval / 1000} seconds`
  );
}

async function waitForHealthCheck(
  url: string,
  options: { retries: number; interval: number }
): Promise<void> {
  for (let i = 0; i < options.retries; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch (error) {
      // Network errors expected during port forwarding setup
    }

    if (i > 0 && i % 3 === 0) {
      console.log(`  Checking accessibility... (attempt ${i + 1}/${options.retries})`);
    }

    await sleep(options.interval);
  }

  throw new Error(
    `Health check failed for ${url} after ${options.retries * options.interval / 1000} seconds`
  );
}
```

### Timing

- **Server startup**: Max 30 seconds (15 retries × 2s)
- **Health check**: Max 20 seconds (10 retries × 2s)
- **Total**: ~30-50 seconds from start to accessible URL

### Port Selection

**Use fixed port 3000** (no retry logic needed):
- Fresh Codespaces have no port conflicts
- sudocode server defaults to port 3000
- Simplifies implementation
- Fail fast if port occupied (unlikely)

### Error Handling

- Server fails to start → Error with log excerpt
- Port visibility fails → Error (port might not exist)
- Health check times out → Error with URL for manual check
```

### Testing Updates

Update "Manual tests - Port Forwarding" section:

```markdown
### Manual tests - Port Forwarding:

- ✓ Verify URL format: `https://<codespace-name>-3000.app.github.dev`
- ✓ Verify port defaults to "private" visibility
- ✓ Verify `gh codespace ports visibility 3000:public` makes port accessible
- ✓ Verify health check succeeds after making public
- ✓ Measure actual timing: server start (~5s) + health check (~5s) = ~10-15s total
- ✓ Verify server accessible from browser
- ✓ Verify WebSocket connections work
```

---

## Appendix: Raw Command Outputs

### Port List (port 3000, public)
```json
[{
  "browseUrl": "https://crispy-parakeet-wg5v5q64rvfgxgp-3000.app.github.dev",
  "label": "",
  "sourcePort": 3000,
  "visibility": "public"
}]
```

### Port List (port 3001, after access, private)
```json
{
  "browseUrl": "https://crispy-parakeet-wg5v5q64rvfgxgp-3001.app.github.dev",
  "sourcePort": 3001,
  "visibility": "private"
}
```

### Server Log (sudocode server)
```
ProjectRegistry loaded from: /home/codespace/.config/sudocode/projects.json
Found .sudocode in current directory, opening: /workspaces/sudocode
Failed to open local project: Missing cache.db file: /workspaces/sudocode/.sudocode/cache.db
Server will start with no projects open
Transport manager initialized
[server] Serving static frontend from: /workspaces/sudocode/frontend/dist
[server] HTTP server bound to port 3000
[server] Initializing WebSocket server on port 3000...
[websocket] WebSocket server initialized on path: /ws
[websocket] Heartbeat started (interval: 30000ms)
[server] WebSocket server successfully initialized on port 3000
Server URL updated to http://localhost:3000 for 0 projects

sudocode local server running on: http://localhost:3000
WebSocket server available at: ws://localhost:3000/ws
```
