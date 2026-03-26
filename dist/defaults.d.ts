import type { GeneralAILimits, GeneralAIPromptOverrides, GeneralAISafetyConfig, GeneralAIThinkingConfig, PromptSectionKey } from "./types.js";
export declare const PROMPT_SECTION_ORDER: PromptSectionKey[];
export declare const PROMPT_SECTION_TITLES: Record<PromptSectionKey, string>;
export declare const DEFAULT_PROMPT_OVERRIDES: GeneralAIPromptOverrides;
export declare const DEFAULT_SAFETY: Required<GeneralAISafetyConfig>;
export declare const DEFAULT_THINKING: Required<GeneralAIThinkingConfig>;
export declare const DEFAULT_LIMITS: Required<GeneralAILimits>;
