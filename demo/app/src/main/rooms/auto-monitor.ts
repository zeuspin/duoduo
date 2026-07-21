import type { Room, RoomSnapshot } from "../../shared/contracts";

export function shouldAutoMonitor(
  room: Room,
  _previousStatus: RoomSnapshot["status"] | undefined,
  nextStatus: RoomSnapshot["status"],
): boolean {
  return room.autoMonitorOnLive && !room.monitoring && nextStatus === "live";
}
