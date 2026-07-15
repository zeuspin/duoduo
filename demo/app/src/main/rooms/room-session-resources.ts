export interface RoomResourceDisposal {
  stopCapture?: () => void | Promise<void>;
  closeAsr?: () => void | Promise<void>;
  destroyWindow?: () => void | Promise<void>;
  clearStorage?: () => void | Promise<void>;
}

export async function disposeRoomResources(resources: RoomResourceDisposal): Promise<void> {
  for (const release of [resources.stopCapture, resources.closeAsr, resources.destroyWindow, resources.clearStorage]) {
    if (release) await Promise.resolve().then(release).catch(() => undefined);
  }
}
