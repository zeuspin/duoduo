import { once } from "node:events";
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { DuoduoStreamingAsrProvider } from "../../src/main/asr/generic-provider";
import type { AsrSession } from "../../src/main/asr/types";
import { RoomManager, type MonitorSession } from "../../src/main/rooms/room-manager";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map((cleanup) => cleanup())); });

class ProviderSession implements MonitorSession {
  private session?: AsrSession;
  private readonly failures = new Set<(error: Error) => void>();
  constructor(private readonly provider: DuoduoStreamingAsrProvider, private readonly roomId: string) {}
  async start() { this.session = await this.provider.open(this.roomId); this.session.subscribeFailure?.((error) => { for (const listener of this.failures) listener(error); }); }
  async close() { await this.session?.close(); }
  subscribeFailure(listener: (error: Error) => void) { this.failures.add(listener); return () => this.failures.delete(listener); }
}

describe("ASR recovery integration", () => {
  it("reconnects only the socket belonging to the failed room", async () => {
    const server = createServer(); const wss = new WebSocketServer({ server });
    const connections = new Map<string, number>();
    wss.on("connection", (socket) => socket.on("message", (data, binary) => {
      if (binary) return;
      const event = JSON.parse(data.toString()); if (event.type !== "start") return;
      const count = (connections.get(event.room) ?? 0) + 1; connections.set(event.room, count);
      if (event.room === "a" && count === 1) setTimeout(() => socket.close(), 50);
    }));
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const address = server.address(); if (!address || typeof address === "string") throw new Error("address missing");
    cleanups.push(async () => { for (const client of wss.clients) client.terminate(); await new Promise<void>((resolve) => wss.close(() => server.close(() => resolve()))); });
    const provider = new DuoduoStreamingAsrProvider({ endpoint: `ws://127.0.0.1:${address.port}`, auth: "none" });
    const manager = new RoomManager(async (roomId) => new ProviderSession(provider, roomId), { retryDelayMs: 0, maxRetries: 2 });
    cleanups.push(async () => { await manager.shutdown(); });
    await Promise.all([manager.startMonitoring("a"), manager.startMonitoring("b")]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(Object.fromEntries(connections)).toEqual({ a: 2, b: 1 });
    expect(manager.snapshot().every((room) => room.state === "monitoring")).toBe(true);
  });
});
