import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { AsrEventSchema, type AsrEvent } from "../../shared/contracts";
import type { AsrProvider, AsrSession, ConnectionTestResult, PcmAudioChunk } from "./types";

const DEFAULT_ENDPOINT = "wss://dashscope.aliyuncs.com/api-ws/v1/inference";

interface SocketLike {
  readyState: number;
  on(event: string, listener: (...args: any[]) => void): this;
  send(value: string | Buffer): void;
  close(): void;
}

interface Options { apiKey: string; endpoint?: string }
type SocketFactory = (endpoint: string, headers: Record<string, string>) => SocketLike;

function defaultSocketFactory(endpoint: string, headers: Record<string, string>): SocketLike {
  return new WebSocket(endpoint, { headers });
}

export class BailianProvider implements AsrProvider {
  constructor(private readonly options: Options, private readonly socketFactory: SocketFactory = defaultSocketFactory) {}

  async testConnection(): Promise<ConnectionTestResult> {
    const startedAt = Date.now();
    const session = await this.open(`connection-test-${randomUUID()}`);
    await session.close();
    return { ok: true, message: "百炼连接成功", latencyMs: Date.now() - startedAt };
  }

  open(roomId: string): Promise<AsrSession> {
    const socket = this.socketFactory(this.options.endpoint ?? DEFAULT_ENDPOINT, { Authorization: `Bearer ${this.options.apiKey}`, "User-Agent": "duoduo-live/0.1" });
    const taskId = randomUUID();
    return new Promise((resolve, reject) => {
      let settled = false;
      socket.on("error", (error: unknown) => {
        if (!settled) reject(redact(error, this.options.apiKey));
      });
      socket.on("open", () => socket.send(JSON.stringify(runTask(taskId))));
      const session = new BailianSession(roomId, taskId, socket);
      socket.on("message", (data: Buffer | string) => {
        const message = parseMessage(data);
        if (!message || message.header?.task_id !== taskId) return;
        if (message.header.event === "task-started" && !settled) { settled = true; resolve(session); }
        if (message.header.event === "task-failed" && !settled) {
          settled = true;
          reject(new Error(`BAILIAN_TASK_FAILED: ${String(message.header.error_message ?? "unknown")}`));
        }
      });
    });
  }
}

class BailianSession implements AsrSession {
  private readonly listeners = new Set<(event: AsrEvent) => void>();
  private readonly failureListeners = new Set<(error: Error) => void>();
  private readonly finalSegments = new Set<string>();
  private closed = false;

  constructor(private readonly roomId: string, private readonly taskId: string, private readonly socket: SocketLike) {
    socket.on("message", (data: Buffer | string) => this.handle(data));
    socket.on("error", (error: unknown) => this.fail(error instanceof Error ? error : new Error(String(error))));
    socket.on("close", () => { if (!this.closed) this.fail(new Error("BAILIAN_SOCKET_CLOSED")); });
  }

  async write(chunk: PcmAudioChunk): Promise<void> {
    if (this.closed || this.socket.readyState !== 1) throw new Error("ASR_SESSION_NOT_OPEN");
    if (chunk.sampleRate !== 16000 || chunk.channels !== 1 || chunk.encoding !== "pcm_s16le") throw new Error("INVALID_PCM_FORMAT");
    this.socket.send(chunk.bytes);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.socket.readyState === 1) this.socket.send(JSON.stringify(finishTask(this.taskId)));
    this.socket.close();
    this.listeners.clear();
    this.failureListeners.clear();
  }

  subscribe(listener: (event: AsrEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeFailure(listener: (error: Error) => void): () => void {
    this.failureListeners.add(listener);
    return () => this.failureListeners.delete(listener);
  }

  private fail(error: Error): void { for (const listener of this.failureListeners) listener(error); }

  private handle(data: Buffer | string): void {
    const message = parseMessage(data);
    if (!message || message.header?.event !== "result-generated" || message.header.task_id !== this.taskId) return;
    const sentence = message.payload?.output?.sentence;
    if (!sentence || sentence.heartbeat || typeof sentence.text !== "string" || !sentence.text.trim()) return;
    const segmentId = `${this.taskId}:${Number(sentence.begin_time ?? 0)}`;
    const isFinal = sentence.sentence_end === true;
    if (isFinal && this.finalSegments.has(segmentId)) return;
    if (isFinal) this.finalSegments.add(segmentId);
    try {
      const event = AsrEventSchema.parse({ roomId: this.roomId, sessionId: this.taskId, segmentId, startMs: Number(sentence.begin_time ?? 0), endMs: Number(sentence.end_time ?? sentence.begin_time ?? 0), text: sentence.text, isFinal });
      for (const listener of this.listeners) listener(event);
    } catch { /* Ignore malformed service events. */ }
  }
}

function runTask(taskId: string) {
  return { header: { action: "run-task", task_id: taskId, streaming: "duplex" }, payload: { task_group: "audio", task: "asr", function: "recognition", model: "paraformer-realtime-v2", parameters: { format: "pcm", sample_rate: 16000, heartbeat: true }, input: {} } };
}

function finishTask(taskId: string) {
  return { header: { action: "finish-task", task_id: taskId, streaming: "duplex" }, payload: { input: {} } };
}

function parseMessage(data: Buffer | string): any | undefined {
  try { return JSON.parse(Buffer.isBuffer(data) ? data.toString("utf8") : data); } catch { return undefined; }
}

function redact(error: unknown, secret: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(message.replaceAll(secret, "[REDACTED]"));
}
