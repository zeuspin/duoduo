import { describe, expect, it, vi } from "vitest";
import { AnalyzerDraftEngine } from "../../src/main/insights/analyzer-draft-engine";

const draft = {
  name: "商品降价监控",
  purpose: "记录主播明确提到的商品降价",
  resultTypes: [
    { id: "price_drop", label: "商品降价", definition: "商品价格明确下降" },
  ],
  fields: [
    { id: "product", label: "商品", type: "string" as const },
    { id: "price", label: "新价格", type: "number" as const },
  ],
  inclusionRules: ["主播明确提到商品和新价格"],
  exclusionRules: ["忽略寒暄和观众猜测"],
  alertRules: ["出现商品降价时重要提醒"],
};
const events = [
  {
    id: 1,
    roomId: "shop",
    sessionId: "session",
    segmentId: "1",
    startMs: 0,
    endMs: 1000,
    text: "这款防晒霜今天从九十九降到七十九元",
    isFinal: true,
    occurredAt: "2026-07-21T08:00:00.000Z",
  },
];

describe("AnalyzerDraftEngine", () => {
  it("accepts only configured result types, fields and verbatim evidence", async () => {
    const complete = vi.fn().mockResolvedValue({
      output: {
        records: [{
          resultTypeId: "price_drop",
          title: "防晒霜降价",
          summary: "防晒霜降至七十九元",
          fields: { product: "防晒霜", price: 79 },
          evidence: ["这款防晒霜今天从九十九降到七十九元"],
          confidence: 0.98,
          alertLevel: "important",
        }],
      },
      metering: {},
    });
    const result = await new AnalyzerDraftEngine({ complete }).test("shop", draft, events);
    expect(result.status).toBe("passed");
    expect(result.records[0]).toMatchObject({
      resultTypeLabel: "商品降价",
      sourceAsrIds: [1],
      fields: { product: "防晒霜", price: 79 },
    });
  });

  it("marks a sample without target content as inconclusive", async () => {
    const result = await new AnalyzerDraftEngine({
      complete: vi.fn().mockResolvedValue({ output: { records: [] }, metering: {} }),
    }).test("shop", draft, events);
    expect(result.status).toBe("inconclusive");
    expect(result.records).toEqual([]);
  });

  it("rejects evidence that cannot be found in the ASR", async () => {
    const markBusinessOutputInvalid = vi.fn();
    const engine = new AnalyzerDraftEngine({
      complete: vi.fn().mockResolvedValue({
        output: {
          records: [{
            resultTypeId: "price_drop",
            title: "编造记录",
            summary: "",
            fields: {},
            evidence: ["主播没有说过的句子"],
            confidence: 0.9,
            alertLevel: "important",
          }],
        },
        metering: { markBusinessOutputInvalid },
      }),
    });
    await expect(engine.test("shop", draft, events)).rejects.toThrow("ANALYZER_TEST_EVIDENCE_INVALID");
    expect(markBusinessOutputInvalid).toHaveBeenCalled();
  });

  it("turns a published V4 analyzer result into a persistable content record", async () => {
    const engine = new AnalyzerDraftEngine({
      complete: vi.fn().mockResolvedValue({
        output: {
          records: [{
            resultTypeId: "price_drop",
            title: "防晒霜降价",
            summary: "防晒霜降至七十九元",
            fields: { product: "防晒霜", price: 79 },
            evidence: ["这款防晒霜今天从九十九降到七十九元"],
            confidence: 0.98,
            alertLevel: "important",
          }],
        },
        metering: {},
      }),
    });
    const records = await engine.analyze("shop", {
      id: 2,
      parserId: "market-insight",
      version: 2,
      state: "published",
      spec: { schemaVersion: 4, name: draft.name, definition: draft },
      createdAt: "2026-07-21T07:00:00.000Z",
      publishedAt: "2026-07-21T07:00:00.000Z",
    }, events);
    expect(records[0]).toMatchObject({
      roomId: "shop",
      parserId: "market-insight",
      parserVersionId: 2,
      startedAt: events[0].occurredAt,
      alertLevel: "important",
    });
  });
});
