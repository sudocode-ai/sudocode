import * as net from "net";

const DEFAULT_PORT_RANGE_START = 3000;
const DEFAULT_PORT_RANGE_END = 3100;

/**
 * Checks if a port is available by attempting to create a server on it
 */
async function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        resolve(false);
      } else {
        // Some other error - treat as unavailable
        resolve(false);
      }
    });

    server.once("listening", () => {
      server.close(() => {
        resolve(true);
      });
    });

    server.listen(port, "127.0.0.1");
  });
}

/**
 * Finds an available port within the specified range
 * @param start Start of port range (inclusive)
 * @param end End of port range (inclusive)
 * @returns First available port in range
 * @throws Error if no port is available in the range
 */
export async function findAvailablePort(
  start: number = DEFAULT_PORT_RANGE_START,
  end: number = DEFAULT_PORT_RANGE_END
): Promise<number> {
  for (let port = start; port <= end; port++) {
    const available = await checkPort(port);
    if (available) {
      return port;
    }
  }
  throw new Error(`No available port found in range ${start}-${end}`);
}

/**
 * Waits for a port to be open (server accepting connections)
 * Useful for waiting for the server to fully start
 * @param port Port to check
 * @param timeout Maximum time to wait in milliseconds
 * @param interval Check interval in milliseconds
 * @returns true if port opened within timeout, false otherwise
 */
export async function waitForPort(
  port: number,
  timeout: number = 30000,
  interval: number = 100
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      const isOpen = await new Promise<boolean>((resolve) => {
        const socket = new net.Socket();

        socket.once("connect", () => {
          socket.destroy();
          resolve(true);
        });

        socket.once("error", () => {
          socket.destroy();
          resolve(false);
        });

        socket.connect(port, "127.0.0.1");
      });

      if (isOpen) {
        return true;
      }
    } catch {
      // Connection failed, will retry
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  return false;
}

export { DEFAULT_PORT_RANGE_START, DEFAULT_PORT_RANGE_END };
