import type { BrowserWindow } from "electron";
import type { RoomProbeResult } from "./live-probe";

export interface PreparedRoomPage {
  roomId: string;
  window: BrowserWindow;
  captureToken: string;
  probe: RoomProbeResult & { status: "live" };
}

interface Lease {
  page: PreparedRoomPage;
  timer: ReturnType<typeof setTimeout>;
}

export class PreparedPageLeasePool {
  private readonly leases = new Map<string, Lease>();

  constructor(private readonly ttlMs = 180_000) {}

  put(roomId: string, page: PreparedRoomPage): void {
    this.remove(roomId);
    const timer = setTimeout(() => this.remove(roomId), this.ttlMs);
    timer.unref?.();
    this.leases.set(roomId, { page, timer });
  }

  take(roomId: string): PreparedRoomPage | undefined {
    const lease = this.leases.get(roomId);
    if (!lease) return undefined;
    this.leases.delete(roomId);
    clearTimeout(lease.timer);
    return lease.page.window.isDestroyed() ? undefined : lease.page;
  }

  remove(roomId: string): void {
    const lease = this.leases.get(roomId);
    if (!lease) return;
    this.leases.delete(roomId);
    clearTimeout(lease.timer);
    if (!lease.page.window.isDestroyed()) lease.page.window.destroy();
  }

  dispose(): void {
    for (const roomId of [...this.leases.keys()]) this.remove(roomId);
  }
}
