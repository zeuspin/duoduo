import { createHash } from "node:crypto";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const gzipAsync = promisify(gzip); const gunzipAsync = promisify(gunzip);
interface PackedFile { path: string; size: number; sha256: string; data: string }
interface Envelope { manifest: { version: 1; createdAt: string; files: Array<Omit<PackedFile, "data">> }; files: PackedFile[] }

export class BackupService {
  constructor(private readonly databasePath: string, private readonly avatarDirectory: string, private readonly coverDirectory: string) {}

  async exportTo(destination: string): Promise<void> {
    const files = [await packFile(this.databasePath, "duoduo.sqlite"), ...await packDirectory(this.avatarDirectory, "avatars"), ...await packDirectory(this.coverDirectory, "covers")];
    const envelope: Envelope = { manifest: { version: 1, createdAt: new Date().toISOString(), files: files.map(({ data: _data, ...item }) => item) }, files };
    await mkdir(dirname(destination), { recursive: true });
    const temporary = `${destination}.${process.pid}.tmp`;
    await writeFile(temporary, await gzipAsync(Buffer.from(JSON.stringify(envelope))), { mode: 0o600 });
    await rename(temporary, destination);
  }

  async inspect(source: string): Promise<Envelope> {
    let envelope: Envelope;
    try { envelope = JSON.parse((await gunzipAsync(await readFile(source))).toString()) as Envelope; } catch { throw new Error("BACKUP_INVALID"); }
    if (envelope.manifest?.version !== 1 || !Array.isArray(envelope.files)) throw new Error("BACKUP_VERSION_UNSUPPORTED");
    for (const file of envelope.files) {
      if (!/^(duoduo\.sqlite|avatars\/[a-zA-Z0-9_-]+\.png|covers\/[a-zA-Z0-9_-]+\.png)$/.test(file.path)) throw new Error("BACKUP_PATH_INVALID");
      const bytes = Buffer.from(file.data, "base64");
      if (bytes.byteLength !== file.size || sha(bytes) !== file.sha256) throw new Error("BACKUP_CHECKSUM_MISMATCH");
    }
    return envelope;
  }

  async stageReplace(source: string, stagingDirectory: string): Promise<string> {
    const envelope = await this.inspect(source);
    await rm(stagingDirectory, { recursive: true, force: true }); await mkdir(stagingDirectory, { recursive: true });
    for (const file of envelope.files) { const path = join(stagingDirectory, file.path); await mkdir(dirname(path), { recursive: true }); await writeFile(path, Buffer.from(file.data, "base64"), { mode: 0o600 }); }
    let database: DatabaseSync | undefined;
    try {
      database = new DatabaseSync(join(stagingDirectory, "duoduo.sqlite"), { readOnly: true });
      const integrity = database.prepare("PRAGMA integrity_check").get() as Record<string, unknown>;
      const rooms = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='rooms'").get();
      if (!Object.values(integrity).includes("ok") || !rooms) throw new Error("BACKUP_DATABASE_INVALID");
    } catch { await rm(stagingDirectory, { recursive: true, force: true }); throw new Error("BACKUP_DATABASE_INVALID"); }
    finally { database?.close(); }
    return stagingDirectory;
  }
}

async function packFile(path: string, packedPath: string): Promise<PackedFile> { const bytes = await readFile(path); return { path: packedPath, size: bytes.byteLength, sha256: sha(bytes), data: bytes.toString("base64") }; }
async function packDirectory(directory: string, prefix: string): Promise<PackedFile[]> {
  try { const entries = await readdir(directory, { withFileTypes: true }); const files: PackedFile[] = []; for (const entry of entries) if (entry.isFile() && entry.name.endsWith(".png")) files.push(await packFile(join(directory, entry.name), `${prefix}/${basename(entry.name)}`)); return files; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
function sha(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
