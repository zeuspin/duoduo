import type { AvatarCache } from "./avatar-cache";
import type { LiveStatus } from "./live-probe";

export function isTrustedAvatarStatus(status: LiveStatus): status is "live" | "offline" {
  return status === "live" || status === "offline";
}

interface AvatarSnapshotStore {
  list(): Array<{ roomId: string; avatarPath?: string }>;
  setAvatarIfMissing(roomId: string, avatarPath: string): boolean;
}

export async function reconcileAvatarPaths(
  roomIds: string[],
  cache: Pick<AvatarCache, "existing">,
  snapshots: AvatarSnapshotStore,
): Promise<string[]> {
  const current = new Map(snapshots.list().map((snapshot) => [snapshot.roomId, snapshot]));
  const repaired: string[] = [];
  for (const roomId of roomIds) {
    const snapshot = current.get(roomId);
    if (!snapshot || snapshot.avatarPath) continue;
    const avatarPath = await cache.existing(roomId);
    if (avatarPath && snapshots.setAvatarIfMissing(roomId, avatarPath)) repaired.push(roomId);
  }
  return repaired;
}
