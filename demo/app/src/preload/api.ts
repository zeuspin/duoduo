import type { AiUsageQuery, AsrProviderConfig, CleanupRequest, DataRetentionSettings, InsightNotificationSettings, LlmProviderConfig, MonitoringSettings, ParserSpec, RoomInput } from "../shared/contracts";

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;
type Subscribe = (channel: string, listener: (...args: unknown[]) => void) => () => void;

export function createRendererApi(invoke: Invoke, subscribe: Subscribe) {
  return {
    app: {
      getVersion: () => invoke("app:get-version"),
    },
    settings: {
      getAsrProvider: () => invoke("settings:get-asr-provider"),
      saveAsrProvider: (config: AsrProviderConfig, secret?: string) => invoke("settings:save-asr-provider", config, secret),
      testAsrProvider: (config: AsrProviderConfig, secret?: string) => invoke("settings:test-asr-provider", config, secret),
      getInsightNotifications: () => invoke("settings:get-insight-notifications"),
      saveInsightNotifications: (value: InsightNotificationSettings) => invoke("settings:save-insight-notifications", value),
      getMonitoring: () => invoke("settings:get-monitoring"),
      saveMonitoring: (value: MonitoringSettings) => invoke("settings:save-monitoring", value),
    },
    access: {
      getState: () => invoke("access:get-state"),
      showVerification: () => invoke("access:show-verification"),
      hideVerification: () => invoke("access:hide-verification"),
      setVerificationBounds: (bounds: { x: number; y: number; width: number; height: number }) => invoke("access:set-verification-bounds", bounds),
      checkVerification: () => invoke("access:check-verification"),
      confirmRecovery: () => invoke("access:confirm-recovery"),
      subscribe: (listener: (...args: unknown[]) => void) => subscribe("access:changed", listener),
    },
    rooms: {
      list: () => invoke("rooms:list"),
      add: (input: RoomInput) => invoke("rooms:add", input),
      update: (roomId: string, input: RoomInput) => invoke("rooms:update", roomId, input),
      remove: (roomId: string) => invoke("rooms:remove", roomId),
      setMonitoring: (roomId: string, monitoring: boolean) => invoke("rooms:set-monitoring", roomId, monitoring),
      setAutoMonitorOnLive: (roomId: string, enabled: boolean) => invoke("rooms:set-auto-monitor-on-live", roomId, enabled),
      probe: (roomId: string) => invoke("rooms:probe", roomId),
      probeAll: () => invoke("rooms:probe-all"),
      cancelProbeBatch: () => invoke("rooms:cancel-probe-batch"),
      getProbeState: () => invoke("rooms:get-probe-state"),
      refreshAvatar: (roomId: string) => invoke("rooms:refresh-avatar", roomId),
      listIntelligence: () => invoke("rooms:list-intelligence"),
      getIntelligence: (roomId: string) => invoke("rooms:get-intelligence", roomId),
      subscribe: (listener: (...args: unknown[]) => void) => subscribe("rooms:changed", listener),
      subscribeProbeState: (listener: (...args: unknown[]) => void) => subscribe("rooms:probe-state", listener),
    },
    data: {
      getUsage: () => invoke("data:get-usage"),
      getRetention: () => invoke("data:get-retention"),
      saveRetention: (value: DataRetentionSettings) => invoke("data:save-retention", value),
      previewCleanup: (request: CleanupRequest) => invoke("data:preview-cleanup", request),
      executeCleanup: (request: CleanupRequest, token: string) => invoke("data:execute-cleanup", request, token),
      compact: () => invoke("data:compact"),
      exportBackup: () => invoke("data:export-backup"),
      importBackup: (mode: "replace" | "merge") => invoke("data:import-backup", mode),
    },
    aiUsage: {
      getDashboard: (query: AiUsageQuery) => invoke("ai-usage:get-dashboard", query),
    },
    asr: {
      listBefore: (roomId: string, options: { limit: number; beforeId?: number }) => invoke("asr:list-before", roomId, options),
    },
    player: {
      getState: () => invoke("player:get-state"),
      play: (roomId: string) => invoke("player:play", roomId),
      stop: () => invoke("player:stop"),
      setBounds: (bounds: { x: number; y: number; width: number; height: number }) => invoke("player:set-bounds", bounds),
      subscribe: (listener: (...args: unknown[]) => void) => subscribe("player:changed", listener),
    },
    llm: {
      get: () => invoke("llm:get"),
      save: (config: LlmProviderConfig, secret?: string) => invoke("llm:save", config, secret),
      test: (config: LlmProviderConfig, secret?: string) => invoke("llm:test", config, secret),
    },
    parsers: {
      list: () => invoke("parsers:list"),
      createDraft: (parserId: string) => invoke("parsers:create-draft", parserId),
      updateDraft: (versionId: number, spec: ParserSpec) => invoke("parsers:update-draft", versionId, spec),
      removeDraft: (parserId: string) => invoke("parsers:remove-draft", parserId),
      publish: (parserId: string, versionId: number) => invoke("parsers:publish", parserId, versionId),
      bindRoom: (roomId: string, parserId: string | null, parserVersionId: number | null) => invoke("parsers:bind-room", roomId, parserId, parserVersionId),
      runTest: (parserId: string, roomId: string, limit = 50) => invoke("parsers:run-test", parserId, roomId, limit),
    },
    insights: {
      list: (options: { roomId?: string; limit: number; beforeId?: number }) => invoke("insights:list", options),
      subscribe: (listener: (...args: unknown[]) => void) => subscribe("insights:changed", listener),
    },
  };
}

export type RendererApi = ReturnType<typeof createRendererApi>;
