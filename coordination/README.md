# P2P Agent Coordination System

A decentralized coordination system for software development agents and developers working across distributed repositories. The system uses Git for peer discovery and libp2p+Yjs for real-time coordination.

## Architecture

The coordination system operates with three distinct layers of state:

1. **Committed State (Git Layer)** - Durable source of truth for code, issues, and specs
2. **Active Work State (CRDT Layer)** - Ephemeral real-time collaboration layer
3. **Local Draft State** - Agent's private work-in-progress

### Key Components

- **PeerDiscovery** - Git-based peer discovery using orphan coordination branch
- **P2PNetwork** - libp2p networking with TCP, WebSocket, and gossipsub
- **CRDTState** - Yjs CRDT document for ephemeral coordination state
- **YjsLibp2pSync** - Synchronization bridge between Yjs and libp2p
- **LeaseManager** - Distributed lease/locking system for conflict prevention
- **CoordinationAgent** - Main orchestrator with lifecycle management

## Installation

```bash
npm install @sudocode-ai/coordination
```

## Usage

### Basic Setup

```typescript
import { CoordinationAgent, createDefaultConfig } from '@sudocode-ai/coordination';

// Create configuration
const config = createDefaultConfig('my-agent-id', {
  capabilities: ['code', 'review', 'test'],
  coordinationBranch: 'coordination',
  leaseTTL: 300000, // 5 minutes
});

// Create and start agent
const agent = new CoordinationAgent(config);
await agent.start();

// Set active work
agent.setActiveWork({
  issues: ['#42'],
  specs: ['auth-service.md'],
  files: ['src/auth/UserService.ts'],
  status: 'Implementing OAuth token refresh',
  startedAt: Date.now(),
  metadata: { branch: 'feature/oauth' },
});

// Stop agent when done
await agent.stop();
```

### CLI Usage

The coordination system includes CLI commands accessible via the sudocode CLI:

```bash
# Start coordination agent
sudocode coord start

# Check status
sudocode coord status

# List connected peers
sudocode coord peers

# Acquire a lease on a file
sudocode coord lease src/myfile.ts --type file --priority 5

# Release a lease
sudocode coord release src/myfile.ts

# View your leases
sudocode coord leases

# Stop coordination agent
sudocode coord stop
```

### Lease Management

```typescript
import { LeaseManager } from '@sudocode-ai/coordination';

const leaseManager = agent.getLeaseManager();

// Acquire a lease
const acquired = await leaseManager.acquireLease({
  path: 'src/file.ts',
  type: 'file',
  priority: 5,
});

if (acquired) {
  console.log('Lease acquired!');
} else {
  console.log('Resource is locked by another agent');
}

// Check for conflicts before starting work
const conflicts = leaseManager.checkConflicts(
  ['src/file1.ts', 'src/file2.ts'], // files
  ['#1', '#2'], // issues
  ['specs/auth.md'] // specs
);

if (conflicts.length > 0) {
  console.log('Conflicts detected:', conflicts);
}

// Release lease
await leaseManager.releaseLease('src/file.ts');
```

### State Management

```typescript
const state = agent.getState();

// Set issue update
state.setIssueUpdate('#42', {
  agentId: 'my-agent',
  issueId: '#42',
  tempTitle: 'Add OAuth2 support (WIP: 60%)',
  tempChecklist: {
    'basic-oauth-flow': { status: 'completed', completedAt: Date.now() },
    'token-refresh': { status: 'in-progress' },
  },
  lastModified: Date.now(),
  version: 1,
});

// Get all active work from all agents
const allWork = state.getAllActiveWork();
for (const [agentId, work] of allWork) {
  console.log(`${agentId} is working on:`, work.status);
}

// Get all leases
const allLeases = state.getAllLeases();
```

## How It Works

### Peer Discovery

1. Each agent publishes connection info to `.sudocode/coordination/peers/agent-{id}.json`
2. Agents periodically fetch the coordination branch to discover peers (every 30-60s)
3. Stale peers are filtered based on TTL

### P2P Networking

1. Agents establish libp2p connections using multiaddrs from peer discovery
2. GossipSub is used for pubsub messaging
3. NAT traversal is handled via circuit relay and hole-punching

### State Synchronization

