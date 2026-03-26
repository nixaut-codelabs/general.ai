import type { GeneralAIMemoryAdapter, GeneralAIMemoryLoadParams, GeneralAIMemorySaveParams, GeneralAIMemorySnapshot } from "./types.js";
export declare class InMemoryMemoryAdapter implements GeneralAIMemoryAdapter {
    #private;
    load(params: GeneralAIMemoryLoadParams): Promise<GeneralAIMemorySnapshot | null>;
    save(params: GeneralAIMemorySaveParams): Promise<void>;
}
