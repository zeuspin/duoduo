import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AvatarCache } from "../../src/main/rooms/avatar-cache";
import { isTrustedAvatarStatus, reconcileAvatarPaths } from "../../src/main/rooms/avatar-reconciliation";

describe("reconcileAvatarPaths", () => {
  it.each([
    ["live", true],
    ["offline", true],
    ["verification_required", false],
    ["login_required", false],
    ["timeout", false],
    ["page_error", false],
  ] as const)("accepts avatar sources from %s only when the room result is trusted", (status, trusted) => {
    expect(isTrustedAvatarStatus(status)).toBe(trusted);
  });

  it("repairs only known missing database pointers from local non-empty cache files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "duoduo-avatar-reconcile-"));
    await writeFile(join(directory, "134660708044.png"), "old-liu-avatar");
    await writeFile(join(directory, "3946293708.png"), "yan-avatar");
    await writeFile(join(directory, "empty.png"), "");
    await writeFile(join(directory, "unknown.png"), "must-not-bind");
    const fetcher = vi.fn();
    const cache = new AvatarCache(directory, fetcher);
    const bound = new Map<string, string>();
    const snapshots = {
      list: () => [
        { roomId: "134660708044" },
        { roomId: "3946293708" },
        { roomId: "empty" },
        { roomId: "already", avatarPath: "/avatars/already.png" },
      ],
      setAvatarIfMissing: (roomId: string, path: string) => {
        if (bound.has(roomId)) return false;
        bound.set(roomId, path);
        return true;
      },
    };

    const repaired = await reconcileAvatarPaths(["134660708044", "3946293708", "empty", "already"], cache, snapshots);

    expect(repaired).toEqual(["134660708044", "3946293708"]);
    expect(bound.get("134660708044")).toBe(join(directory, "134660708044.png"));
    expect(bound.has("unknown")).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
