import type OpenAI from "openai";
import type { ResponseCreateParams, WebSearchTool } from "openai/resources/responses/responses";
import type { GeneralAIToolDefinition, GeneralAISubagentDefinition } from "./types.js";
export declare function defineTool<TArgs = Record<string, unknown>, TResult = unknown>(definition: GeneralAIToolDefinition<TArgs, TResult>): GeneralAIToolDefinition<TArgs, TResult>;
export declare function defineSubagent(definition: GeneralAISubagentDefinition): GeneralAISubagentDefinition;
export interface OpenAIWebSearchToolOptions {
    openai: OpenAI;
    name?: string;
    model?: string;
    description?: string;
    search_context_size?: WebSearchTool["search_context_size"];
    user_location?: WebSearchTool["user_location"];
    filters?: WebSearchTool["filters"];
    request?: Partial<ResponseCreateParams>;
}
export declare function createOpenAIWebSearchTool(options: OpenAIWebSearchToolOptions): GeneralAIToolDefinition<{
    query: string;
}, {
    answer: string;
    response: unknown;
}>;
