/**
 * Mock worker for testing ExecutionWorkerPool event forwarding
 *
 * This worker simulates a real execution worker but doesn't require Claude CLI.
 * It sends IPC messages to the main process to test event handling.
 */

// Validate required environment variables
const EXECUTION_ID = process.env.EXECUTION_ID;
const WORKER_ID = process.env.WORKER_ID;

if (!EXECUTION_ID || !WORKER_ID) {
  console.error('[MockWorker] Missing required environment variables');
  process.exit(1);
}

// Send IPC message to main process
function sendToMain(message: any): void {
  if (!process.send) {
    console.error('[MockWorker] IPC not available');
    return;
  }

  try {
    process.send(message);
  } catch (error) {
    console.error('[MockWorker] Failed to send IPC message:', error);
  }
}

// Simulate worker execution
async function run(): Promise<void> {
  console.log(`[MockWorker:${WORKER_ID}] Starting mock worker for ${EXECUTION_ID}`);

  // Send ready signal
  sendToMain({
    type: 'ready',
    executionId: EXECUTION_ID,
    workerId: WORKER_ID,
  });

  // Simulate some processing time
  await new Promise(resolve => setTimeout(resolve, 100));

  // Send a log event
  sendToMain({
    type: 'log',
    executionId: EXECUTION_ID,
    data: {
      type: 'log',
      data: 'Mock worker log output',
      timestamp: new Date().toISOString(),
    },
  });

  // Simulate more processing
  await new Promise(resolve => setTimeout(resolve, 100));

  // Send completion event
  sendToMain({
    type: 'complete',
    executionId: EXECUTION_ID,
    result: {
      status: 'completed',
      exitCode: 0,
      completedAt: new Date().toISOString(),
    },
  });

  console.log(`[MockWorker:${WORKER_ID}] Mock worker completed`);
}

// Run the mock worker
run()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(`[MockWorker:${WORKER_ID}] Error:`, error);
    process.exit(1);
  });
