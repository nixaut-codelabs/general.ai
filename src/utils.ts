import type { ChatCompletion } from "openai/resources/chat/completions/completions";
import type { CompletionUsage } from "openai/resources/completions";
import type { Response, ResponseUsage } from "openai/resources/responses/responses";
import type {
  GeneralAIContentPart,
  GeneralAIMessage,
  GeneralAIMemorySnapshot,
  GeneralAIUsageSummary,
} from "./types.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

export function cloneMessage(message: GeneralAIMessage): GeneralAIMessage {
  return {
    ...message,
    content: Array.isArray(message.content)
      ? message.content.map((part) => ({ ...part }))
      : message.content,
  };
}

export function toTextContent(content: string | GeneralAIContentPart[]): string {
  if (typeof content === "string") {
    return content;
  }

  return content
    .map((part) => {
      switch (part.type) {
        case "text":
          return part.text;
        case "image_url":
          return `[image:${part.url}]`;
        case "input_audio":
          return "[audio]";
        case "input_file":
          return `[file:${part.filename ?? part.file_id ?? part.file_url ?? "unknown"}]`;
        default:
          return "";
      }
    })
    .filter(Boolean)
    .join("\n");
}

export function jsonStringify(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function compactWhitespace(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

export function omitUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  const result: Partial<T> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      result[key as keyof T] = entry as T[keyof T];
    }
  }

  return result;
}

export function mergeStringLists(...lists: Array<string[] | undefined>): string[] {
  const output = new Set<string>();

  for (const list of lists) {
    for (const item of list ?? []) {
      if (item.trim()) {
        output.add(item);
      }
    }
  }

  return [...output];
}

export function summarizeMessages(messages: GeneralAIMessage[], maxItems = 6): string {
  return messages
    .slice(-maxItems)
    .map((message) => `${message.role}: ${toTextContent(message.content)}`)
    .join("\n");
}

export function buildMemorySnapshot(
  messages: GeneralAIMessage[],
  cleaned: string,
  notes: string[],
  previous?: GeneralAIMemorySnapshot | null,
): GeneralAIMemorySnapshot {
  const summaryParts = [
    previous?.summary,
    summarizeMessages(messages, 4),
    cleaned ? `Latest cleaned output:\n${cleaned}` : "",
  ].filter(Boolean);

  return {
    summary: summaryParts.join("\n\n").trim(),
    preferences: mergeStringLists(previous?.preferences),
    notes: mergeStringLists(previous?.notes, notes),
    metadata: previous?.metadata,
  };
}

export function aggregateUsage(
  entries: Array<Response | ChatCompletion | undefined>,
): GeneralAIUsageSummary {
  const summary: GeneralAIUsageSummary = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
  };

  for (const entry of entries) {
    if (!entry || !("usage" in entry) || !entry.usage) {
      continue;
    }

    if ("input_tokens" in entry.usage) {
      const usage = entry.usage as ResponseUsage;
      summary.inputTokens += usage.input_tokens;
      summary.outputTokens += usage.output_tokens;
      summary.totalTokens += usage.total_tokens;
      summary.cachedInputTokens += usage.input_tokens_details.cached_tokens;
      summary.reasoningTokens += usage.output_tokens_details.reasoning_tokens;
      continue;
    }

    const usage = entry.usage as CompletionUsage;
    summary.inputTokens += usage.prompt_tokens;
    summary.outputTokens += usage.completion_tokens;
    summary.totalTokens += usage.total_tokens;
    summary.cachedInputTokens += usage.prompt_tokens_details?.cached_tokens ?? 0;
    summary.reasoningTokens += usage.completion_tokens_details?.reasoning_tokens ?? 0;
  }

  return summary;
}
