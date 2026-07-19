import { z } from "zod";
import { MarketInsightCandidateSchema, type MarketInsight, type ParserVersion } from "../../shared/contracts";
import type { LlmRequest } from "../llm/types";
import type { StoredAsrEvent } from "../storage/database";
import { buildMarketSystemPrompt } from "./market-prompt";

const CompatibleCandidateSchema = MarketInsightCandidateSchema.extend({
  conditions: z.union([z.array(z.string().min(1)).max(10), z.string()]).nullish().transform((value) => value == null ? [] : typeof value === "string" ? (value.trim() ? [value.trim()] : []) : value),
  evidence: z.union([z.array(z.string().min(1)).min(1).max(8), z.string().min(1)]).transform((value) => typeof value === "string" ? [value] : value),
});
const InsightOutputSchema = z.object({ insights: z.array(CompatibleCandidateSchema).max(30) });

export class InsightEngine {
  constructor(private readonly provider: { complete(request: LlmRequest): Promise<unknown> }) {}

  async analyze(roomId: string, version: ParserVersion, events: StoredAsrEvent[]): Promise<Array<Omit<MarketInsight, "id">>> {
    if (!events.length) return [];
    const user = events.map((event) => `[ASR:${event.id}][${event.occurredAt}] ${event.text}`).join("\n");
    const completion = await this.provider.complete({ system: buildMarketSystemPrompt(version.spec), user, temperature: 0.1 });
    const raw = completion && typeof completion === "object" && "output" in completion ? completion.output : completion;
    let output: z.infer<typeof InsightOutputSchema>;
    try { output = InsightOutputSchema.parse(raw); }
    catch (error) {
      if (completion && typeof completion === "object" && "metering" in completion) (completion.metering as { markBusinessOutputInvalid?: () => void })?.markBusinessOutputInvalid?.();
      if (error instanceof z.ZodError) throw new Error(`INSIGHT_OUTPUT_INVALID:${error.issues.slice(0, 4).map((issue) => `${issue.path.join(".")}:${issue.message}`).join("|")}`);
      throw new Error("INSIGHT_OUTPUT_INVALID");
    }
    const createdAt = new Date().toISOString();
    return output.insights.flatMap((candidate) => {
      const matched = candidate.evidence.map((evidence) => findEvidenceEvents(events, evidence));
      if (matched.some((group) => group.length === 0)) return [];
      const evidenceEvents = matched.flat();
      const sourceAsrIds = [...new Set(evidenceEvents.map((event) => event.id))];
      return [{ ...candidate, roomId, parserId: version.parserId, parserVersionId: version.id, sourceAsrIds, startedAt: evidenceEvents[0].occurredAt, endedAt: evidenceEvents.at(-1)!.occurredAt, createdAt }];
    });
  }
}

function normalize(value: string): string { return value.replace(/[\s，。！？、；：,.!?;:]/g, "").toLowerCase(); }

function findEvidenceEvents(events: StoredAsrEvent[], evidence: string): StoredAsrEvent[] {
  const normalizedEvidence = normalize(evidence);
  const direct = events.find((event) => normalize(event.text).includes(normalizedEvidence));
  if (direct) return [direct];
  const parts = events.map((event) => normalize(event.text));
  const combined = parts.join(""); const start = combined.indexOf(normalizedEvidence);
  if (start < 0) return [];
  const end = start + normalizedEvidence.length; let cursor = 0; const matched: StoredAsrEvent[] = [];
  for (let index = 0; index < events.length; index += 1) {
    const next = cursor + parts[index].length;
    if (next > start && cursor < end) matched.push(events[index]);
    cursor = next;
  }
  return matched;
}
