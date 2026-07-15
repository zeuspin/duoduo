import { once } from "node:events";
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { DuoduoStreamingAsrProvider } from "../../src/main/asr/generic-provider";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(closers.splice(0).map((close) => close())); });

describe("three-room ASR integration", () => {
  it("keeps three real WebSocket sessions and their text isolated", async () => {
    const server = createServer();
    const wss = new WebSocketServer({ server });
    wss.on("connection", (socket) => {
      let room = "";
      socket.on("message", (data, binary) => {
        if (!binary) {
          const event = JSON.parse(data.toString());
          if (event.type === "start") room = event.room;
          return;
        }
        socket.send(JSON.stringify({ type: "final", room, segment: "g1", startMs: 0, endMs: 500, text: `text-${room}` }));
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server address missing");
    closers.push(async () => { for (const client of wss.clients) client.terminate(); await new Promise<void>((resolve) => wss.close(() => server.close(() => resolve()))); });

    const provider = new DuoduoStreamingAsrProvider({ endpoint: `ws://127.0.0.1:${address.port}`, auth: "none" });
    const rooms = ["a", "b", "c"];
    const sessions = await Promise.all(rooms.map((room) => provider.open(room)));
    const results = new Map<string, string>();
    const received = sessions.map((session, index) => new Promise<void>((resolve) => session.subscribe((event) => { results.set(event.roomId, event.text); resolve(); })));
    await Promise.all(sessions.map((session) => session.write({ bytes: Buffer.alloc(640), sampleRate: 16000, channels: 1, encoding: "pcm_s16le" })));
    await Promise.all(received);
    expect(Object.fromEntries(results)).toEqual({ a: "text-a", b: "text-b", c: "text-c" });
    await Promise.all(sessions.map((session) => session.close()));
  });
});
