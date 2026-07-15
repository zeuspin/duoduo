import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { BailianProvider } from "../../src/main/asr/bailian-provider";

async function apiKey(): Promise<string | undefined> {
  if (process.env.BAILIAN_API_KEY) return process.env.BAILIAN_API_KEY;
  const env = await readFile(new URL("../../../../.env", import.meta.url), "utf8").catch(() => "");
  const line = env.split(/\r?\n/).find((value) => value.startsWith("BAILIAN_API_KEY="));
  return line?.slice("BAILIAN_API_KEY=".length).trim().replace(/^['"]|['"]$/g, "");
}

describe.runIf(process.env.BAILIAN_REAL_SMOKE === "1")("Bailian real connection", () => {
  it("opens a real paraformer-realtime-v2 task without exposing the key", async () => {
    const key = await apiKey();
    expect(key, "BAILIAN_API_KEY is required").toBeTruthy();
    const session = await new BailianProvider({ apiKey: key! }).open("connection-smoke");
    await session.close();
  }, 20_000);
});
