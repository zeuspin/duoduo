export interface RoomResourceDisposal {
  stopCapture?: () => void | Promise<void>;
  closeAsr?: () => void | Promise<void>;
  destroyWindow?: () => void | Promise<void>;
  clearStorage?: () => void | Promise<void>;
}

export async function withRoomTimeout<T>(operation: Promise<T>, timeoutMs = 5_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("ROOM_OPERATION_TIMEOUT")), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

export async function disposeRoomResources(resources: RoomResourceDisposal): Promise<void> {
  for (const release of [resources.stopCapture, resources.closeAsr, resources.destroyWindow, resources.clearStorage]) {
    if (release) await withRoomTimeout(Promise.resolve().then(release)).catch(() => undefined);
  }
}
