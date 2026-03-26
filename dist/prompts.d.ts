import type { GeneralAIPromptOverrides, GeneralAIPromptPack, GeneralAIRenderedPrompts } from "./types.js";
export interface PromptRenderContext {
    data: Record<string, string | number | boolean | null | undefined>;
    blocks: Record<string, string | undefined>;
}
export declare function renderPromptSections(options: {
    promptPack?: GeneralAIPromptPack;
    constructorOverrides?: GeneralAIPromptOverrides;
    runtimeOverrides?: GeneralAIPromptOverrides;
    context: PromptRenderContext;
}): Promise<GeneralAIRenderedPrompts>;
