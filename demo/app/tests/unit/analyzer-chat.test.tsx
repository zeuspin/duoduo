// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AnalyzerChat } from "../../src/renderer/components/AnalyzerChat";

afterEach(cleanup);

describe("AnalyzerChat", () => {
  it("keeps the latest conversation message visible", async () => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => 640 });
    const { container, rerender } = render(
      <AnalyzerChat messages={[{ role: "user", content: "第一条需求" }]} busy={false} />,
    );
    rerender(
      <AnalyzerChat
        messages={[
          { role: "user", content: "第一条需求" },
          { role: "assistant", content: "需要补充什么信息" },
          { role: "user", content: "这是最新回复" },
        ]}
        busy={false}
      />,
    );
    const chat = container.querySelector(".analyzer-chat") as HTMLDivElement;
    await waitFor(() => expect(chat.scrollTop).toBe(640));
    if (original) Object.defineProperty(HTMLElement.prototype, "scrollHeight", original);
    else delete (HTMLElement.prototype as unknown as { scrollHeight?: number }).scrollHeight;
  });
});
