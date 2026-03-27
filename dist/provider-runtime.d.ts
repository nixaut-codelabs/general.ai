import type { ChatCompletion, ChatCompletionCreateParams } from "openai/resources/chat/completions/completions";
import type { Response, ResponseCreateParams } from "openai/resources/responses/responses";
import type { GeneralAINativeSurface, GeneralAIProviderClientLike, GeneralAIProviderConfig } from "./types.js";
export declare class ProviderRuntime {
    #private;
    readonly config: Required<Pick<GeneralAIProviderConfig, "baseURL">> & Omit<GeneralAIProviderConfig, "baseURL">;
    readonly nativeSurface: GeneralAINativeSurface;
    constructor(config: GeneralAIProviderConfig, openaiFactory?: (options: {
        apiKey: string;
        baseURL: string;
        defaultHeaders?: Record<string, string>;
        defaultQuery?: Record<string, string>;
        timeout?: number;
    }) => GeneralAIProviderClientLike);
    responsesCreate(body: ResponseCreateParams): Promise<Response>;
    chatCreate(body: ChatCompletionCreateParams): Promise<ChatCompletion>;
    responsesStream(body: ResponseCreateParams): unknown;
    chatStream(body: ChatCompletionCreateParams): unknown;
}
