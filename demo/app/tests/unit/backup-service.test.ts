import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BackupService } from "../../src/main/storage/backup-service";

describe("BackupService", () => {
  it("round-trips the database and durable room images", async () => {
    const root = await mkdtemp(join(tmpdir(), "duoduo-backup-"));
    await writeFile(join(root, "duoduo.sqlite"), "sqlite-data");
    const avatars = join(root, "avatars"); const covers = join(root, "covers");
    const { mkdir } = await import("node:fs/promises"); await mkdir(avatars); await mkdir(covers);
    await writeFile(join(avatars, "123.png"), "avatar"); await writeFile(join(covers, "123.png"), "cover");
    const service = new BackupService(join(root, "duoduo.sqlite"), avatars, covers);
    const destination = join(root, "full.duoduo-backup");
    await service.exportTo(destination);
    const inspected = await service.inspect(destination);
    expect(inspected.manifest.version).toBe(1);
    expect(inspected.files.map((file) => file.path).sort()).toEqual(["avatars/123.png", "covers/123.png", "duoduo.sqlite"]);
  });

  it("rejects a tampered backup", async () => {
    const root = await mkdtemp(join(tmpdir(), "duoduo-backup-"));
    await writeFile(join(root, "duoduo.sqlite"), "sqlite-data");
    const service = new BackupService(join(root, "duoduo.sqlite"), join(root, "avatars"), join(root, "covers"));
    const destination = join(root, "full.duoduo-backup");
    await service.exportTo(destination);
    const bytes = await readFile(destination); bytes[bytes.length - 2] ^= 1; await writeFile(destination, bytes);
    await expect(service.inspect(destination)).rejects.toThrow();
  });

  it("rejects restore when the packaged database is not valid SQLite", async () => {
    const root = await mkdtemp(join(tmpdir(), "duoduo-backup-"));
    await writeFile(join(root, "duoduo.sqlite"), "not-a-sqlite-database");
    const service = new BackupService(join(root, "duoduo.sqlite"), join(root, "avatars"), join(root, "covers"));
    const destination = join(root, "full.duoduo-backup"); await service.exportTo(destination);
    await expect(service.stageReplace(destination, join(root, "staging"))).rejects.toThrow("BACKUP_DATABASE_INVALID");
  });
});
