import { describe, expect, it } from "vitest";
import { compactCheckedAt, compactCount, probeDetail, probeFreshness, roomDisplayName } from "../../src/renderer/room-card-presenter";

describe("room card presentation", () => {
  it("does not present a verification interstitial as the remembered anchor", () => {
    expect(roomDisplayName({ roomId: "123", status: "page_error", title: "验证码中间页", anchorName: "验证码中间页", checkedAt: "2026-07-15T10:00:00.000Z" }, "123")).toBe("直播间 123");
  });

  it("uses specific failure copy", () => {
    expect(probeDetail({ roomId: "123", status: "timeout", checkedAt: "2026-07-15T10:00:00.000Z", error: "PROBE_TIMEOUT" })).toBe("页面响应超时");
    expect(probeDetail({ roomId: "123", status: "verification_required", checkedAt: "2026-07-15T10:00:00.000Z" })).toBe("安全验证已暂停更新");
  });

  it("marks data stale after twice the configured target interval", () => {
    expect(probeFreshness("2026-07-15T10:00:00.000Z", 5, Date.parse("2026-07-15T10:11:00.000Z"))).toEqual({ label: "已过期 · 11 分钟前", stale: true });
  });

  it("formats card counts and simplified relative detection time", () => {
    expect(compactCount(1_264_000)).toBe("126.4 万");
    expect(compactCount(undefined)).toBe("待获取");
    expect(compactCheckedAt("2026-07-17T10:24:00.000Z", Date.parse("2026-07-17T12:00:00.000Z"))).toBe("96 分钟前检测");
  });
});
