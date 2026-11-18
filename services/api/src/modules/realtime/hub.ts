import type { Server } from 'socket.io';

/**
 * The rest of the API talks to connected clients only through this tiny interface, so services never depend on
 * Socket.IO and everything still works (just without live push) when no realtime server is attached — tests, the
 * worker, or a deployment that disables it. Events are always a *hint*: the database stays the source of truth and
 * clients refetch after any gap.
 */
let io: Server | null = null;
let revalidate: ((userId: string) => Promise<void>) | null = null;

export const hub = {
  attach(server: Server, onRevalidate: (userId: string) => Promise<void>): void {
    io = server;
    revalidate = onRevalidate;
  },
  detach(): void {
    io = null;
    revalidate = null;
  },
  get attached(): boolean {
    return io !== null;
  },
  toUser(userId: string, event: string, payload: unknown): void {
    io?.to(`user:${userId}`).emit(event, payload);
  },
  toConversation(conversationId: string, event: string, payload: unknown): void {
    io?.to(`conv:${conversationId}`).emit(event, payload);
  },
  /**
   * Re-check every conversation room this user's sockets are in and drop the ones they may no longer read
   * (removed from a farm, role changed). Called whenever a membership changes.
   */
  async revalidateUser(userId: string): Promise<void> {
    await revalidate?.(userId);
  },
};
