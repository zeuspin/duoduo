export interface RevealableWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
}

export function revealExistingWindow(window: RevealableWindow | undefined): void {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

export function acquireProcessLock(path: string, pid = process.pid, isAlive = processIsAlive): { acquired: boolean; release(): void } {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = openSync(path, "wx", 0o600);
      writeFileSync(descriptor, String(pid));
      closeSync(descriptor);
      return {
        acquired: true,
        release() {
          try { if (readFileSync(path, "utf8") === String(pid)) unlinkSync(path); } catch { /* already released */ }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let owner = Number.NaN;
      try { owner = Number(readFileSync(path, "utf8")); } catch { /* retry stale lock */ }
      if (Number.isInteger(owner) && isAlive(owner)) return { acquired: false, release() {} };
      try { unlinkSync(path); } catch (unlinkError) { if ((unlinkError as NodeJS.ErrnoException).code !== "ENOENT") throw unlinkError; }
    }
  }
  return { acquired: false, release() {} };
}

function processIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}
import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
