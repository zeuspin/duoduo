import { describe, expect, it, vi } from "vitest";
import { inspectVerificationPage } from "../../src/main/rooms/verification-page-inspector";

describe("inspectVerificationPage", () => {
  it("classifies a verification marker", async () => {
    const executeJavaScript = vi.fn(async () => "请完成下列验证后继续");

    await expect(inspectVerificationPage({ executeJavaScript })).resolves.toBe("verification_required");
  });

  it("classifies a login marker", async () => {
    const executeJavaScript = vi.fn(async () => "扫码登录后继续");

    await expect(inspectVerificationPage({ executeJavaScript })).resolves.toBe("login_required");
  });

  it("classifies an ordinary rendered room page as clear", async () => {
    const executeJavaScript = vi.fn(async () => "直播已结束");

    await expect(inspectVerificationPage({ executeJavaScript })).resolves.toBe("clear");
    expect(executeJavaScript).toHaveBeenCalledWith("document.body?.innerText?.slice(0,20000) ?? ''");
  });
});
