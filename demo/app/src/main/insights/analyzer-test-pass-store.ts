import { randomUUID } from "node:crypto";
import type { AnalyzerAgentDraft } from "../../shared/contracts";

export class AnalyzerTestPassStore {
  private readonly passes = new Map<string, {
    draftJson: string;
    roomId: string;
    expiresAt: number;
  }>();

  issue(draft: AnalyzerAgentDraft, roomId: string, now = Date.now()): string {
    const token = randomUUID();
    this.passes.set(token, {
      draftJson: JSON.stringify(draft),
      roomId,
      expiresAt: now + 30 * 60_000,
    });
    return token;
  }

  consume(token: string, draft: AnalyzerAgentDraft, now = Date.now()): { roomId: string } {
    const pass = this.passes.get(token);
    this.passes.delete(token);
    if (!pass || pass.expiresAt < now)
      throw new Error("ANALYZER_TEST_TOKEN_EXPIRED");
    if (pass.draftJson !== JSON.stringify(draft))
      throw new Error("ANALYZER_DRAFT_CHANGED_AFTER_TEST");
    return { roomId: pass.roomId };
  }
}
