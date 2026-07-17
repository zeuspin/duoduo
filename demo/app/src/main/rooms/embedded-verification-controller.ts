export interface VerificationBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type VerificationBlockedState = "verification_required" | "login_required" | "clear";

export interface VerificationSurface {
  loadURL(url: string): Promise<void>;
  setBounds(bounds: VerificationBounds): void;
  setVisible(visible: boolean): void;
  currentUrl(): string;
  inspectBlockedState(): Promise<VerificationBlockedState>;
  destroy(): void;
  isDestroyed(): boolean;
}

export class EmbeddedVerificationController {
  private surface: VerificationSurface | undefined;
  private bounds: VerificationBounds | undefined;
  private loadedUrl: string | undefined;
  private visibleRequested = false;
  private disposed = false;

  constructor(private readonly createSurface: () => VerificationSurface, private readonly inspectionTimeoutMs = 10_000) {}

  async show(url: string): Promise<void> {
    this.assertUsable();
    const surface = this.ensureSurface();
    if (surface.isDestroyed()) throw new Error("VERIFICATION_VIEW_LOST");
    if (this.loadedUrl !== url) {
      await surface.loadURL(url);
      this.loadedUrl = url;
    }
    this.visibleRequested = true;
    if (this.bounds) {
      surface.setBounds(this.bounds);
      surface.setVisible(true);
    }
  }

  hide(): void {
    this.assertUsable();
    this.visibleRequested = false;
    if (this.surface && !this.surface.isDestroyed()) this.surface.setVisible(false);
  }

  setBounds(bounds: VerificationBounds): void {
    this.assertUsable();
    if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isInteger) || bounds.x < 0 || bounds.y < 0 || bounds.width <= 0 || bounds.height <= 0) throw new Error("INVALID_VERIFICATION_BOUNDS");
    this.bounds = bounds;
    if (!this.surface || this.surface.isDestroyed()) return;
    this.surface.setBounds(bounds);
    if (this.visibleRequested) this.surface.setVisible(true);
  }

  currentUrl(): string {
    this.assertUsable();
    if (!this.surface || this.surface.isDestroyed()) throw new Error("VERIFICATION_VIEW_UNAVAILABLE");
    return this.surface.currentUrl();
  }

  async inspectBlockedState(): Promise<VerificationBlockedState> {
    this.assertUsable();
    if (!this.surface || this.surface.isDestroyed()) throw new Error("VERIFICATION_VIEW_UNAVAILABLE");
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.surface.inspectBlockedState(),
        new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error("VERIFICATION_CHECK_TIMEOUT")), this.inspectionTimeoutMs); }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.surface && !this.surface.isDestroyed()) this.surface.destroy();
    this.surface = undefined;
  }

  private ensureSurface(): VerificationSurface {
    if (!this.surface) this.surface = this.createSurface();
    return this.surface;
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error("VERIFICATION_VIEW_DISPOSED");
  }
}
