import { describe, expect, it, vi } from "vitest";
import { createRendererApi } from "../../src/preload/api";

describe("renderer API", () => {
  it("exposes only settings and rooms namespaces", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const api = createRendererApi(invoke, vi.fn());
    expect(Object.keys(api)).toEqual(["app", "settings", "access", "rooms", "data", "asr", "player", "llm", "parsers", "insights"]);
    expect(Object.keys(api.app)).toEqual(["getVersion"]);
    await expect(api.app.getVersion()).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("app:get-version");
    expect(Object.keys(api.settings)).toEqual(["getAsrProvider", "saveAsrProvider", "testAsrProvider", "getInsightNotifications", "saveInsightNotifications", "getMonitoring", "saveMonitoring"]);
    expect(Object.keys(api.access)).toEqual(["getState", "showVerification", "hideVerification", "setVerificationBounds", "checkVerification", "confirmRecovery", "subscribe"]);
    await api.access.showVerification();
    expect(invoke).toHaveBeenCalledWith("access:show-verification");
    await api.access.hideVerification();
    expect(invoke).toHaveBeenCalledWith("access:hide-verification");
    await api.access.setVerificationBounds({ x: 10, y: 80, width: 900, height: 600 });
    expect(invoke).toHaveBeenCalledWith("access:set-verification-bounds", { x: 10, y: 80, width: 900, height: 600 });
    expect(Object.keys(api.rooms)).toEqual([
      "list", "add", "update", "remove", "setMonitoring", "setAutoMonitorOnLive", "probe", "probeAll", "cancelProbeBatch", "getProbeState", "refreshAvatar", "listIntelligence", "getIntelligence", "subscribe", "subscribeProbeState",
    ]);
    expect(Object.keys(api.data)).toEqual(["getUsage", "getRetention", "saveRetention", "previewCleanup", "executeCleanup", "compact", "exportBackup", "importBackup"]);
    await api.data.previewCleanup({ category: "observations", before: "2026-01-01T00:00:00.000Z" });
    expect(invoke).toHaveBeenCalledWith("data:preview-cleanup", { category: "observations", before: "2026-01-01T00:00:00.000Z" });
    await api.rooms.refreshAvatar("123");
    expect(invoke).toHaveBeenCalledWith("rooms:refresh-avatar", "123");
    await api.rooms.setAutoMonitorOnLive("123", true);
    expect(invoke).toHaveBeenCalledWith("rooms:set-auto-monitor-on-live", "123", true);
    await api.rooms.probeAll();
    expect(invoke).toHaveBeenCalledWith("rooms:probe-all");
    await api.rooms.cancelProbeBatch();
    expect(invoke).toHaveBeenCalledWith("rooms:cancel-probe-batch");
    await api.rooms.getProbeState();
    expect(invoke).toHaveBeenCalledWith("rooms:get-probe-state");
    await api.rooms.listIntelligence();
    expect(invoke).toHaveBeenCalledWith("rooms:list-intelligence");
    await api.rooms.getIntelligence("123");
    expect(invoke).toHaveBeenCalledWith("rooms:get-intelligence", "123");
    expect(Object.keys(api.asr)).toEqual(["listBefore"]);
    expect(Object.keys(api.player)).toEqual(["getState", "play", "stop", "setBounds", "subscribe"]);
    expect(Object.keys(api.llm)).toEqual(["get", "save", "test"]);
    expect(Object.keys(api.parsers)).toEqual(["list", "createDraft", "updateDraft", "removeDraft", "publish", "bindRoom", "runTest"]);
    expect(Object.keys(api.insights)).toEqual(["list", "subscribe"]);
    await expect(api.asr.listBefore("123", { limit: 50, beforeId: 99 })).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("asr:list-before", "123", { limit: 50, beforeId: 99 });
    await expect(api.parsers.bindRoom("123", "market-insight", 1)).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("parsers:bind-room", "123", "market-insight", 1);
    await expect(api.settings.saveInsightNotifications({ timeoutSeconds: 60 })).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("settings:save-insight-notifications", { timeoutSeconds: 60 });
  });
});
