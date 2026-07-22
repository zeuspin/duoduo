import { z } from "zod";
import {
  AnalyzerDraftTestResponseSchema,
  type AnalyzerAgentDraft,
  type AnalyzerDraftTestResponse,
  type ContentRecord,
  type ParserVersion,
} from "../../shared/contracts";
import type { LlmRequest } from "../llm/types";
import type { StoredAsrEvent } from "../storage/database";

const RawRecordSchema = z.object({
  resultTypeId: z.string().regex(/^[a-z][a-z0-9_]*$/),
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(800).default(""),
  fields: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
  ),
  evidence: z.union([
    z.string().trim().min(1),
    z.array(z.string().trim().min(1)).min(1).max(8),
  ]).transform((value) => typeof value === "string" ? [value] : value),
  confidence: z.number().min(0).max(1),
  alertLevel: z.enum(["none", "normal", "important"]),
});
const RawOutputSchema = z.object({ records: z.array(RawRecordSchema).max(30) });

export class AnalyzerDraftEngine {
  constructor(
    private readonly provider: {
      complete(request: LlmRequest): Promise<unknown>;
    },
  ) {}

  async analyze(
    roomId: string,
    version: ParserVersion,
    events: StoredAsrEvent[],
  ): Promise<Array<Omit<ContentRecord, "id">>> {
    if (!("schemaVersion" in version.spec) || version.spec.schemaVersion !== 4)
      throw new Error("ANALYZER_DEFINITION_REQUIRED");
    const result = await this.test(roomId, version.spec.definition, events);
    const byId = new Map(events.map((event) => [event.id, event]));
    const createdAt = new Date().toISOString();
    return result.records.map((record) => {
      const sources = record.sourceAsrIds
        .map((id) => byId.get(id))
        .filter((event): event is StoredAsrEvent => Boolean(event));
      return {
        ...record,
        roomId,
        parserId: version.parserId,
        parserVersionId: version.id,
        startedAt: sources[0].occurredAt,
        endedAt: sources.at(-1)!.occurredAt,
        createdAt,
      };
    });
  }

  async test(
    roomId: string,
    draft: AnalyzerAgentDraft,
    events: StoredAsrEvent[],
  ): Promise<AnalyzerDraftTestResponse> {
    if (!events.length) throw new Error("ANALYZER_SAMPLE_EMPTY");
    const allowedTypes = new Map(
      draft.resultTypes.map((item) => [item.id, item.label]),
    );
    const allowedFields = new Set(draft.fields.map((item) => item.id));
    const completion = await this.provider.complete({
      system: buildTestPrompt(draft),
      user: events
        .map((event) => `[ASR:${event.id}][${event.occurredAt}] ${event.text}`)
        .join("\n"),
      temperature: 0.1,
    });
    const raw =
      completion && typeof completion === "object" && "output" in completion
        ? completion.output
        : completion;
    const output = RawOutputSchema.safeParse(raw);
    if (!output.success) {
      markInvalid(completion);
      throw new Error("ANALYZER_TEST_OUTPUT_INVALID");
    }
    const records = output.data.records.map((record) => {
      const resultTypeLabel = allowedTypes.get(record.resultTypeId);
      if (!resultTypeLabel) {
        markInvalid(completion);
        throw new Error("ANALYZER_TEST_RESULT_TYPE_INVALID");
      }
      if (Object.keys(record.fields).some((field) => !allowedFields.has(field))) {
        markInvalid(completion);
        throw new Error("ANALYZER_TEST_FIELD_INVALID");
      }
      const matched = record.evidence.map((quote) => findEvidenceEvents(events, quote));
      if (matched.some((items) => items.length === 0)) {
        markInvalid(completion);
        throw new Error("ANALYZER_TEST_EVIDENCE_INVALID");
      }
      return {
        ...record,
        resultTypeLabel,
        sourceAsrIds: [...new Set(matched.flat().map((event) => event.id))],
      };
    });
    const sampleCharacters = events.reduce((sum, event) => sum + event.text.length, 0);
    return AnalyzerDraftTestResponseSchema.parse({
      status: records.length > 0 ? "passed" : "inconclusive",
      roomId,
      sampleCount: events.length,
      sampleCharacters,
      records,
      checks: {
        schemaValid: true,
        evidenceGrounded: true,
        resultTypesValid: true,
      },
      message:
        records.length > 0
          ? `样本产生 ${records.length} 条记录，结构和逐字证据校验通过。`
          : "样本中没有出现符合规则的内容，无法判断召回效果；请更换样本或等待直播间出现目标内容。",
    });
  }
}

function buildTestPrompt(draft: AnalyzerAgentDraft): string {
  return `你是直播内容分析器的样本执行器。只能依据输入 ASR 和下方分析器定义生成记录，不得补充外部事实，不得推测说话者没有明确表达的内容。
分析器定义：${JSON.stringify(draft)}
只收录 inclusionRules 明确允许且不属于 exclusionRules 的内容。resultTypeId 只能使用定义中的 id；fields 只能使用定义中的字段 id，缺失信息不要编造也不要输出该字段。
evidence 必须从输入 ASR 原样逐字复制，不得改写；alertLevel 根据 alertRules 判断，没有命中提醒规则时为 none。
严格返回 JSON 对象：{"records":[{"resultTypeId":"定义中的 id","title":"简短标题","summary":"摘要","fields":{"字段id":"值"},"evidence":["逐字原话"],"confidence":0到1,"alertLevel":"none|normal|important"}]}。没有符合内容时返回 {"records":[]}，不要输出 JSON 以外的内容。`;
}

function markInvalid(completion: unknown): void {
  if (completion && typeof completion === "object" && "metering" in completion)
    (completion.metering as { markBusinessOutputInvalid?: () => void })
      .markBusinessOutputInvalid?.();
}

function normalize(value: string): string {
  return value.replace(/[\s，。！？、；：,.!?;:]/g, "").toLowerCase();
}

function findEvidenceEvents(
  events: StoredAsrEvent[],
  evidence: string,
): StoredAsrEvent[] {
  const normalizedEvidence = normalize(evidence);
  const direct = events.find((event) =>
    normalize(event.text).includes(normalizedEvidence),
  );
  if (direct) return [direct];
  const parts = events.map((event) => normalize(event.text));
  const combined = parts.join("");
  const start = combined.indexOf(normalizedEvidence);
  if (start < 0) return [];
  const end = start + normalizedEvidence.length;
  let cursor = 0;
  const matched: StoredAsrEvent[] = [];
  for (let index = 0; index < events.length; index += 1) {
    const next = cursor + parts[index].length;
    if (next > start && cursor < end) matched.push(events[index]);
    cursor = next;
  }
  return matched;
}
