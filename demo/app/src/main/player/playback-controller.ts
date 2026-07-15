export interface PlayerBounds { x: number; y: number; width: number; height: number }
export interface PlayerHandle {
  readonly roomId: string;
  load(url: string): Promise<void>;
  setMuted(value: boolean): void;
  setBounds(bounds: PlayerBounds): void;
  destroy(): void;
}

export interface PlaybackState {
  activeRoomId: string | null;
  status: "loading" | "playing" | "stopped" | "error";
  error?: string;
}

type PlayerFactory = (roomId: string) => Promise<PlayerHandle>;
type Listener = (state: PlaybackState) => void;

export class PlaybackController {
  private player?: PlayerHandle;
  private current: PlaybackState = { activeRoomId: null, status: "stopped" };
  private readonly listeners = new Set<Listener>();
  private generation = 0;

  constructor(private readonly createPlayer: PlayerFactory) {}

  async play(roomId: string, url: string): Promise<PlaybackState> {
    this.stop();
    const generation = ++this.generation;
    this.current = { activeRoomId: roomId, status: "loading" };
    this.emit();
    try {
      const player = await this.createPlayer(roomId);
      if (generation !== this.generation) { player.destroy(); return this.state(); }
      this.player = player;
      await player.load(url);
      if (generation !== this.generation) {
        if (this.player === player) { this.player = undefined; player.destroy(); }
        return this.state();
      }
      player.setMuted(false);
      this.current = { activeRoomId: roomId, status: "playing" };
    } catch (error) {
      if (generation !== this.generation) return this.state();
      this.player?.destroy();
      this.player = undefined;
      this.current = { activeRoomId: roomId, status: "error", error: error instanceof Error ? error.message : String(error) };
    }
    this.emit();
    return this.state();
  }

  stop(): PlaybackState {
    this.generation += 1;
    if (this.player) { this.player.setMuted(true); this.player.destroy(); }
    this.player = undefined;
    this.current = { activeRoomId: null, status: "stopped" };
    this.emit();
    return this.state();
  }

  setBounds(bounds: PlayerBounds): void { this.player?.setBounds(bounds); }
  state(): PlaybackState { return { ...this.current }; }
  resourceCount(): number { return this.player ? 1 : 0; }
  subscribe(listener: Listener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit(): void { const state = this.state(); for (const listener of this.listeners) listener(state); }
}
