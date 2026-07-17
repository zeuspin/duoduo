import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

type Fetcher = (url: string) => Promise<Response>;
type Normalizer = (bytes: Buffer) => Buffer;

export class CoverCache {
  constructor(private readonly directory: string, private readonly fetcher: Fetcher = fetch, private readonly normalize: Normalizer = (bytes) => bytes) {}

  async update(roomId: string, url: string): Promise<string> {
    const response = await this.fetcher(url);
    if (!response.ok) throw new Error(`COVER_HTTP_${response.status}`);
    return this.write(roomId, Buffer.from(await response.arrayBuffer()));
  }

  async updateOrFallback(roomId: string, url: string | undefined, fallback: Buffer): Promise<string> {
    if (url) {
      try { return await this.update(roomId, url); }
      catch { /* Page capture is the reliable fallback. */ }
    }
    return this.write(roomId, fallback);
  }

  async updateForStatus(roomId: string, status: "live" | "offline" | "login_required" | "verification_required" | "timeout" | "page_error", url: string | undefined, fallback: Buffer): Promise<string | undefined> {
    if (status !== "live") return undefined;
    return this.updateOrFallback(roomId, url, fallback);
  }

  async write(roomId: string, source: Buffer): Promise<string> {
    if (source.byteLength === 0 || source.byteLength > 10 * 1024 * 1024) throw new Error("COVER_SIZE_INVALID");
    const bytes = this.normalize(source);
    await mkdir(this.directory, { recursive: true });
    const destination = join(this.directory, `${roomId}.png`);
    const temporary = `${destination}.${process.pid}.tmp`;
    await writeFile(temporary, bytes, { mode: 0o600 });
    try {
      await rename(temporary, destination);
      await rm(join(this.directory, `${roomId}.jpg`), { force: true });
    } catch (error) { await rm(temporary, { force: true }); throw error; }
    return destination;
  }
}
