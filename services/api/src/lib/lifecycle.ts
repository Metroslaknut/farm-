/** Process lifecycle flags shared by the readiness endpoint and the shutdown handler. */
let shuttingDown = false;
export const lifecycle = {
  get shuttingDown(): boolean {
    return shuttingDown;
  },
  beginShutdown(): void {
    shuttingDown = true;
  },
  /** Tests only. */
  reset(): void {
    shuttingDown = false;
  },
};
