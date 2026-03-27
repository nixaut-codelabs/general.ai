import type { GeneralAIAgentParams, GeneralAIAgentResult, GeneralAIConstructorOptions, GeneralAINativeSurface } from "./types.js";
export declare class GeneralAI {
    #private;
    readonly openai: NonNullable<GeneralAIConstructorOptions["openai"]> | GeneralAINativeSurface["openai"];
    readonly native: GeneralAINativeSurface;
    readonly agent: {
        generate: (params: GeneralAIAgentParams) => Promise<GeneralAIAgentResult>;
        stream: (params: GeneralAIAgentParams) => AsyncGenerator<import("./types.js").GeneralAIAgentStreamEvent, GeneralAIAgentResult>;
        renderPrompts: (params: GeneralAIAgentParams) => Promise<import("./types.js").GeneralAIRenderedPrompts>;
    };
    constructor(options: GeneralAIConstructorOptions);
}
export default GeneralAI;
