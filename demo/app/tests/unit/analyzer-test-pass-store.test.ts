import { describe, expect, it } from "vitest";
import { AnalyzerTestPassStore } from "../../src/main/insights/analyzer-test-pass-store";

const draft = {
  name: "价格提醒",
  purpose: "记录价格变化",
  resultTypes: [{ id: "price", label: "价格", definition: "明确价格" }],
  fields: [{ id: "product", label: "商品", type: "string" as const }],
  inclusionRules: ["明确价格"],
  exclusionRules: [],
  alertRules: ["降价提醒"],
};

describe("AnalyzerTestPassStore", () => {
  it("binds a one-time pass token to the exact tested draft", () => {
    const store = new AnalyzerTestPassStore();
    const token = store.issue(draft, "room-1", 1000);
    expect(store.consume(token, draft, 2000)).toEqual({ roomId: "room-1" });
    expect(() => store.consume(token, draft, 2000)).toThrow("ANALYZER_TEST_TOKEN_EXPIRED");
  });

  it("rejects modified drafts and expired passes", () => {
    const modified = { ...draft, alertRules: ["所有价格都提醒"] };
    const first = new AnalyzerTestPassStore();
    const modifiedToken = first.issue(draft, "room-1", 1000);
    expect(() => first.consume(modifiedToken, modified, 2000)).toThrow("ANALYZER_DRAFT_CHANGED_AFTER_TEST");
    const second = new AnalyzerTestPassStore();
    const expiredToken = second.issue(draft, "room-1", 1000);
    expect(() => second.consume(expiredToken, draft, 1000 + 30 * 60_000 + 1)).toThrow("ANALYZER_TEST_TOKEN_EXPIRED");
  });
});
