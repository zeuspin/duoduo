import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CoverCache } from "../../src/main/rooms/cover-cache";

describe("CoverCache", () => {
  it("atomically replaces the single cover kept for a room", async () => {
    const directory = await mkdtemp(join(tmpdir(), "duoduo-covers-"));
    let body = "first";
    const cache = new CoverCache(directory, async () => new Response(body, { headers: { "content-type": "image/jpeg" } }));
    const first = await cache.update("123", "https://example.com/cover.jpg");
    body = "second";
    const second = await cache.update("123", "https://example.com/cover-new.jpg");
    expect(first).toBe(second);
    expect(await readFile(second, "utf8")).toBe("second");
    expect(await readdir(directory)).toEqual(["123.png"]);
  });

  it("stores a captured page when the remote cover cannot be fetched", async () => {
    const directory = await mkdtemp(join(tmpdir(), "duoduo-covers-"));
    const cache = new CoverCache(directory, async () => new Response(null, { status: 404 }));
    const path = await cache.updateOrFallback("456", "https://example.com/missing.jpg", Buffer.from("captured-page"));
    expect(await readFile(path, "utf8")).toBe("captured-page");
  });

  it("does not overwrite the last useful cover when the room is offline", async () => {
    const directory = await mkdtemp(join(tmpdir(), "duoduo-covers-"));
    const fetcher = vi.fn(async () => new Response(Buffer.from("black-frame")));
    const cache = new CoverCache(directory, fetcher);

    const result = await cache.updateForStatus("123", "offline", "https://example.com/offline.jpg", Buffer.from("black-screenshot"));

    expect(result).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
    await expect(readFile(join(directory, "123.png"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
