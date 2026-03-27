import type { GeneralAIAgentParams, GeneralAIAgentResult, GeneralAIAgentStreamEvent, GeneralAILibraryDefaults, GeneralAIMemoryAdapter, GeneralAIPromptPack, GeneralAIProviderClientLike } from "./types.js";
interface AgentRuntimeDependencies {
    openai: GeneralAIProviderClientLike;
    defaults?: GeneralAILibraryDefaults;
    promptPack?: GeneralAIPromptPack;
    memoryAdapter: GeneralAIMemoryAdapter;
    debug: boolean;
    runSubagent(params: GeneralAIAgentParams, depth: number): Promise<GeneralAIAgentResult>;
}
export declare class AgentRuntime {
    #private;
    private readonly deps;
    private readonly depth;
    constructor(deps: AgentRuntimeDependencies, params: GeneralAIAgentParams, depth?: number);
    renderPrompts(): Promise<import("./types.js").GeneralAIRenderedPrompts>;
    run(): Promise<GeneralAIAgentResult>;
    stream(): AsyncGenerator<GeneralAIAgentStreamEvent, GeneralAIAgentResult>;
}
export {};
