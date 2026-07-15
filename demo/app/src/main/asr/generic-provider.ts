import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { AsrEventSchema, type AsrEvent } from "../../shared/contracts";
import type { AsrProvider, AsrSession, ConnectionTestResult, PcmAudioChunk } from "./types";

interface SocketLike {
  readyState: number;
  on(event: string, listener: (...args: any[]) => void): this;
  send(value: string | Buffer): void;
  close(): void;
}

interface GenericProviderOptions {
  endpoint: string;
  auth: "none" | "bearer" | "x-api-key";
  secret?: string;
}

type SocketFactory = (endpoint: string, headers: Record<string, string>) => SocketLike;

function defaultSocketFactory(endpoint: string, headers: Record<string, string>): SocketLike {
  return new WebSocket(endpoint, { headers });
}

export class DuoduoStreamingAsrProvider implements AsrProvider {
  constructor(private readonly options: GenericProviderOptions, private readonly socketFactory: SocketFactory = defaultSocketFactory) {}

  async testConnection(): Promise<ConnectionTestResult> {
    const startedAt = Date.now();
    const session = await this.open(`connection-test-${randomUUID()}`);
    await session.close();
    return { ok: true, message: "连接成功", latencyMs: Date.now() - startedAt };
  }

  open(roomId: string): Promise<AsrSession> {
    const headers: Record<string, string> = {};
    if (this.options.auth === "bearer" && this.options.secret) headers.Authorization = `Bearer ${this.options.secret}`;
    if (this.options.auth === "x-api-key" && this.options.secret) headers["X-API-Key"] = this.options.secret;
    const socket = this.socketFactory(this.options.endpoint, headers);

    return new Promise((resolve, reject) => {
      const onError = (error: unknown) => reject(redactError(error, this.options.secret));
      socket.on("error", onError);
      socket.on("open", () => {
        const sessionId = randomUUID();
        socket.send(JSON.stringify({ type: "start", room: roomId, sampleRate: 16000, channels: 1, encoding: "pcm_s16le", session: sessionId }));
        resolve(new GenericAsrSession(roomId, sessionId, socket));
      });
    });
  }
}

class GenericAsrSession implements AsrSession {
  private readonly listeners = new Set<(event: AsrEvent) => void>();
  private readonly failureListeners = new Set<(error: Error) => void>();
  private closed = false;

  constructor(private readonly roomId: string, private readonly sessionId: string, private readonly socket: SocketLike) {
    socket.on("message", (data: Buffer | string) => this.handleMessage(data));
    socket.on("error", (error: unknown) => this.fail(error instanceof Error ? error : new Error(String(error))));
    socket.on("close", () => { if (!this.closed) this.fail(new Error("ASR_SOCKET_CLOSED")); });
  }

  async write(chunk: PcmAudioChunk): Promise<void> {
    if (this.closed || this.socket.readyState !== 1) throw new Error("ASR_SESSION_NOT_OPEN");
    if (chunk.sampleRate !== 16000 || chunk.channels !== 1 || chunk.encoding !== "pcm_s16le") throw new Error("INVALID_PCM_FORMAT");
    this.socket.send(chunk.bytes);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.socket.readyState === 1) this.socket.send(JSON.stringify({ type: "stop", room: this.roomId, session: this.sessionId }));
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

  private handleMessage(data: Buffer | string): void {
    try {
      const incoming = JSON.parse(Buffer.isBuffer(data) ? data.toString("utf8") : data) as Record<string, unknown>;
      if (incoming.type !== "partial" && incoming.type !== "final") return;
      const event = AsrEventSchema.parse({
        roomId: incoming.room,
        sessionId: this.sessionId,
        segmentId: incoming.segment,
        startMs: incoming.startMs,
        endMs: incoming.endMs,
        text: incoming.text,
        isFinal: incoming.type === "final",
      });
      if (event.roomId !== this.roomId) return;
      for (const listener of this.listeners) listener(event);
    } catch {
      // Invalid gateway events are isolated to this message.
    }
  }
}

function redactError(error: unknown, secret?: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(secret ? message.replaceAll(secret, "[REDACTED]") : message);
}
