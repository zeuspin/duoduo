const safeRoomId = (roomId: string) => roomId.replace(/[^a-zA-Z0-9_-]/g, "_");

export const roomPartitionName = (roomId: string) => `persist:duoduo-room:${safeRoomId(roomId)}`;
export const probePartitionName = (roomId: string) => `duoduo-probe:${safeRoomId(roomId)}`;
export const coverPartitionName = (roomId: string) => `duoduo-cover:${safeRoomId(roomId)}`;
export const playerPartitionName = (roomId: string) => `duoduo-player:${safeRoomId(roomId)}`;
