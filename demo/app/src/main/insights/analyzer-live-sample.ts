import type { AsrEvent } from "../../shared/contracts";
import type { StoredAsrEvent } from "../storage/database";

function eventKey(event: Pick<AsrEvent, "sessionId" | "segmentId">): string {
  return `${event.sessionId}:${event.segmentId}`;
}

export function mergeAnalyzerSampleEvents(
  stored: StoredAsrEvent[],
  hot: AsrEvent[],
  now = () => new Date().toISOString(),
): StoredAsrEvent[] {
  const storedKeys = new Set(stored.map(eventKey));
  let nextSyntheticId = Math.max(
    1_000_000_000,
    stored.reduce((maximum, event) => Math.max(maximum, event.id + 1), 1),
  );
  const live = hot
    .filter((event) => event.text.trim() && !storedKeys.has(eventKey(event)))
    .map((event) => ({
      ...event,
      id: nextSyntheticId++,
      occurredAt: event.occurredAt ?? now(),
    }));
  return [...stored, ...live].sort((left, right) =>
    left.occurredAt.localeCompare(right.occurredAt),
  );
}

