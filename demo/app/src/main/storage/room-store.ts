import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { RoomInputSchema, RoomSchema, normalizeDouyinUrl, type Room, type RoomInput } from "../../shared/contracts";

export class RoomStore {
  private operation = Promise.resolve<unknown>(undefined);

  constructor(private readonly filePath: string) {}

  async list(): Promise<Room[]> {
    try {
      const contents = await readFile(this.filePath, "utf8");
      return RoomSchema.array().parse(JSON.parse(contents));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  add(input: RoomInput): Promise<Room> {
    return this.serialize(async () => {
      const parsed = RoomInputSchema.parse(input);
      const normalized = normalizeDouyinUrl(parsed.url);
      const rooms = await this.list();
      if (rooms.some((room) => room.roomId === normalized.roomId)) throw new Error("ROOM_EXISTS");

      const now = new Date().toISOString();
      const room: Room = {
        ...normalized,
        schedule: parsed.schedule,
        probeIntervalMinutes: parsed.probeIntervalMinutes,
        monitoring: false,
        createdAt: now,
        updatedAt: now,
      };
      await this.write([...rooms, room]);
      return room;
    });
  }

  remove(roomId: string): Promise<void> {
    return this.serialize(async () => {
      const rooms = await this.list();
      await this.write(rooms.filter((room) => room.roomId !== roomId));
    });
  }

  update(roomId: string, input: RoomInput): Promise<Room> {
    return this.serialize(async () => {
      const parsed = RoomInputSchema.parse(input);
      const normalized = normalizeDouyinUrl(parsed.url);
      if (normalized.roomId !== roomId) throw new Error("ROOM_ID_IMMUTABLE");
      const rooms = await this.list();
      const index = rooms.findIndex((room) => room.roomId === roomId);
      if (index < 0) throw new Error("ROOM_NOT_FOUND");
      const updated = { ...rooms[index], canonicalUrl: normalized.canonicalUrl, schedule: parsed.schedule, probeIntervalMinutes: parsed.probeIntervalMinutes, updatedAt: new Date().toISOString() };
      rooms[index] = updated;
      await this.write(rooms);
      return updated;
    });
  }

  setMonitoring(roomId: string, monitoring: boolean): Promise<Room> {
    return this.serialize(async () => {
      const rooms = await this.list();
      const index = rooms.findIndex((room) => room.roomId === roomId);
      if (index < 0) throw new Error("ROOM_NOT_FOUND");
      const updated = { ...rooms[index], monitoring, updatedAt: new Date().toISOString() };
      rooms[index] = updated;
      await this.write(rooms);
      return updated;
    });
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.operation.then(work, work);
    this.operation = next;
    return next;
  }

  private async write(rooms: Room[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(rooms, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }
}
