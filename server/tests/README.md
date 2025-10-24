# Server Tests

This directory contains tests for the sudocode server.

## Test Structure

```
tests/
├── unit/                    # Unit tests for individual modules
│   ├── issues.test.ts
│   ├── specs.test.ts
│   ├── relationships.test.ts
│   ├── feedback.test.ts
│   └── watcher.test.ts
└── integration/             # Integration tests for server features
    └── websocket.test.js    # WebSocket server integration test
```

## Running Tests

### All Tests
```bash
npm test
```

### Unit Tests
```bash
npm test
```

### Integration Tests

#### WebSocket Test
The WebSocket integration test requires the server to be running.

1. Start the server:
```bash
npm run dev
# or
npm run build && npm start
```

2. Run the WebSocket test:
```bash
node tests/integration/websocket.test.js
```

## Test Types

### Unit Tests
- Test individual services and modules in isolation
- Use TypeScript with Node.js test runner
- Located in `tests/unit/`

### Integration Tests
- Test server features end-to-end
- Require running server instance
- Located in `tests/integration/`

## WebSocket Test

The WebSocket test (`tests/integration/websocket.test.js`) verifies:
- Client connection/disconnection
- Ping/pong heartbeat
- Subscription system (subscribe/unsubscribe)
- Message protocol
- Client tracking and stats

Expected output:
```
✓ Connected to WebSocket server
✓ Ping/pong working
✓ Subscribe to all issues (issue:*)
✓ Subscribe to specific issue (issue:ISSUE-001)
✓ Subscribe to all updates (all)
✓ Unsubscribe functionality
✓ Clean disconnection
```
