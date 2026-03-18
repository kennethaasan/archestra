import { vi } from "vitest";
import { beforeEach, describe, expect, test } from "@/test";

const {
  mockIsVertexAiEnabled,
  mockFindSystemKey,
  mockCreateSystemKey,
  mockDeleteSystemKey,
  mockFetchModelsFromApi,
  mockBulkUpsert,
  mockBulkUpsertFull,
  mockSyncModelsForApiKey,
  mockFetchGeminiModelsViaVertexAi,
} = vi.hoisted(() => ({
  mockIsVertexAiEnabled: vi.fn(),
  mockFindSystemKey: vi.fn(),
  mockCreateSystemKey: vi.fn(),
  mockDeleteSystemKey: vi.fn(),
  mockFetchModelsFromApi: vi.fn(),
  mockBulkUpsert: vi.fn(),
  mockBulkUpsertFull: vi.fn(),
  mockSyncModelsForApiKey: vi.fn(),
  mockFetchGeminiModelsViaVertexAi: vi.fn(),
}));

vi.mock("@/clients/gemini-client", () => ({
  isVertexAiEnabled: mockIsVertexAiEnabled,
}));

vi.mock("@/clients/models-dev-client", () => ({
  modelsDevClient: {
    fetchModelsFromApi: mockFetchModelsFromApi,
  },
}));

vi.mock("@/models", () => ({
  ChatApiKeyModel: {
    findSystemKey: mockFindSystemKey,
    createSystemKey: mockCreateSystemKey,
    deleteSystemKey: mockDeleteSystemKey,
  },
  ModelModel: {
    bulkUpsert: mockBulkUpsert,
    bulkUpsertFull: mockBulkUpsertFull,
  },
  ApiKeyModelModel: {
    syncModelsForApiKey: mockSyncModelsForApiKey,
  },
}));

vi.mock("@/routes/chat/routes.models", () => ({
  fetchGeminiModelsViaVertexAi: mockFetchGeminiModelsViaVertexAi,
}));

import { systemKeyManager } from "./system-key-manager";

describe("systemKeyManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockIsVertexAiEnabled.mockReturnValue(true);
    mockFindSystemKey.mockResolvedValue({
      id: "system-key-1",
      provider: "gemini",
    });
    mockFetchModelsFromApi.mockResolvedValue({});
    mockFetchGeminiModelsViaVertexAi.mockResolvedValue([
      {
        id: "gemini-2.5-pro",
        displayName: "Gemini 2.5 Pro",
      },
    ]);
    mockBulkUpsert.mockResolvedValue([
      {
        id: "model-1",
        modelId: "gemini-2.5-pro",
      },
    ]);
    mockBulkUpsertFull.mockResolvedValue([
      {
        id: "model-1",
        modelId: "gemini-2.5-pro",
      },
    ]);
    mockSyncModelsForApiKey.mockResolvedValue(undefined);
  });

  test("uses full upsert semantics during force-refresh syncs", async () => {
    await systemKeyManager.syncSystemKeysWithOptions("org-1", {
      forceRefresh: true,
    });

    expect(mockBulkUpsertFull).toHaveBeenCalledTimes(1);
    expect(mockBulkUpsert).not.toHaveBeenCalled();
  });

  test("keeps the existing non-destructive behavior for normal syncs", async () => {
    await systemKeyManager.syncSystemKeys("org-1");

    expect(mockBulkUpsert).toHaveBeenCalledTimes(1);
    expect(mockBulkUpsertFull).not.toHaveBeenCalled();
  });
});
