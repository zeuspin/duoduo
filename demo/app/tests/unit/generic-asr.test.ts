import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { DuoduoStreamingAsrProvider } from "../../src/main/asr/generic-provider";

class FakeSocket extends EventEmitter {
  sent: unknown[] = [];
  readyState = 1;
  send(value: unknown) { this.sent.push(value); }
  close() { this.emit("close"); }
}

describe("DuoduoStreamingAsrProvider", () => {
  it("starts room-scoped PCM sessions and routes ASR events", async () => {
    const socket = new FakeSocket();
    const provider = new DuoduoStreamingAsrProvider({ endpoint: "wss://asr.example/ws", auth: "bearer", secret: "token" }, () => socket);
    const opening = provider.open("room-a");
    socket.emit("open");
    const session = await opening;
    const events: unknown[] = [];
    session.subscribe((event) => events.push(event));
    socket.emit("message", Buffer.from(JSON.stringify({ type: "final", room: "room-a", segment: "g1", startMs: 0, endMs: 800, text: "第一路" })));
    await session.write({ bytes: Buffer.from([1, 2]), sampleRate: 16000, channels: 1, encoding: "pcm_s16le" });
    await session.close();

    expect(JSON.parse(socket.sent[0] as string)).toMatchObject({ type: "start", room: "room-a", sampleRate: 16000 });
    expect(socket.sent[1]).toEqual(Buffer.from([1, 2]));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ roomId: "room-a", text: "第一路", isFinal: true });
  });

  it("reports an unexpected socket close as a room-local failure", async () => {
    const socket = new FakeSocket();
    const provider = new DuoduoStreamingAsrProvider({ endpoint: "wss://asr.example/ws", auth: "none" }, () => socket);
    const opening = provider.open("room-a"); socket.emit("open"); const session = await opening;
    const failures: string[] = []; session.subscribeFailure?.((error) => failures.push(error.message));
    socket.emit("close");
    expect(failures).toEqual(["ASR_SOCKET_CLOSED"]);
  });
});
