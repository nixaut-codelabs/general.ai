export function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function asArray(value) {
    if (value === undefined) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
}
export function cloneMessage(message) {
    return {
        ...message,
        content: Array.isArray(message.content)
            ? message.content.map((part) => ({ ...part }))
            : message.content,
    };
}
export function toTextContent(content) {
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
export function jsonStringify(value) {
    return JSON.stringify(value, null, 2);
}
export function compactWhitespace(value) {
    return value.replace(/\r\n/g, "\n").trim();
}
export function omitUndefined(value) {
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
        if (entry !== undefined) {
            result[key] = entry;
        }
    }
    return result;
}
export function mergeStringLists(...lists) {
    const output = new Set();
    for (const list of lists) {
        for (const item of list ?? []) {
            if (item.trim()) {
                output.add(item);
            }
        }
    }
    return [...output];
}
export function summarizeMessages(messages, maxItems = 6) {
    return messages
        .slice(-maxItems)
        .map((message) => `${message.role}: ${toTextContent(message.content)}`)
        .join("\n");
}
export function buildMemorySnapshot(messages, cleaned, notes, previous) {
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
export function aggregateUsage(entries) {
    const summary = {
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
            const usage = entry.usage;
            summary.inputTokens += usage.input_tokens;
            summary.outputTokens += usage.output_tokens;
            summary.totalTokens += usage.total_tokens;
            summary.cachedInputTokens += usage.input_tokens_details.cached_tokens;
            summary.reasoningTokens += usage.output_tokens_details.reasoning_tokens;
            continue;
        }
        const usage = entry.usage;
        summary.inputTokens += usage.prompt_tokens;
        summary.outputTokens += usage.completion_tokens;
        summary.totalTokens += usage.total_tokens;
        summary.cachedInputTokens += usage.prompt_tokens_details?.cached_tokens ?? 0;
        summary.reasoningTokens += usage.completion_tokens_details?.reasoning_tokens ?? 0;
    }
    return summary;
}
//# sourceMappingURL=utils.js.map