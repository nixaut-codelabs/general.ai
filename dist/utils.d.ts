import type { ChatCompletion } from "openai/resources/chat/completions/completions";
import type { Response } from "openai/resources/responses/responses";
import type { GeneralAIContentPart, GeneralAIMessage, GeneralAIMemorySnapshot, GeneralAIPerformanceSummary, GeneralAIUsageSummary } from "./types.js";
interface StepTimingWindow {
    step: number;
    stream: boolean;
    startedAt: number;
    endedAt: number;
    firstTextDeltaAt?: number;
    lastTextDeltaAt?: number;
}
export declare function isRecord(value: unknown): value is Record<string, unknown>;
export declare function asArray<T>(value: T | T[] | undefined): T[];
export declare function cloneMessage(message: GeneralAIMessage): GeneralAIMessage;
export declare function toTextContent(content: string | GeneralAIContentPart[]): string;
export declare function jsonStringify(value: unknown): string;
export declare function compactWhitespace(value: string): string;
export declare function omitUndefined<T extends Record<string, unknown>>(value: T): Partial<T>;
export declare function mergeStringLists(...lists: Array<string[] | undefined>): string[];
export declare function summarizeMessages(messages: GeneralAIMessage[], maxItems?: number): string;
export declare function estimateTextTokens(text: string): number;
export declare function estimateMessagesTokens(messages: GeneralAIMessage[]): number;
export declare function countConversationTurns(messages: GeneralAIMessage[]): number;
export declare function buildMemorySnapshot(messages: GeneralAIMessage[], cleaned: string, notes: string[], previous?: GeneralAIMemorySnapshot | null): GeneralAIMemorySnapshot;
export declare function aggregateUsage(entries: Array<Response | ChatCompletion | undefined>): GeneralAIUsageSummary;
export declare function summarizeUsageEntry(entry: unknown): GeneralAIUsageSummary;
export declare function buildPerformanceSummary(params: {
    runStartedAt: number;
    completedAt: number;
    steps: StepTimingWindow[];
    endpointResults: unknown[];
}): GeneralAIPerformanceSummary;
export {};
