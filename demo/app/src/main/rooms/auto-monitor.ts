import type { Room, RoomSnapshot } from "../../shared/contracts";

export function shouldAutoMonitor(
  room: Room,
  previousStatus: RoomSnapshot["status"] | undefined,
  nextStatus: RoomSnapshot["status"],
): boolean {
  return room.autoMonitorOnLive && nextStatus === "live" && previousStatus !== "live";
}
