// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InsightCenter } from "../../src/renderer/components/InsightCenter";

beforeEach(() => Object.assign(window, { duoduo: { insights: { list: vi.fn().mockResolvedValue({ items: [{ id: 1, roomId: "123", parserId: "market-insight", parserVersionId: 1, nature: "conditional", subjectKind: "sector", subjectOriginal: "科技", direction: "cautious", summary: "科技方向暂难形成持续主线", rationale: "成交额没有放大", conditions: ["下午成交额未放大"], evidence: ["科技这个方向大概率还是轮动"], sourceAsrIds: [8], startedAt: "2026-07-13T02:30:00.000Z", endedAt: "2026-07-13T02:30:05.000Z", confidence: 0.91, alertLevel: "normal", createdAt: "2026-07-13T02:30:08.000Z" }] }), subscribe: vi.fn(() => () => undefined) } } }));
afterEach(cleanup);

describe("InsightCenter", () => {
  it("shows natural time, viewpoint nature and supporting evidence", async () => {
    render(<InsightCenter rooms={[]} />);
    expect(await screen.findByText("科技方向暂难形成持续主线")).toBeTruthy();
    expect(document.querySelector(".insight-level")?.textContent).toContain("条件观点");
    expect(screen.getByText(/科技这个方向大概率还是轮动/)).toBeTruthy();
    expect(screen.getByText("10:30:00")).toBeTruthy();
  });
});
