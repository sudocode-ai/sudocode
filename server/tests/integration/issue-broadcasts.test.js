/**
 * Integration test for real-time issue updates via WebSocket
 * Tests CRUD operations broadcasting to subscribed clients
 */

import { WebSocket } from "ws";
import fetch from "node-fetch";

const WS_URL = "ws://localhost:3002/ws";
const API_URL = "http://localhost:3002/api/issues";

// Helper function to wait for a specific WebSocket message
function waitForMessage(ws, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout waiting for message after ${timeoutMs}ms`));
    }, timeoutMs);

    const handler = (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (predicate(message)) {
          clearTimeout(timeout);
          ws.off("message", handler);
          resolve(message);
        }
      } catch (error) {
        // Ignore parse errors
      }
    };

    ws.on("message", handler);
  });
}

// Helper to create an issue via API
async function createIssue(title, description = "Test issue") {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, description }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create issue: ${response.statusText}`);
  }

  const result = await response.json();
  return result.data;
}

// Helper to update an issue via API
async function updateIssue(id, updates) {
  const response = await fetch(`${API_URL}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    throw new Error(`Failed to update issue: ${response.statusText}`);
  }

  const result = await response.json();
  return result.data;
}

// Helper to delete an issue via API
async function deleteIssue(id) {
  const response = await fetch(`${API_URL}/${id}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(`Failed to delete issue: ${response.statusText}`);
  }

  const result = await response.json();
  return result.data;
}

async function runTests() {
  console.log("Starting issue broadcast integration tests...\n");

  const ws = new WebSocket(WS_URL);
  let testsPassed = 0;
  let testsFailed = 0;

  try {
    // Wait for connection
    await new Promise((resolve, reject) => {
      ws.on("open", resolve);
      ws.on("error", reject);
      setTimeout(() => reject(new Error("Connection timeout")), 5000);
    });
    console.log("✓ Connected to WebSocket server");

    // Subscribe to all issues
    ws.send(JSON.stringify({ type: "subscribe", entity_type: "issue" }));

    // Wait for subscription confirmation
    const subMessage = await waitForMessage(
      ws,
      (msg) => msg.type === "subscribed" && msg.subscription === "issue:*"
    );
    console.log("✓ Subscribed to all issues");
    testsPassed++;

    // Test 1: Create issue and receive broadcast
    console.log("\nTest 1: Issue creation broadcast");

    // Set up listener BEFORE creating the issue
    const createBroadcastPromise = waitForMessage(
      ws,
      (msg) => msg.type === "issue_created"
    );

    const createdIssue = await createIssue(
      "Real-time Test Issue",
      "Testing WebSocket broadcast"
    );
    console.log(`  Created issue: ${createdIssue.id}`);

    const createBroadcast = await createBroadcastPromise;
    console.log(`  ✓ Received issue_created broadcast`);
    console.log(`    Issue ID: ${createBroadcast.data.id}`);
    console.log(`    Title: ${createBroadcast.data.title}`);
    testsPassed++;

    // Test 2: Update issue and receive broadcast
    console.log("\nTest 2: Issue update broadcast");

    // Set up listener BEFORE updating
    const updateBroadcastPromise = waitForMessage(
      ws,
      (msg) =>
        msg.type === "issue_updated" && msg.data.id === createdIssue.id
    );

    await updateIssue(createdIssue.id, {
      title: "Updated Real-time Test Issue",
      status: "in_progress",
    });

    const updateBroadcast = await updateBroadcastPromise;
    console.log(`  ✓ Received issue_updated broadcast`);
    console.log(`    Updated title: ${updateBroadcast.data.title}`);
    console.log(`    Updated status: ${updateBroadcast.data.status}`);
    testsPassed++;

    // Test 3: Delete issue and receive broadcast
    console.log("\nTest 3: Issue deletion broadcast");

    // Set up listener BEFORE deleting
    const deleteBroadcastPromise = waitForMessage(
      ws,
      (msg) =>
        msg.type === "issue_deleted" && msg.data.id === createdIssue.id
    );

    await deleteIssue(createdIssue.id);

    const deleteBroadcast = await deleteBroadcastPromise;
    console.log(`  ✓ Received issue_deleted broadcast`);
    console.log(`    Deleted ID: ${deleteBroadcast.data.id}`);
    testsPassed++;

    // Test 4: Subscribe to specific issue
    console.log("\nTest 4: Specific issue subscription");

    // Set up listener for creation broadcast
    const specificCreatePromise = waitForMessage(
      ws,
      (msg) => msg.type === "issue_created"
    );

    const specificIssue = await createIssue(
      "Specific Subscription Test",
      "Testing specific issue subscription"
    );

    // First, wait for the creation broadcast from issue:* subscription
    await specificCreatePromise;

    // Subscribe to this specific issue
    ws.send(
      JSON.stringify({
        type: "subscribe",
        entity_type: "issue",
        entity_id: specificIssue.id,
      })
    );

    await waitForMessage(
      ws,
      (msg) =>
        msg.type === "subscribed" &&
        msg.subscription === `issue:${specificIssue.id}`
    );
    console.log(
      `  ✓ Subscribed to specific issue: ${specificIssue.id}`
    );

    // Set up listener BEFORE updating
    const specificUpdatePromise = waitForMessage(
      ws,
      (msg) =>
        msg.type === "issue_updated" && msg.data.id === specificIssue.id
    );

    // Update the specific issue
    await updateIssue(specificIssue.id, { priority: 0 });

    const specificUpdateBroadcast = await specificUpdatePromise;
    console.log(`  ✓ Received update for subscribed issue`);
    console.log(`    Priority changed to: ${specificUpdateBroadcast.data.priority}`);

    // Cleanup
    const cleanupDeletePromise = waitForMessage(
      ws,
      (msg) => msg.type === "issue_deleted" && msg.data.id === specificIssue.id
    );
    await deleteIssue(specificIssue.id);
    await cleanupDeletePromise;
    testsPassed++;

    console.log("\n" + "=".repeat(60));
    console.log(`All tests passed! (${testsPassed}/${testsPassed})`);
    console.log("=".repeat(60));

    ws.close();
    process.exit(0);
  } catch (error) {
    testsFailed++;
    console.error("\n✗ Test failed:", error.message);
    console.log("\n" + "=".repeat(60));
    console.log(`Tests completed: ${testsPassed} passed, ${testsFailed} failed`);
    console.log("=".repeat(60));

    ws.close();
    process.exit(1);
  }
}

// Handle Ctrl+C
process.on("SIGINT", () => {
  console.log("\n\nInterrupted. Exiting...");
  process.exit(0);
});

// Run tests
runTests();
