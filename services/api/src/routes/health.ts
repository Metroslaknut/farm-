import { Router } from 'express';
import mongoose from 'mongoose';
import type { HealthResponse, ReadinessResponse } from '@farmplus/shared-types';
import { deployEnvOf, type ApiEnv } from '@farmplus/config/server';
import { lifecycle } from '../lib/lifecycle';
import { SERVICE_NAME, SERVICE_VERSION } from '../service-info';

/**
 * LIVENESS — "is the process running?" Cheap and dependency-free on purpose: if this fails the orchestrator restarts the
 * instance, so it must never fail because the database is slow (that would turn a database blip into a restart storm).
 * Mounted at `/health` and `/api/v1/health`.
 */
export function healthRouter(env: ApiEnv): Router {
  const router = Router();
  router.get('/', (_req, res) => {
    const body: HealthResponse = {
      status: 'ok',
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      environment: env.NODE_ENV,
      deployment: deployEnvOf(env),
      ...(env.GIT_SHA ? { commit: env.GIT_SHA } : {}),
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
    res.json(body);
  });
  return router;
}

const PING_TIMEOUT_MS = 2000;

async function databaseUp(): Promise<boolean> {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) return false;
  try {
    await Promise.race([
      mongoose.connection.db.admin().ping(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), PING_TIMEOUT_MS).unref(),
      ),
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * READINESS — "should the load balancer send traffic here?" Fails (503) when the database is unreachable or the instance
 * has begun shutting down, so traffic drains before the process exits. Reveals only up/down, never error text.
 * Mounted at `/ready` and `/api/v1/ready`.
 */
export function readinessRouter(): Router {
  const router = Router();
  router.get('/', async (_req, res) => {
    const database = (await databaseUp()) ? 'up' : 'down';
    const shuttingDown = lifecycle.shuttingDown;
    const ready = database === 'up' && !shuttingDown;
    const body: ReadinessResponse = {
      status: ready ? 'ready' : 'not_ready',
      checks: { database, shuttingDown },
      timestamp: new Date().toISOString(),
    };
    res.status(ready ? 200 : 503).json(body);
  });
  return router;
}
