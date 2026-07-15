import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AvatarCache } from "../../src/main/rooms/avatar-cache";

describe("AvatarCache", () => {
  it("keeps the first avatar until an explicit refresh", async () => {
    const directory = await mkdtemp(join(tmpdir(), "duoduo-avatars-"));
    let body = "first";
    const cache = new AvatarCache(directory, async () => new Response(body));
    const path = await cache.ensure("123", "https://example.com/first.jpg");
    body = "automatic-new";
    await cache.ensure("123", "https://example.com/new.jpg");
    expect(await readFile(path, "utf8")).toBe("first");
    body = "manual-new";
    await cache.refresh("123", "https://example.com/new.jpg");
    expect(await readFile(path, "utf8")).toBe("manual-new");
  });

  it("preserves the old avatar when refresh fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "duoduo-avatars-"));
    let ok = true;
    const cache = new AvatarCache(directory, async () => ok ? new Response("stable") : new Response(null, { status: 500 }));
    const path = await cache.ensure("123", "https://example.com/avatar.jpg");
    ok = false;
    await expect(cache.refresh("123", "https://example.com/avatar.jpg")).rejects.toThrow("AVATAR_HTTP_500");
    expect(await readFile(path, "utf8")).toBe("stable");
  });
});
