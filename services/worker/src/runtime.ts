/**
 * Minimal job runtime. No queue backend yet: Redis + BullMQ are introduced in the
 * Part that needs background processing. Jobs register here so that swap is local.
 */
export interface Job {
  name: string;
  start(): Promise<void> | void;
  stop(): Promise<void> | void;
}

export class WorkerRuntime {
  private readonly jobs = new Map<string, Job>();
  private running = false;

  constructor(readonly name: string) {}

  register(job: Job): void {
    if (this.jobs.has(job.name)) throw new Error(`Job already registered: ${job.name}`);
    this.jobs.set(job.name, job);
  }

  get jobCount(): number {
    return this.jobs.size;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    for (const job of this.jobs.values()) await job.start();
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    for (const job of [...this.jobs.values()].reverse()) await job.stop();
  }
}
