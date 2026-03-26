import type {
  GeneralAIMemoryAdapter,
  GeneralAIMemoryLoadParams,
  GeneralAIMemorySaveParams,
  GeneralAIMemorySnapshot,
} from "./types.js";

export class InMemoryMemoryAdapter implements GeneralAIMemoryAdapter {
  #store = new Map<string, GeneralAIMemorySnapshot>();

  async load(
    params: GeneralAIMemoryLoadParams,
  ): Promise<GeneralAIMemorySnapshot | null> {
    return this.#store.get(params.sessionId) ?? null;
  }

  async save(params: GeneralAIMemorySaveParams): Promise<void> {
    this.#store.set(params.sessionId, params.snapshot);
  }
}
