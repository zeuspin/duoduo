import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
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
    const meter = { duration: vi.fn(), succeed: vi.fn(), fail: vi.fn() };
    const provider = new BailianProvider({ apiKey: "test-secret", meter: () => meter }, (_endpoint, headers) => {
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
    socket.emit("message", Buffer.from(JSON.stringify({ header: { event: "result-generated", task_id: start.header.task_id }, payload: { output: { sentence: { begin_time: 120, end_time: 820, text: "独立文本", heartbeat: false, sentence_end: true } }, usage: { duration: 3 } } })));
    socket.emit("message", Buffer.from(JSON.stringify({ header: { event: "result-generated", task_id: start.header.task_id }, payload: { output: { sentence: { begin_time: 900, end_time: 1600, text: "后续文本", heartbeat: false, sentence_end: true } }, usage: { duration: 8 } } })));
    await session.write({ bytes: Buffer.from([1, 2]), sampleRate: 16000, channels: 1, encoding: "pcm_s16le" });
    const closing = session.close();
    expect(socket.readyState).toBe(1);
    socket.emit("message", Buffer.from(JSON.stringify({ header: { event: "task-finished", task_id: start.header.task_id }, payload: { output: {}, usage: null } })));
    await closing;
    expect(events[0]).toMatchObject({ roomId: "room-a", text: "独立文本", isFinal: true, startMs: 120, endMs: 820 });
    expect(socket.sent[1]).toEqual(Buffer.from([1, 2]));
    expect(JSON.parse(socket.sent[2] as string)).toMatchObject({ header: { action: "finish-task", task_id: start.header.task_id } });
    expect(meter.duration.mock.calls).toEqual([[3], [8]]);
    expect(meter.succeed).toHaveBeenCalledOnce();
  });

  it("redacts the API key from connection failures", async () => {
    const socket = new FakeSocket();
    const provider = new BailianProvider({ apiKey: "sensitive-key" }, () => socket);
    const opening = provider.open("room-a");
    socket.emit("error", new Error("rejected sensitive-key"));
    await expect(opening).rejects.not.toThrow("sensitive-key");
  });
});
