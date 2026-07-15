import { describe, expect, it } from "vitest";
import { coverPartitionName, probePartitionName, roomPartitionName } from "../../src/main/rooms/partitions";

describe("room partitions", () => {
  it("keeps stable per-room identities without creating random partitions", () => {
    expect(roomPartitionName("123")).toBe("persist:duoduo-room:123");
    expect(roomPartitionName("123")).toBe(roomPartitionName("123"));
    expect(probePartitionName("123")).toBe("duoduo-probe:123");
    expect(coverPartitionName("123")).toBe("duoduo-cover:123");
  });
});
