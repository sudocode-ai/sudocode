# Sudocode Local Server

Local backend server for sudocode - provides REST API and WebSocket endpoints for managing specs and issues.

## Features

- **REST API** - CRUD operations for issues, specs, relationships, and feedback
- **WebSocket Server** - Real-time updates for connected clients
- **File Watcher** - Automatic sync when JSONL files change
- **Static File Serving** - Serves frontend UI in production mode

## Development

### Setup

```bash
# Install dependencies (from monorepo root)
npm install

# Build server
npm run build

# Start development server
npm run dev
```

The server will start on `http://localhost:3002` by default.

### Environment Variables

- `PORT` - Server port (default: 3002)
- `SUDOCODE_DB_PATH` - Path to SQLite database (default: `.sudocode/cache.db`)
- `NODE_ENV` - Environment mode (`development` or `production`)
- `WATCH` - Enable file watcher (default: true, set to `false` to disable)
- `WATCH_DEBOUNCE` - File watcher debounce delay in ms (default: 2000)
- `SYNC_JSONL_TO_MARKDOWN` - Sync JSONL to markdown on file changes (default: false)

### API Endpoints

#### Issues
- `GET /api/issues` - List all issues
- `GET /api/issues/:id` - Get issue by ID
- `POST /api/issues` - Create new issue
- `PUT /api/issues/:id` - Update issue
- `DELETE /api/issues/:id` - Delete issue

#### Specs
- `GET /api/specs` - List all specs
- `GET /api/specs/:id` - Get spec by ID
- `POST /api/specs` - Create new spec
- `PUT /api/specs/:id` - Update spec
- `DELETE /api/specs/:id` - Delete spec

#### Relationships
- `GET /api/relationships?entity_id=X&entity_type=issue` - Get relationships
- `POST /api/relationships` - Create relationship
- `DELETE /api/relationships` - Delete relationship

#### Feedback
- `GET /api/feedback?spec_id=X` - Get feedback for spec
- `GET /api/feedback/:id` - Get specific feedback
- `POST /api/feedback` - Create feedback
- `PUT /api/feedback/:id` - Update feedback
- `DELETE /api/feedback/:id` - Delete feedback

#### Other
- `GET /health` - Health check
- `GET /ws/stats` - WebSocket server statistics

### WebSocket

Connect to `ws://localhost:3002/ws` for real-time updates.

**Client Messages:**
```json
{
  "type": "subscribe",
  "channel": "issues"
}
```

**Server Messages:**
```json
{
  "type": "issue_updated",
  "data": { "id": "ISSUE-001", ... }
}
```

## Production Deployment

### Build

```bash
# Build both frontend and server
npm run build

# Or build server only
npm run build --workspace=server
```

### Run in Production

```bash
# Set NODE_ENV=production to enable frontend serving
NODE_ENV=production node dist/src/index.js
```

In production mode, the server will:
1. Serve the built frontend from `../frontend/dist`
2. Handle SPA routing (serve `index.html` for non-API routes)
3. Continue serving API and WebSocket endpoints as normal

### Production URLs

- **Frontend**: `http://localhost:3002/` (and all SPA routes)
- **API**: `http://localhost:3002/api/*`
- **WebSocket**: `ws://localhost:3002/ws`
- **Health**: `http://localhost:3002/health`

### Verification

```bash
# Check server is running
curl http://localhost:3002/health

# Check frontend is served
curl http://localhost:3002/ | head

# Check API works
curl http://localhost:3002/api/issues
```

## Development Workflow

### Development Mode (Recommended)

Run frontend and server separately for hot module replacement:

```bash
# Terminal 1: Start backend server
cd server
npm run dev

# Terminal 2: Start frontend dev server
cd frontend
npm run dev
```

Frontend dev server (port 3000) proxies API requests to backend (port 3002).

### Production Testing

Test production mode locally:

```bash
# Build everything
npm run build

# Run server in production mode
cd server
NODE_ENV=production node dist/src/index.js
```

Open `http://localhost:3002` to see the served frontend.

## Testing

```bash
# Run server tests
npm test

# Type checking
npm run typecheck
```

## Architecture

- **Express** - HTTP server framework
- **ws** - WebSocket server
- **better-sqlite3** - SQLite database
- **chokidar** - File system watcher
- **TypeScript** - Type safety

See [server_plan.md](./server_plan.md) and [ui.md](./ui.md) for detailed architecture.