1. All coordination state is stored in a Yjs CRDT document
2. Updates are broadcast via libp2p pubsub topic `sudocode/sync`
3. New agents request initial sync using state vectors for efficiency
4. CRDT ensures automatic conflict resolution

### Lease System

1. Before modifying a resource, agents acquire a time-limited lease
2. Leases are synchronized via CRDT to all agents
3. Higher priority requests can override lower priority leases
4. Expired leases are automatically cleaned up

## Configuration Options

```typescript
interface CoordinationConfig {
  agentId: string;
  gitRemote: string; // Default: 'origin'
  coordinationBranch: string; // Default: 'coordination'
  peerDiscoveryInterval: number; // Default: 60000 (60s)
  heartbeatInterval: number; // Default: 15000 (15s)
  leaseTTL: number; // Default: 300000 (5 min)
  capabilities: string[]; // e.g., ['code', 'review', 'test']
  listenAddresses: string[]; // Default: ['/ip4/0.0.0.0/tcp/0']
  enableFileDiffs: boolean; // Default: false
}
```

## Events

The coordination agent emits events for monitoring:

```typescript
agent.getNetwork().on('peer-connected', ({ peerId }) => {
  console.log('Peer connected:', peerId);
});

agent.getLeaseManager().on('lease-acquired', ({ resource, lease }) => {
  console.log('Lease acquired:', resource);
});

agent.getLeaseManager().on('conflicts-detected', ({ conflicts }) => {
  console.log('Conflicts:', conflicts);
});
```

## Testing

```bash
# Run all tests
npm test --workspace=coordination

# Run specific test file
npm test --workspace=coordination -- tests/unit/lease-manager.test.ts

# Run tests in watch mode
npm test --workspace=coordination -- --watch
```

## Architecture Diagram

```
┌─────────────┐         ┌─────────────┐
│  Git Remote │◄────────┤ Coordination│
│  (Discovery)│  fetch  │    Agent    │
└─────────────┘         └──────┬──────┘
                               │
                    ┌──────────┼──────────┐
                    ▼          ▼          ▼
               ┌────────┐ ┌────────┐ ┌────────┐
               │ libp2p │ │  Yjs   │ │ Lease  │
               │Network │ │ CRDT   │ │Manager │
               └────────┘ └────────┘ └────────┘
                    │P2P Sync│         │
                    └────────┘         │
                         ▼             ▼
                    Real-time    Conflict
                     Updates     Detection
```

## Dependencies

- `libp2p` - P2P networking foundation
- `@libp2p/tcp`, `@libp2p/websockets` - Transport layers
- `@chainsafe/libp2p-noise` - Connection encryption
- `@chainsafe/libp2p-yamux` - Stream multiplexing
- `@chainsafe/libp2p-gossipsub` - Pubsub messaging
- `yjs` - CRDT library for state management

## Best Practices

1. **Always acquire leases before modifying resources**
   ```typescript
   const acquired = await leaseManager.acquireLease({ path: file, type: 'file' });
   if (acquired) {
     // Safe to modify
   }
   ```

2. **Check for conflicts before starting work**
   ```typescript
   const conflicts = leaseManager.checkConflicts(files, issues, specs);
   if (conflicts.length > 0) {
     // Handle conflicts
   }
   ```

3. **Update active work status regularly**
   ```typescript
   agent.setActiveWork({
     ...work,
     status: 'Making progress on feature X...',
     lastHeartbeat: Date.now(),
   });
   ```

4. **Clean up on shutdown**
   ```typescript
   process.on('SIGINT', async () => {
     await agent.stop(); // Releases all leases
     process.exit(0);
   });
   ```

## Troubleshooting

### Peers not discovering each other

- Check that coordination branch exists: `git branch -r | grep coordination`
- Verify peer info files: `git show origin/coordination:.sudocode/coordination/peers/`
- Ensure Git remote is accessible

### Cannot connect to peers

- Check firewall settings
- Try different listen addresses (WebSocket if TCP is blocked)
- Use circuit relay for NAT traversal

### Lease conflicts

- Check lease priority (higher priority can override)
- Wait for lease to expire (default 5 minutes)
- Use `sudocode coord peers` to see who holds the lease

### State not synchronizing

- Verify P2P connections: `sudocode coord peers`
- Check pubsub subscriptions in logs
- Restart agent to request fresh sync

## License

Apache-2.0
