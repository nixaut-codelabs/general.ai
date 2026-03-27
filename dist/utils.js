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
export function estimateTextTokens(text) {
    return Math.ceil(text.length / 4);
}
export function estimateMessagesTokens(messages) {
    return messages.reduce((total, message) => {
        const content = toTextContent(message.content);
        return total + estimateTextTokens(content) + 4;
    }, 0);
}
export function countConversationTurns(messages) {
    let turns = 0;
    let openUserTurn = false;
    for (const message of messages) {
        if (message.role === "user") {
            turns += 1;
            openUserTurn = true;
            continue;
        }
        if (message.role === "assistant" && openUserTurn) {
            openUserTurn = false;
        }
    }
    return turns;
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
    return entries.reduce((summary, entry) => {
        const usage = summarizeUsageEntry(entry);
        summary.inputTokens += usage.inputTokens;
        summary.outputTokens += usage.outputTokens;
        summary.totalTokens += usage.totalTokens;
        summary.cachedInputTokens += usage.cachedInputTokens;
        summary.reasoningTokens += usage.reasoningTokens;
        return summary;
    }, {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
    });
}
export function summarizeUsageEntry(entry) {
    const empty = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
    };
    if (!entry || typeof entry !== "object" || !("usage" in entry) || !entry.usage) {
        return empty;
    }
    const usage = entry.usage;
    if ("input_tokens" in usage) {
        return {
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            totalTokens: usage.total_tokens,
            cachedInputTokens: usage.input_tokens_details.cached_tokens,
            reasoningTokens: usage.output_tokens_details.reasoning_tokens,
        };
    }
    return {
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        cachedInputTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
        reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
    };
}
function roundMetric(value, decimals = 2) {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Number(value.toFixed(decimals));
}
function classifySpeed(value, mode) {
    if (mode === "stream_tps") {
        if (value < 10) {
            return "very_slow";
        }
        if (value < 25) {
            return "slow";
        }
        if (value < 50) {
            return "steady";
        }
        if (value < 100) {
            return "fast";
        }
        return "very_fast";
    }
    if (value < 20) {
        return "very_slow";
    }
    if (value < 60) {
        return "slow";
    }
    if (value < 120) {
        return "steady";
    }
    if (value < 240) {
        return "fast";
    }
    return "very_fast";
}
function createHeuristicSpeedMeasurement(usage, requestTimeMs) {
    const boundedRequestSeconds = Math.max(requestTimeMs / 1000, 0.05);
    const weightedTokens = usage.outputTokens + usage.inputTokens * 0.15;
    const value = roundMetric(weightedTokens / boundedRequestSeconds);
    return {
        mode: "heuristic_speed_index",
        unit: "speed_index",
        value,
        label: classifySpeed(value, "heuristic_speed_index"),
        algorithm: "speed_index = (output_tokens + input_tokens * 0.15) / request_seconds. This is a heuristic, not real TPS.",
    };
}
function createStreamTpsMeasurement(outputTokens, outputWindowMs) {
    const boundedSeconds = Math.max(outputWindowMs / 1000, 0.001);
    const value = roundMetric(outputTokens / boundedSeconds);
    return {
        mode: "stream_tps",
        unit: "tokens_per_second",
        value,
        label: classifySpeed(value, "stream_tps"),
        algorithm: "stream_tps = output_tokens / output_stream_seconds, where output_stream_seconds starts at the first received text delta and ends at the last received text delta (or step completion if only one delta arrives).",
    };
}
function resolveOutputWindowMs(step) {
    if (step.firstTextDeltaAt === undefined) {
        return undefined;
    }
    const lastSignalAt = step.lastTextDeltaAt ?? step.endedAt;
    const fallbackEnd = Math.max(lastSignalAt, step.endedAt);
    return Math.max(fallbackEnd - step.firstTextDeltaAt, 1);
}
function createStepPerformance(step, usage) {
    const durationMs = Math.max(step.endedAt - step.startedAt, 0);
    const firstTokenLatencyMs = step.firstTextDeltaAt !== undefined
        ? Math.max(step.firstTextDeltaAt - step.startedAt, 0)
        : undefined;
    const outputWindowMs = resolveOutputWindowMs(step);
    const speed = step.stream && outputWindowMs !== undefined
        ? createStreamTpsMeasurement(usage.outputTokens, outputWindowMs)
        : createHeuristicSpeedMeasurement(usage, durationMs);
    return omitUndefined({
        step: step.step,
        stream: step.stream,
        durationMs: roundMetric(durationMs),
        firstTokenLatencyMs: firstTokenLatencyMs !== undefined ? roundMetric(firstTokenLatencyMs) : undefined,
        outputWindowMs: outputWindowMs !== undefined ? roundMetric(outputWindowMs) : undefined,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        cachedInputTokens: usage.cachedInputTokens,
        reasoningTokens: usage.reasoningTokens,
        speed,
    });
}
export function buildPerformanceSummary(params) {
    const steps = params.steps.map((step, index) => createStepPerformance(step, summarizeUsageEntry(params.endpointResults[index])));
    const usage = aggregateUsage(params.endpointResults);
    const requestTimeMs = steps.reduce((total, step) => total + step.durationMs, 0);
    const wallTimeMs = Math.max(params.completedAt - params.runStartedAt, 0);
    const firstStreamingStep = params.steps.find((step) => step.firstTextDeltaAt !== undefined);
    const timeToFirstTokenMs = firstStreamingStep?.firstTextDeltaAt !== undefined
        ? roundMetric(Math.max(firstStreamingStep.firstTextDeltaAt - params.runStartedAt, 0))
        : undefined;
    const totalOutputWindowMs = steps.reduce((total, step) => total + (step.outputWindowMs ?? 0), 0);
    const speed = totalOutputWindowMs > 0
        ? createStreamTpsMeasurement(usage.outputTokens, totalOutputWindowMs)
        : createHeuristicSpeedMeasurement(usage, requestTimeMs);
    return omitUndefined({
        wallTimeMs: roundMetric(wallTimeMs),
        requestTimeMs: roundMetric(requestTimeMs),
        timeToFirstTokenMs,
        speed,
        steps,
    });
}
//# sourceMappingURL=utils.js.map