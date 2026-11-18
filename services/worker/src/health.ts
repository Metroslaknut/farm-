import { createServer, type Server } from 'node:http';

export interface WorkerHealthState {
  name: string;
  startedAt: number;
  shuttingDown: boolean;
}

/**
 * Optional liveness endpoint for the worker's orchestrator (GET /health). Reports only that the process is up and
 * whether it is shutting down — no configuration, no secrets. Bind it to the private network only.
 */
export function startHealthServer(port: number, state: WorkerHealthState): Promise<Server> {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/ready')) {
      const ok = !state.shuttingDown;
      res.writeHead(ok ? 200 : 503, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      res.end(
        JSON.stringify({
          status: ok ? 'ok' : 'shutting_down',
          service: state.name,
          uptimeSeconds: Math.round((Date.now() - state.startedAt) / 1000),
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolve(server));
  });
}
