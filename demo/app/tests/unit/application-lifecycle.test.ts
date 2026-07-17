import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireProcessLock, revealExistingWindow } from "../../src/main/application-lifecycle";

describe("application lifecycle", () => {
  it("restores and focuses the existing window after a duplicate launch", () => {
    const window = { isDestroyed: () => false, isMinimized: () => true, restore: vi.fn(), show: vi.fn(), focus: vi.fn() };

    revealExistingWindow(window);

    expect(window.restore).toHaveBeenCalledTimes(1);
    expect(window.show).toHaveBeenCalledTimes(1);
    expect(window.focus).toHaveBeenCalledTimes(1);
  });

  it("rejects a second live process and reclaims a stale lock", () => {
    const directory = mkdtempSync(join(tmpdir(), "duoduo-lock-"));
    const path = join(directory, "app.lock");
    const first = acquireProcessLock(path, 101, (pid) => pid === 101);

    expect(first.acquired).toBe(true);
    expect(acquireProcessLock(path, 202, (pid) => pid === 101).acquired).toBe(false);
    first.release();
    const replacement = acquireProcessLock(path, 202, () => false);
    expect(replacement.acquired).toBe(true);
    expect(readFileSync(path, "utf8")).toBe("202");
    replacement.release();
    rmSync(directory, { recursive: true, force: true });
  });
});
