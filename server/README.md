# Sudocode Local Server

Local server for sudocode - providesa web UI, REST API, and WebSocket endpoints for managing specs and issues.

**THE SUDOCODE LOCAL APP SERVER IS WIP AND IS NOT YET IN A STABLE STATE**

## Features

- **REST API** - CRUD operations for issues, specs, relationships, and feedback
- **WebSocket Server** - Real-time updates for connected clients
- **File Watcher** - Automatic sync when JSONL files change
- **Static File Serving** - Serves frontend UI in production mode

## Usage

Run the sudocode companion app with `sudocode server`. You can specify a port with the `--port` option.

The server will start on `http://localhost:3000` by default.

