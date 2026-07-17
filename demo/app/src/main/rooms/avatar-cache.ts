import { access, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

type Fetcher = (url: string) => Promise<Response>;
type Normalizer = (bytes: Buffer) => Buffer;

export class AvatarCache {
  constructor(private readonly directory: string, private readonly fetcher: Fetcher = fetch, private readonly normalize: Normalizer = (bytes) => bytes) {}

  async ensure(roomId: string, url: string): Promise<string> {
    const destination = this.path(roomId);
    try { await access(destination); return destination; }
    catch { return this.refresh(roomId, url); }
  }

  async existing(roomId: string): Promise<string | undefined> {
    const destination = this.path(roomId);
    try { return (await stat(destination)).size > 0 ? destination : undefined; }
    catch { return undefined; }
  }

  async refresh(roomId: string, url: string): Promise<string> {
    const response = await this.fetcher(url);
    if (!response.ok) throw new Error(`AVATAR_HTTP_${response.status}`);
    const bytes = this.normalize(Buffer.from(await response.arrayBuffer()));
    if (bytes.byteLength === 0 || bytes.byteLength > 5 * 1024 * 1024) throw new Error("AVATAR_SIZE_INVALID");
    await mkdir(this.directory, { recursive: true });
    const destination = this.path(roomId);
    const temporary = `${destination}.${process.pid}.tmp`;
    await writeFile(temporary, bytes, { mode: 0o600 });
    try { await rename(temporary, destination); }
    catch (error) { await rm(temporary, { force: true }); throw error; }
    return destination;
  }

  private path(roomId: string): string { return join(this.directory, `${roomId}.png`); }
}
