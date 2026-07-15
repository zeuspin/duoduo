import type { AsrEvent } from "../../shared/contracts";

export interface PcmAudioChunk {
  bytes: Buffer;
  sampleRate: 16000;
  channels: 1;
  encoding: "pcm_s16le";
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
}

export interface AsrSession {
  write(chunk: PcmAudioChunk): Promise<void>;
  close(): Promise<void>;
  subscribe(listener: (event: AsrEvent) => void): () => void;
  subscribeFailure?(listener: (error: Error) => void): () => void;
}

export interface AsrProvider {
  testConnection(): Promise<ConnectionTestResult>;
  open(roomId: string): Promise<AsrSession>;
}
