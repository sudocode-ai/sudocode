/**
 * Simple WebSocket client test script
 * Usage: node test-websocket.js
 */

import { WebSocket } from "ws";

const WS_URL = "ws://localhost:3002/ws";

console.log(`Connecting to ${WS_URL}...`);

const ws = new WebSocket(WS_URL);

ws.on("open", () => {
  console.log("✓ Connected to WebSocket server");

  // Test 1: Ping
  console.log("\nTest 1: Sending ping...");
  ws.send(JSON.stringify({ type: "ping" }));

  // Test 2: Subscribe to all issues
  setTimeout(() => {
    console.log("\nTest 2: Subscribing to all issues...");
    ws.send(
      JSON.stringify({
        type: "subscribe",
        entity_type: "issue",
      })
    );
  }, 1000);

  // Test 3: Subscribe to a specific issue
  setTimeout(() => {
    console.log("\nTest 3: Subscribing to specific issue...");
    ws.send(
      JSON.stringify({
        type: "subscribe",
        entity_type: "issue",
        entity_id: "ISSUE-001",
      })
    );
  }, 2000);

  // Test 4: Subscribe to all updates
  setTimeout(() => {
    console.log("\nTest 4: Subscribing to all updates...");
    ws.send(
      JSON.stringify({
        type: "subscribe",
        entity_type: "all",
      })
    );
  }, 3000);

  // Test 5: Unsubscribe from specific issue
  setTimeout(() => {
    console.log("\nTest 5: Unsubscribing from specific issue...");
    ws.send(
      JSON.stringify({
        type: "unsubscribe",
        entity_type: "issue",
        entity_id: "ISSUE-001",
      })
    );
  }, 4000);

  // Close connection after tests
  setTimeout(() => {
    console.log("\n\nTests complete. Closing connection...");
    ws.close();
  }, 5000);
});

ws.on("message", (data) => {
  const message = JSON.parse(data.toString());
  console.log("← Received:", JSON.stringify(message, null, 2));
});

ws.on("close", () => {
  console.log("\n✓ Connection closed");
  process.exit(0);
});

ws.on("error", (error) => {
  console.error("✗ WebSocket error:", error.message);
  process.exit(1);
});

// Handle Ctrl+C
process.on("SIGINT", () => {
  console.log("\n\nInterrupted. Closing connection...");
  ws.close();
  process.exit(0);
});
