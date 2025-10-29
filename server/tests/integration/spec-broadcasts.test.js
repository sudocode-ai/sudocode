/**
 * Integration test for real-time spec updates via WebSocket
 * Tests CRUD operations broadcasting to subscribed clients
 */

import { WebSocket } from "ws";
import fetch from "node-fetch";

const WS_URL = "ws://localhost:3002/ws";
const API_URL = "http://localhost:3002/api/specs";

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

// Helper to create a spec via API
async function createSpec(title, content = "Test spec content") {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, content }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create spec: ${response.statusText}`);
  }

  const result = await response.json();
  return result.data;
}

// Helper to update a spec via API
async function updateSpec(id, updates) {
  const response = await fetch(`${API_URL}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    throw new Error(`Failed to update spec: ${response.statusText}`);
  }

  const result = await response.json();
  return result.data;
}

// Helper to delete a spec via API
async function deleteSpec(id) {
  const response = await fetch(`${API_URL}/${id}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(`Failed to delete spec: ${response.statusText}`);
  }

  const result = await response.json();
  return result.data;
}

async function runTests() {
  console.log("Starting spec broadcast integration tests...\n");

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

    // Subscribe to all specs
    ws.send(JSON.stringify({ type: "subscribe", entity_type: "spec" }));

    // Wait for subscription confirmation
    const subMessage = await waitForMessage(
      ws,
      (msg) => msg.type === "subscribed" && msg.subscription === "spec:*"
    );
    console.log("✓ Subscribed to all specs");
    testsPassed++;

    // Test 1: Create spec and receive broadcast
    console.log("\nTest 1: Spec creation broadcast");

    // Set up listener BEFORE creating the spec
    const createBroadcastPromise = waitForMessage(
      ws,
      (msg) => msg.type === "spec_created"
    );

    const createdSpec = await createSpec(
      "Real-time Test Spec",
      "Testing WebSocket broadcast for specs"
    );
    console.log(`  Created spec: ${createdSpec.id}`);

    const createBroadcast = await createBroadcastPromise;
    console.log(`  ✓ Received spec_created broadcast`);
    console.log(`    Spec ID: ${createBroadcast.data.id}`);
    console.log(`    Title: ${createBroadcast.data.title}`);
    testsPassed++;

    // Test 2: Update spec and receive broadcast
    console.log("\nTest 2: Spec update broadcast");

    // Set up listener BEFORE updating
    const updateBroadcastPromise = waitForMessage(
      ws,
      (msg) =>
        msg.type === "spec_updated" && msg.data.id === createdSpec.id
    );

    await updateSpec(createdSpec.id, {
      title: "Updated Real-time Test Spec",
      priority: 1,
    });

    const updateBroadcast = await updateBroadcastPromise;
    console.log(`  ✓ Received spec_updated broadcast`);
    console.log(`    Updated title: ${updateBroadcast.data.title}`);
    console.log(`    Updated priority: ${updateBroadcast.data.priority}`);
    testsPassed++;

    // Test 3: Delete spec and receive broadcast
    console.log("\nTest 3: Spec deletion broadcast");

    // Set up listener BEFORE deleting
    const deleteBroadcastPromise = waitForMessage(
      ws,
      (msg) =>
        msg.type === "spec_deleted" && msg.data.id === createdSpec.id
    );

    await deleteSpec(createdSpec.id);

    const deleteBroadcast = await deleteBroadcastPromise;
    console.log(`  ✓ Received spec_deleted broadcast`);
    console.log(`    Deleted ID: ${deleteBroadcast.data.id}`);
    testsPassed++;

    // Test 4: Subscribe to specific spec
    console.log("\nTest 4: Specific spec subscription");

    // Set up listener for creation broadcast
    const specificCreatePromise = waitForMessage(
      ws,
      (msg) => msg.type === "spec_created"
    );

    const specificSpec = await createSpec(
      "Specific Subscription Test",
      "Testing specific spec subscription"
    );

    // First, wait for the creation broadcast from spec:* subscription
    await specificCreatePromise;

    // Subscribe to this specific spec
    ws.send(
      JSON.stringify({
        type: "subscribe",
        entity_type: "spec",
        entity_id: specificSpec.id,
      })
    );

    await waitForMessage(
      ws,
      (msg) =>
        msg.type === "subscribed" &&
        msg.subscription === `spec:${specificSpec.id}`
    );
    console.log(
      `  ✓ Subscribed to specific spec: ${specificSpec.id}`
    );

    // Set up listener BEFORE updating
    const specificUpdatePromise = waitForMessage(
      ws,
      (msg) =>
        msg.type === "spec_updated" && msg.data.id === specificSpec.id
    );

    // Update the specific spec
    await updateSpec(specificSpec.id, { priority: 0 });

    const specificUpdateBroadcast = await specificUpdatePromise;
    console.log(`  ✓ Received update for subscribed spec`);
    console.log(`    Priority changed to: ${specificUpdateBroadcast.data.priority}`);

    // Cleanup
    const cleanupDeletePromise = waitForMessage(
      ws,
      (msg) => msg.type === "spec_deleted" && msg.data.id === specificSpec.id
    );
    await deleteSpec(specificSpec.id);
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
