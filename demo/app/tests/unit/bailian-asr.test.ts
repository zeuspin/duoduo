import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { BailianProvider } from "../../src/main/asr/bailian-provider";

class FakeSocket extends EventEmitter {
  sent: unknown[] = [];
  readyState = 1;
  send(value: unknown) { this.sent.push(value); }
  close() { this.readyState = 3; this.emit("close"); }
}

describe("BailianProvider", () => {
  it("waits for task-started, sends PCM, and maps result-generated", async () => {
    const socket = new FakeSocket();
    const provider = new BailianProvider({ apiKey: "test-secret" }, (_endpoint, headers) => {
      expect(headers.Authorization).toBe("Bearer test-secret");
      return socket;
    });
    const opening = provider.open("room-a");
    socket.emit("open");
    const start = JSON.parse(socket.sent[0] as string);
    expect(start).toMatchObject({ header: { action: "run-task" }, payload: { model: "paraformer-realtime-v2", parameters: { format: "pcm", sample_rate: 16000 } } });
    socket.emit("message", Buffer.from(JSON.stringify({ header: { event: "task-started", task_id: start.header.task_id }, payload: {} })));
    const session = await opening;
    const events: unknown[] = [];
    session.subscribe((event) => events.push(event));
    socket.emit("message", Buffer.from(JSON.stringify({ header: { event: "result-generated", task_id: start.header.task_id }, payload: { output: { sentence: { begin_time: 120, end_time: 820, text: "独立文本", heartbeat: false, sentence_end: true } } } })));
    await session.write({ bytes: Buffer.from([1, 2]), sampleRate: 16000, channels: 1, encoding: "pcm_s16le" });
    await session.close();
    expect(events[0]).toMatchObject({ roomId: "room-a", text: "独立文本", isFinal: true, startMs: 120, endMs: 820 });
    expect(socket.sent[1]).toEqual(Buffer.from([1, 2]));
    expect(JSON.parse(socket.sent[2] as string)).toMatchObject({ header: { action: "finish-task", task_id: start.header.task_id } });
  });

  it("redacts the API key from connection failures", async () => {
    const socket = new FakeSocket();
    const provider = new BailianProvider({ apiKey: "sensitive-key" }, () => socket);
    const opening = provider.open("room-a");
    socket.emit("error", new Error("rejected sensitive-key"));
    await expect(opening).rejects.not.toThrow("sensitive-key");
  });
});
