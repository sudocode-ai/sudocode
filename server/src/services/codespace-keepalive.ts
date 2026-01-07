import * as http from 'http';

export class CodespaceKeepAlive {
  private server: http.Server | null = null;
  private timer: NodeJS.Timeout | null = null;
  private endTime: number;

  constructor(
    private durationHours: number,
    private port: number = 8765
  ) {
    this.endTime = Date.now() + durationHours * 60 * 60 * 1000;
  }

  async start(): Promise<void> {
    // Start minimal HTTP server for keep-alive pings
    this.server = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end('alive');
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.port, 'localhost', () => resolve());
      this.server!.on('error', reject);
    });

    console.log(
      `[KeepAlive] Started on localhost:${this.port}, duration: ${this.durationHours}h`
    );

    // Ping every 60 seconds (well below 240-minute GitHub max timeout)
    this.timer = setInterval(async () => {
      if (Date.now() > this.endTime) {
        this.stop();
        return;
      }

      try {
        await fetch(`http://localhost:${this.port}/health`);
        console.log(`[KeepAlive] Pinged at ${new Date().toISOString()}`);
      } catch (err) {
        console.warn('[KeepAlive] Ping failed:', (err as Error).message);
      }
    }, 60000); // 1 minute interval
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    console.log('[KeepAlive] Stopped');
  }
}
