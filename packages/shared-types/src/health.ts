export type HealthStatus = 'ok';

export interface HealthResponse {
  status: HealthStatus;
  service: string;
  version: string;
  environment: string;
  /** `development`, `staging` or `production` (staging runs with production hardening). */
  deployment?: string;
  /** Build identifier (commit SHA) when the pipeline provides one. */
  commit?: string;
  uptimeSeconds: number;
  /** ISO-8601 timestamp */
  timestamp: string;
}

/** `GET /ready`: can this instance serve traffic right now? 503 when `not_ready`. Never includes error details. */
export interface ReadinessResponse {
  status: 'ready' | 'not_ready';
  checks: { database: 'up' | 'down'; shuttingDown: boolean };
  timestamp: string;
}
