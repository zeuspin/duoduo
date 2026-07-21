import type { ParserSpec } from "../../shared/contracts";
import { materializeParserPrompt } from "../../shared/parser-prompt";

export function buildMarketSystemPrompt(spec: ParserSpec): string {
  return materializeParserPrompt(spec);
}
