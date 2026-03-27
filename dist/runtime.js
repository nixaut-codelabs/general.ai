import { DEFAULT_CONTEXT, DEFAULT_INTELLIGENCE, DEFAULT_LIMITS, DEFAULT_PARALLEL, DEFAULT_PRESET, DEFAULT_SAFETY, DEFAULT_THINKING, } from "./defaults.js";
import { compileMessagesForChatCompletions, compileMessagesForResponses, extractChatTextDelta, extractTextFromChatCompletion, extractTextFromResponse, getReservedRequestKeys, resolveCompatibilityProfile, stripReservedRequestKeys, RESERVED_AGENT_CHAT_KEYS, RESERVED_AGENT_RESPONSE_KEYS, } from "./endpoint-adapters.js";
import { renderPromptSections } from "./prompts.js";
import { inferImplicitDoneEvent, inferImplicitSafetyEvents, parseProtocol, ProtocolStreamParser, validateProtocolSequence, } from "./protocol.js";
import { aggregateUsage, buildPerformanceSummary, buildMemorySnapshot, cloneMessage, countConversationTurns, estimateMessagesTokens, jsonStringify, mergeStringLists, omitUndefined, summarizeMessages, toTextContent, } from "./utils.js";
function toRegistry(value) {
    if (!value) {
        return {};
    }
    if (Array.isArray(value)) {
        return Object.fromEntries(value.map((entry) => [entry.name, entry]));
    }
    return { ...value };
}
function mergePromptOverrides(base, extra) {
    return {
        sections: {
            ...base?.sections,
            ...extra?.sections,
        },
        raw: {
            ...base?.raw,
            ...extra?.raw,
        },
        data: {
            ...base?.data,
            ...extra?.data,
        },
        blocks: {
            ...base?.blocks,
            ...extra?.blocks,
        },
    };
}
function mergeRequestOverrides(base, extra) {
    const merged = omitUndefined({
        responses: base?.responses || extra?.responses
            ? {
                ...base?.responses,
                ...extra?.responses,
            }
            : undefined,
        chat_completions: base?.chat_completions || extra?.chat_completions
            ? {
                ...base?.chat_completions,
                ...extra?.chat_completions,
            }
            : undefined,
    });
    return Object.keys(merged).length > 0 ? merged : undefined;
}
function mergeConfigRecords(...records) {
    return Object.assign({}, ...records);
}
function mergeNestedConfig(base, extra) {
    return {
        ...(base ?? {}),
        ...(extra ?? {}),
    };
}
function getPresetOverrides(preset) {
    switch (preset) {
        case "strict":
            return {
                safety: {
                    enabled: true,
                    mode: "strict",
                },
                thinking: {
                    enabled: true,
                    mode: "inline",
                    strategy: "checkpointed",
                    effort: "medium",
                    checkpointFormat: "structured",
                },
            };
        case "fast":
            return {
                thinking: {
                    enabled: true,
                    mode: "inline",
                    strategy: "minimal",
                    effort: "low",
                    checkpoints: [
                        "Before visible writing",
                        "Before final completion",
                    ],
                },
                context: {
                    enabled: false,
                    mode: "off",
                },
                limits: {
                    maxSteps: 4,
                    maxThinkingBlocks: 4,
                },
            };
        case "agentic":
            return {
                thinking: {
                    enabled: true,
                    mode: "hybrid",
                    strategy: "checkpointed",
                    effort: "high",
                },
                parallel: {
                    enabled: true,
                    maxParallelActions: 6,
                    maxParallelTools: 6,
                    maxParallelSubagents: 3,
                    maxCallsPerStep: 8,
                },
                limits: {
                    maxSteps: 10,
                    maxParallelActions: 6,
                    maxParallelTools: 6,
                    maxParallelSubagents: 3,
                    maxCallsPerStep: 8,
                },
            };
        case "classic_safe":
            return {
                compatibility: {
                    profile: "classic_v2",
                },
                safety: {
                    enabled: true,
                    mode: "balanced",
                },
                thinking: {
                    enabled: true,
                    mode: "inline",
                    strategy: "checkpointed",
                    effort: "medium",
                },
            };
        case "research":
            return {
                thinking: {
                    enabled: true,
                    mode: "hybrid",
                    strategy: "checkpointed",
                    effort: "high",
                },
                context: {
                    enabled: true,
                    mode: "hybrid",
                    strategy: "summarize",
                    keep: {
                        recentMessages: 8,
                        boundaryUserMessages: 2,
                        boundaryAssistantMessages: 2,
                    },
                    summary: {
                        profile: "comprehensive",
                        maxItems: 12,
                    },
                },
                limits: {
                    maxSteps: 12,
                    maxThinkingBlocks: 12,
                    maxToolCalls: 8,
                    maxSubagentCalls: 4,
                },
            };
        case "balanced":
        default:
            return {};
    }
}
function normalizeAgentParams(deps, params) {
    const defaults = deps.defaults?.agent;
    const preset = params.preset ?? defaults?.preset ?? DEFAULT_PRESET;
    const intelligence = params.intelligence ?? defaults?.intelligence ?? DEFAULT_INTELLIGENCE;
    const presetOverrides = getPresetOverrides(preset);
    const safetyInput = {
        ...DEFAULT_SAFETY.input,
        ...defaults?.safety?.input,
        ...presetOverrides.safety?.input,
        ...params.safety?.input,
    };
    const safetyOutput = {
        ...DEFAULT_SAFETY.output,
        ...defaults?.safety?.output,
        ...presetOverrides.safety?.output,
        ...params.safety?.output,
    };
    const thinking = {
        ...DEFAULT_THINKING,
        ...defaults?.thinking,
        ...presetOverrides.thinking,
        ...params.thinking,
        checkpoints: params.thinking?.checkpoints ??
            presetOverrides.thinking?.checkpoints ??
            defaults?.thinking?.checkpoints ??
            DEFAULT_THINKING.checkpoints,
    };
    const limits = {
        ...DEFAULT_LIMITS,
        ...defaults?.limits,
        ...presetOverrides.limits,
        ...params.limits,
    };
    const parallel = {
        ...DEFAULT_PARALLEL,
        ...defaults?.parallel,
        ...presetOverrides.parallel,
        ...params.parallel,
        maxParallelActions: params.parallel?.maxParallelActions ??
            defaults?.parallel?.maxParallelActions ??
            limits.maxParallelActions,
        maxParallelTools: params.parallel?.maxParallelTools ??
            defaults?.parallel?.maxParallelTools ??
            limits.maxParallelTools,
        maxParallelSubagents: params.parallel?.maxParallelSubagents ??
            defaults?.parallel?.maxParallelSubagents ??
            limits.maxParallelSubagents,
        maxCallsPerStep: params.parallel?.maxCallsPerStep ??
            defaults?.parallel?.maxCallsPerStep ??
            limits.maxCallsPerStep,
    };
    const context = {
        ...DEFAULT_CONTEXT,
        ...defaults?.context,
        ...presetOverrides.context,
        ...params.context,
        trigger: mergeNestedConfig(mergeNestedConfig(DEFAULT_CONTEXT.trigger, defaults?.context?.trigger), params.context?.trigger),
        keep: mergeNestedConfig(mergeNestedConfig(DEFAULT_CONTEXT.keep, defaults?.context?.keep), params.context?.keep),
        summary: mergeNestedConfig(mergeNestedConfig(DEFAULT_CONTEXT.summary, defaults?.context?.summary), params.context?.summary),
        manual: mergeNestedConfig(mergeNestedConfig(DEFAULT_CONTEXT.manual, defaults?.context?.manual), params.context?.manual),
    };
    const safety = {
        ...DEFAULT_SAFETY,
        ...defaults?.safety,
        ...presetOverrides.safety,
        ...params.safety,
        input: safetyInput,
        output: safetyOutput,
    };
    const defaultTools = toRegistry(defaults?.tools?.registry);
    const runtimeTools = toRegistry(params.tools?.registry);
    const defaultSubagents = toRegistry(defaults?.subagents?.registry);
    const runtimeSubagents = toRegistry(params.subagents?.registry);
    const memoryConfig = {
        enabled: params.memory?.enabled ?? defaults?.memory?.enabled ?? true,
        sessionId: params.memory?.sessionId ?? defaults?.memory?.sessionId,
        load: params.memory?.load ?? defaults?.memory?.load ?? true,
        save: params.memory?.save ?? defaults?.memory?.save ?? true,
        adapter: params.memory?.adapter ?? deps.memoryAdapter,
        prompt: params.memory?.prompt ?? defaults?.memory?.prompt,
    };
    return {
        ...params,
        preset,
        intelligence,
        debug: params.debug ?? defaults?.debug ?? deps.defaults?.debug ?? deps.debug,
        safety,
        thinking,
        limits,
        parallel,
        context,
        prompts: mergePromptOverrides(defaults?.prompts, params.prompts),
        tools: {
            enabled: params.tools?.enabled ?? defaults?.tools?.enabled ?? true,
            registry: {
                ...defaultTools,
                ...runtimeTools,
            },
            prompt: params.tools?.prompt ?? defaults?.tools?.prompt,
        },
        subagents: {
            enabled: params.subagents?.enabled ?? defaults?.subagents?.enabled ?? true,
            registry: {
                ...defaultSubagents,
                ...runtimeSubagents,
            },
            prompt: params.subagents?.prompt ?? defaults?.subagents?.prompt,
        },
        memory: memoryConfig,
        personality: {
            enabled: params.personality?.enabled ?? defaults?.personality?.enabled ?? true,
            profile: params.personality?.profile ?? defaults?.personality?.profile,
            persona: mergeConfigRecords(defaults?.personality?.persona, params.personality?.persona),
            style: mergeConfigRecords(defaults?.personality?.style, params.personality?.style),
            behavior: mergeConfigRecords(defaults?.personality?.behavior, params.personality?.behavior),
            boundaries: mergeConfigRecords(defaults?.personality?.boundaries, params.personality?.boundaries),
            instructions: params.personality?.instructions ??
                defaults?.personality?.instructions,
            prompt: params.personality?.prompt ?? defaults?.personality?.prompt,
        },
        compatibility: {
            ...defaults?.compatibility,
            ...presetOverrides.compatibility,
            ...params.compatibility,
        },
    };
}
function renderConfigMap(title, value) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
        return "";
    }
    return [`${title}:`, ...entries.map(([key, entry]) => `- ${key}: ${entry}`)].join("\n");
}
function renderToolsBlock(tools) {
    if (!tools.enabled) {
        return "";
    }
    const lines = [];
    const toolsList = Object.values(tools.registry);
    if (toolsList.length > 0) {
        lines.push("Tools:");
        lines.push("Available protocol tools:");
        for (const tool of toolsList) {
            lines.push(`- ${tool.name}: ${tool.description}`);
            if (tool.inputSchema) {
                lines.push(`  Input schema: ${jsonStringify(tool.inputSchema)}`);
            }
            if (tool.access) {
                const subagentsAccess = tool.access.subagents === undefined
                    ? "all configured subagents"
                    : Array.isArray(tool.access.subagents)
                        ? tool.access.subagents.join(", ")
                        : tool.access.subagents
                            ? "all configured subagents"
                            : "disabled";
                lines.push(`  Access: root=${String(tool.access.root ?? true)}, subagents=${subagentsAccess}`);
            }
            if (tool.metadata && Object.keys(tool.metadata).length > 0) {
                lines.push(`  Metadata: ${jsonStringify(tool.metadata)}`);
            }
        }
    }
    if (tools.prompt?.trim()) {
        if (lines.length > 0) {
            lines.push("");
        }
        lines.push(tools.prompt.trim());
    }
    return lines.join("\n");
}
function isToolAllowedForSubagent(tool, subagentName) {
    if (tool.access?.root === false && tool.access?.subagents === undefined) {
        return false;
    }
    const access = tool.access?.subagents;
    if (access === undefined) {
        return true;
    }
    if (typeof access === "boolean") {
        return access;
    }
    return access.includes(subagentName);
}
function filterToolsForSubagent(tools, subagentName) {
    if (!tools.enabled) {
        return {
            enabled: false,
            registry: {},
            prompt: tools.prompt,
        };
    }
    const registry = Object.fromEntries(Object.entries(tools.registry).filter(([, tool]) => isToolAllowedForSubagent(tool, subagentName)));
    return {
        enabled: Object.keys(registry).length > 0,
        registry,
        prompt: tools.prompt,
    };
}
function renderSubagentsBlock(subagents) {
    if (!subagents.enabled) {
        return "";
    }
    const lines = [];
    const subagentsList = Object.values(subagents.registry);
    if (subagentsList.length > 0) {
        lines.push("Subagents:");
        lines.push("Available protocol subagents:");
        for (const subagent of subagentsList) {
            lines.push(`- ${subagent.name}: ${subagent.description}`);
        }
    }
    if (subagents.prompt?.trim()) {
        if (lines.length > 0) {
            lines.push("");
        }
        lines.push(subagents.prompt.trim());
    }
    return lines.join("\n");
}
function renderPersonalityBlock(params) {
    if (!params.personality?.enabled) {
        return "";
    }
    const sections = [
        params.personality.profile
            ? `Profile: ${params.personality.profile}`
            : "",
        renderConfigMap("Persona", params.personality.persona ?? {}),
        renderConfigMap("Style", params.personality.style ?? {}),
        renderConfigMap("Behavior", params.personality.behavior ?? {}),
        renderConfigMap("Boundaries", params.personality.boundaries ?? {}),
        params.personality.instructions
            ? `Instructions:\n${params.personality.instructions}`
            : "",
        params.personality.prompt ?? "",
    ].filter(Boolean);
    return sections.join("\n\n").trim();
}
function renderSafetyBlock(params) {
    if (!params.safety.enabled) {
        return "";
    }
    const blocks = [
        `Safety mode: ${params.safety.enabled ? params.safety.mode : "off"}`,
        `Input safety enabled: ${String(params.safety.input.enabled)}`,
        `Output safety enabled: ${String(params.safety.output.enabled)}`,
        params.safety.input.instructions
            ? `Input safety instructions:\n${params.safety.input.instructions}`
            : "",
        params.safety.output.instructions
            ? `Output safety instructions:\n${params.safety.output.instructions}`
            : "",
        params.safety.prompt ?? "",
    ].filter(Boolean);
    return blocks.join("\n\n");
}
function renderThinkingBlock(params) {
    if (!params.thinking.enabled) {
        return "";
    }
    const checkpoints = params.thinking.checkpoints.map((value) => `- ${value}`).join("\n");
    return [
        `Thinking enabled: ${String(params.thinking.enabled)}`,
        `Thinking mode: ${params.thinking.mode}`,
        `Thinking strategy: ${params.thinking.strategy}`,
        `Thinking effort: ${params.thinking.effort}`,
        `Checkpoint format: ${params.thinking.checkpointFormat}`,
        `Thinking checkpoints:\n${checkpoints}`,
        params.thinking.prompt ?? "",
    ]
        .filter(Boolean)
        .join("\n\n");
}
function renderProtocolSafetySingleLineMarkers(params) {
    if (!params.safety.enabled) {
        return "";
    }
    return [
        "- `[[[status:input_safety:{...}]]]`",
        "- `[[[status:output_safety:{...}]]]`",
    ].join("\n");
}
function renderProtocolSafetyBlockMarkers(params) {
    if (!params.safety.enabled) {
        return "";
    }
    return [
        "- `[[[status:input_safety]]]` followed by a JSON object on the next lines",
        "- `[[[status:output_safety]]]` followed by a JSON object on the next lines",
    ].join("\n");
}
function renderProtocolTargetSequence(params) {
    if (!params.thinking.enabled && !params.safety.enabled) {
        return [
            "1. Continue with `writing`, `checkpoint`, `revise`, `call_tool`, or `call_subagent` as needed.",
            "2. Prefer `done` when the answer is fully complete.",
        ].join("\n");
    }
    if (!params.thinking.enabled) {
        return [
            "1. Emit `input_safety`.",
            "2. If the request is blocked, write a refusal and prefer `done` when the refusal is complete.",
            "3. Otherwise continue with `writing`, `checkpoint`, `revise`, `call_tool`, or `call_subagent` as needed.",
            "4. Emit exactly one final `output_safety` near the end unless an early hard refusal is required.",
            "5. Prefer `done` when the answer is fully complete.",
        ].join("\n");
    }
    if (!params.safety.enabled) {
        return [
            "1. Start with `thinking`.",
            "2. Continue with `writing`, `checkpoint`, `revise`, `call_tool`, or `call_subagent` as needed.",
            "3. Prefer `done` when the answer is fully complete.",
        ].join("\n");
    }
    return [
        "1. Start with `thinking`.",
        "2. Emit `input_safety`.",
        "3. If the request is blocked, write a refusal and prefer `done` when the refusal is complete.",
        "4. Otherwise continue with `writing`, `checkpoint`, `revise`, `call_tool`, or `call_subagent` as needed.",
        "5. Emit exactly one final `output_safety` near the end unless an early hard refusal is required.",
        "6. Prefer `done` when the answer is fully complete.",
    ].join("\n");
}
function renderMemoryBlock(params, snapshot) {
    if (!params.memory.enabled) {
        return "";
    }
    return [
        snapshot?.summary ? `Summary:\n${snapshot.summary}` : "",
        snapshot?.preferences?.length
            ? `Preferences:\n${snapshot.preferences?.map((value) => `- ${value}`).join("\n")}`
            : "",
        snapshot?.notes?.length
            ? `Notes:\n${snapshot.notes?.map((value) => `- ${value}`).join("\n")}`
            : "",
        params.memory.prompt ?? "",
    ]
        .filter(Boolean)
        .join("\n\n")
        .trim();
}
function renderTaskBlock(params) {
    const metadata = params.metadata && Object.keys(params.metadata).length > 0
        ? Object.entries(params.metadata)
            .map(([key, value]) => `- ${key}: ${value}`)
            .join("\n")
        : "No additional run metadata was provided.";
    return [
        `Endpoint: ${params.endpoint}`,
        `Model: ${params.model}`,
        `Compatibility profile: ${resolveCompatibilityProfile(params.compatibility)}`,
        params.parallel.enabled ? `Parallel actions enabled: ${String(params.parallel.enabled)}` : "",
        params.context.enabled && params.context.mode !== "off"
            ? `Context management mode: ${params.context.mode}`
            : "",
        params.context.enabled && params.context.mode !== "off"
            ? `Context strategy: ${params.context.strategy}`
            : "",
        `Conversation preview:\n${summarizeMessages(params.messages)}`,
        `Run metadata:\n${metadata}`,
    ]
        .filter(Boolean)
        .join("\n\n");
}
function renderIntelligenceIdentityGuidance(params) {
    switch (params.intelligence) {
        case "minimal":
            return [
                "Current model guidance level: minimal.",
                "- Use the protocol conservatively and explicitly.",
                "- Prefer cleaner marker discipline over clever shortcuts.",
                "- When uncertain, choose the most parseable valid form.",
            ].join("\n");
        case "high":
            return [
                "Current model guidance level: high.",
                "- Treat the protocol as a lightweight runtime contract.",
                "- Do not over-explain your process unless the task truly benefits.",
                "- Stay concise and capable rather than verbose.",
            ].join("\n");
        case "medium":
        default:
            return [
                "Current model guidance level: medium.",
                "- Follow the protocol carefully without over-explaining it.",
            ].join("\n");
    }
}
function renderIntelligenceProtocolGuidance(params) {
    switch (params.intelligence) {
        case "minimal":
            return [
                "Adaptive protocol guidance:",
                "- Prefer one clear marker per line with no extra prose around it.",
                "- Use canonical marker forms whenever possible.",
                "- If you finish the answer, prefer emitting `done` explicitly.",
            ].join("\n");
        case "high":
            return [
                "Adaptive protocol guidance:",
                "- Keep protocol usage tight and minimal.",
                "- `done` is preferred when the answer is fully complete, but do not over-focus on ceremonial markers at the expense of a strong answer.",
            ].join("\n");
        case "medium":
        default:
            return [
                "Adaptive protocol guidance:",
                "- Prefer explicit `done` when the answer is complete.",
            ].join("\n");
    }
}
function renderIntelligenceThinkingGuidance(params) {
    if (!params.thinking.enabled) {
        return "";
    }
    switch (params.intelligence) {
        case "minimal":
            return [
                "Adaptive thinking guidance:",
                "- Keep each thinking block concrete and short.",
                "- Use checkpoints to avoid losing state between steps.",
            ].join("\n");
        case "high":
            return [
                "Adaptive thinking guidance:",
                "- Think only when it materially improves the answer.",
                "- Avoid repetitive checkpointing or self-commentary.",
            ].join("\n");
        case "medium":
        default:
            return [
                "Adaptive thinking guidance:",
                "- Use thinking deliberately at real task transitions, not on every sentence.",
            ].join("\n");
    }
}
function renderIntelligenceToolsSubagentsGuidance(params) {
    const hasTools = hasActiveToolsSection(params);
    const hasSubagents = hasActiveSubagentsSection(params);
    if (!hasTools && !hasSubagents) {
        return "";
    }
    switch (params.intelligence) {
        case "minimal":
            return [
                "Adaptive tool and subagent guidance:",
                "- Only call listed tools or subagents.",
                "- If multiple independent calls are required, batch them clearly.",
                "- After results arrive, continue from those results instead of re-planning from scratch.",
            ].join("\n");
        case "high":
            return [
                "Adaptive tool and subagent guidance:",
                "- Use tools or subagents when they genuinely improve quality, not automatically.",
                "- Avoid redundant calls and move quickly once results are sufficient.",
            ].join("\n");
        case "medium":
        default:
            return [
                "Adaptive tool and subagent guidance:",
                "- Prefer the smallest number of calls that materially improves the answer.",
            ].join("\n");
    }
}
function renderIntelligenceTaskGuidance(params) {
    return [
        `Preset: ${params.preset}`,
        `Intelligence guidance level: ${params.intelligence}`,
    ].join("\n");
}
function hasActivePersonalityConfig(params) {
    if (!params.personality?.enabled) {
        return false;
    }
    return Boolean(params.personality.profile ||
        Object.keys(params.personality.persona ?? {}).length > 0 ||
        Object.keys(params.personality.style ?? {}).length > 0 ||
        Object.keys(params.personality.behavior ?? {}).length > 0 ||
        Object.keys(params.personality.boundaries ?? {}).length > 0 ||
        params.personality.instructions?.trim() ||
        params.personality.prompt?.trim());
}
function hasActiveThinkingConfig(params) {
    return params.thinking.enabled;
}
function hasActiveToolsSection(params) {
    return (params.tools.enabled &&
        (Object.keys(params.tools.registry).length > 0 || Boolean(params.tools.prompt?.trim())));
}
function hasActiveSubagentsSection(params) {
    return (params.subagents.enabled &&
        (Object.keys(params.subagents.registry).length > 0 || Boolean(params.subagents.prompt?.trim())));
}
function hasActiveMemorySection(params, snapshot) {
    return (params.memory.enabled &&
        Boolean(snapshot?.summary ||
            snapshot?.preferences?.length ||
            snapshot?.notes?.length ||
            params.memory.prompt?.trim()));
}
function renderToolsAndSubagentsSelectionRules(params) {
    const hasTools = hasActiveToolsSection(params);
    const hasSubagents = hasActiveSubagentsSection(params);
    if (!hasTools && !hasSubagents) {
        return "";
    }
    const lines = ["Selection rules:"];
    if (hasTools) {
        lines.push("- Use a tool when external execution or retrieval is clearly better than guessing.");
    }
    if (hasSubagents) {
        lines.push("- Use a subagent when a specialized delegated pass is materially better than continuing alone.");
    }
    lines.push("- Do not call the same tool or subagent redundantly.");
    lines.push("- If multiple independent tools or subagents are needed, batch them in one turn instead of scattering redundant follow-up calls.");
    lines.push("- After receiving a tool or subagent result, reassess before continuing.");
    if (hasSubagents) {
        lines.push("- If no nested subagents are available inside a delegated subagent run, finish the task directly instead of trying to delegate again.");
    }
    if (hasTools && hasSubagents) {
        lines.push("- If tools are available inside a subagent run, use only the tools allowed for that subagent.");
    }
    lines.push("- Never ask the user to manually add protocol reminders that the runtime already supplied.");
    return lines.join("\n");
}
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function isRuntimeInstructionMessage(message) {
    return (message.role === "developer" ||
        (message.role === "assistant" && message.phase === "commentary"));
}
function collectBoundaryMessages(messages, keep) {
    const boundary = [];
    let userCount = 0;
    let assistantCount = 0;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (!message) {
            continue;
        }
        if (message.role === "user" &&
            userCount < (keep.boundaryUserMessages ?? 0)) {
            boundary.push(message);
            userCount += 1;
            continue;
        }
        if (message.role === "assistant" &&
            assistantCount < (keep.boundaryAssistantMessages ?? 0)) {
            boundary.push(message);
            assistantCount += 1;
        }
    }
    return boundary.reverse();
}
function dedupeMessages(messages) {
    const seen = new Set();
    const result = [];
    for (const message of messages) {
        const key = `${message.role}:${message.phase ?? ""}:${toTextContent(message.content)}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(message);
    }
    return result;
}
function normalizeComparableText(text) {
    return text.replace(/\s+/g, " ").trim();
}
function buildSummaryText(messages, params) {
    const profile = params.context.summary.profile ?? "balanced";
    const maxItems = params.context.summary.maxItems ?? 8;
    const snippetLength = {
        minimal: 80,
        balanced: 140,
        detailed: 220,
        comprehensive: 320,
    }[profile] ?? 140;
    const userMessages = messages.filter((message) => message.role === "user");
    const assistantMessages = messages.filter((message) => message.role === "assistant");
    const instructionMessages = messages.filter((message) => isRuntimeInstructionMessage(message));
    const takeSnippets = (items) => items.slice(-maxItems).map((message) => {
        const text = toTextContent(message.content).replace(/\s+/g, " ").trim();
        return text.length > snippetLength ? `${text.slice(0, snippetLength)}...` : text;
    }).filter(Boolean);
    const sections = [];
    sections.push(`Summary profile: ${profile}`);
    if (params.context.manual.includeUserIntent && params.context.manual.note?.trim()) {
        sections.push(`Manual retention note:\n- ${params.context.manual.note.trim()}`);
    }
    const userSnippets = takeSnippets(userMessages);
    if (userSnippets.length > 0) {
        sections.push(`User intents:\n${userSnippets.map((text) => `- ${text}`).join("\n")}`);
    }
    if (params.context.summary.includeFacts) {
        const assistantSnippets = takeSnippets(assistantMessages);
        if (assistantSnippets.length > 0) {
            sections.push(`Assistant outputs and facts:\n${assistantSnippets.map((text) => `- ${text}`).join("\n")}`);
        }
    }
    if (params.context.summary.includeDecisions && instructionMessages.length > 0) {
        const instructionSnippets = takeSnippets(instructionMessages);
        sections.push(`Runtime decisions and tool/subagent notes:\n${instructionSnippets.map((text) => `- ${text}`).join("\n")}`);
    }
    if (params.context.summary.includeOpenLoops) {
        const latestUser = userMessages.at(-1);
        if (latestUser) {
            sections.push(`Open loop focus:\n- ${toTextContent(latestUser.content).trim()}`);
        }
    }
    return sections.join("\n\n").trim();
}
function dropOldestMessages(messages, keepRecentMessages) {
    if (messages.length <= keepRecentMessages) {
        return { kept: messages, droppedCount: 0 };
    }
    const droppedCount = messages.length - keepRecentMessages;
    return {
        kept: messages.slice(-keepRecentMessages),
        droppedCount,
    };
}
export class AgentRuntime {
    deps;
    depth;
    #params;
    #history;
    #memorySnapshot = null;
    #memoryLoaded = false;
    #prompt;
    #promptPromise;
    #events = [];
    #rawOutputs = [];
    #cleanedChunks = [];
    #warnings = [];
    #endpointResults = [];
    #step = 0;
    #toolCallCount = 0;
    #subagentCallCount = 0;
    #protocolErrorCount = 0;
    #notes = [];
    #contextOperations = [];
    #contextSummaryCount = 0;
    #contextDropCount = 0;
    #runStartedAt = 0;
    #stepTimings = [];
    #writingFingerprints = [];
    constructor(deps, params, depth = 0) {
        this.deps = deps;
        this.depth = depth;
        this.#params = normalizeAgentParams(deps, params);
        this.#history = params.messages.map(cloneMessage);
    }
    async renderPrompts() {
        await this.#ensureMemory();
        return await this.#ensurePrompt();
    }
    #canRetryProtocolError() {
        return this.#protocolErrorCount < this.#params.limits.maxProtocolErrors;
    }
    #enqueueRetry(reason, detail, rawOutput) {
        if (!this.#canRetryProtocolError()) {
            return false;
        }
        this.#protocolErrorCount += 1;
        this.#warnings.push(`Retrying after recoverable runtime issue ${this.#protocolErrorCount}/${this.#params.limits.maxProtocolErrors}: ${reason}. ${detail}`);
        if (rawOutput) {
            this.#history.push({
                role: "assistant",
                phase: "commentary",
                content: rawOutput,
            });
        }
        this.#history.push({
            role: "developer",
            content: [
                `Recoverable runtime issue: ${reason}.`,
                detail,
                "Retry the request from the latest valid state.",
                "Follow the General.AI protocol exactly.",
                "Emit every protocol marker on its own line starting at column 1.",
                "Do not place multiple markers on the same line.",
                "If you call a tool or subagent, emit only that marker and then stop the turn.",
                "If a previous tool or subagent already succeeded, do not repeat it unless the new request explicitly requires another call.",
            ].join("\n\n"),
        });
        return true;
    }
    async run() {
        this.#runStartedAt = performance.now();
        await this.#ensureMemory();
        const prompt = await this.#ensurePrompt();
        const strippedRequestKeys = getReservedRequestKeys(this.#params.endpoint, this.#params.request);
        this.#warnings.push(...strippedRequestKeys.map((key) => `Reserved request key '${key}' was ignored in agent mode.`));
        while (this.#step < this.#params.limits.maxSteps) {
            this.#applyContextCompaction();
            this.#step += 1;
            const stepResult = await this.#runSingleStep();
            const parseFailure = stepResult.parsed.warnings.find((warning) => warning.startsWith("Protocol parse failure on step"));
            if (parseFailure) {
                if (this.#enqueueRetry("protocol_parse_failure", parseFailure, stepResult.rawOutput)) {
                    continue;
                }
                throw new Error(parseFailure);
            }
            const recordedStep = this.#recordStep(stepResult.parsed, stepResult.rawOutput, stepResult.endpointResult, stepResult.timing);
            if (stepResult.errorEvent?.kind === "error") {
                const detail = jsonStringify(stepResult.errorEvent.payload);
                if (this.#enqueueRetry("protocol_error_event", detail, stepResult.rawOutput)) {
                    continue;
                }
                throw new Error(`Model emitted an unrecoverable protocol error event: ${detail}`);
            }
            if (stepResult.actions.length > 0) {
                try {
                    await this.#executeActionBatch(stepResult.actions);
                }
                catch (error) {
                    const detail = error instanceof Error ? error.message : String(error);
                    if (this.#enqueueRetry("action_batch_failure", detail, stepResult.rawOutput)) {
                        continue;
                    }
                    throw error;
                }
                continue;
            }
            if (this.#shouldStopAfterDuplicateWritingStep(stepResult.parsed, stepResult.actions, recordedStep)) {
                this.#warnings.push("Stopping early after the model repeated the same completed writing without new actions.");
                break;
            }
            if (this.#shouldContinueThinkingPass(stepResult.parsed, stepResult.actions)) {
                this.#enqueueThinkingContinuation(stepResult.rawOutput);
                continue;
            }
            break;
        }
        if (this.#step >= this.#params.limits.maxSteps) {
            this.#warnings.push(`Agent stopped after reaching maxSteps=${this.#params.limits.maxSteps}.`);
        }
        return await this.#finalize(prompt, strippedRequestKeys);
    }
    async *stream() {
        this.#runStartedAt = performance.now();
        yield {
            type: "run_started",
            endpoint: this.#params.endpoint,
            model: this.#params.model,
        };
        await this.#ensureMemory();
        const prompt = await this.#ensurePrompt();
        yield {
            type: "prompt_rendered",
            prompt,
        };
        const strippedRequestKeys = getReservedRequestKeys(this.#params.endpoint, this.#params.request);
        for (const key of strippedRequestKeys) {
            const message = `Reserved request key '${key}' was ignored in agent mode.`;
            this.#warnings.push(message);
            yield {
                type: "warning",
                message,
            };
        }
        while (this.#step < this.#params.limits.maxSteps) {
            const compaction = this.#applyContextCompaction();
            if (compaction.operations.length > 0) {
                yield {
                    type: "context_compacted",
                    summaryCount: compaction.summaryCount,
                    droppedCount: compaction.droppedCount,
                    operations: compaction.operations,
                };
            }
            this.#step += 1;
            yield {
                type: "step_started",
                step: this.#step,
            };
            const stepResult = await this.#runSingleStreamingStep();
            for (const text of stepResult.rawDeltas) {
                yield {
                    type: "raw_text_delta",
                    step: this.#step,
                    text,
                };
            }
            for (const delta of stepResult.parsed.deltas) {
                if (delta.block === "writing") {
                    yield {
                        type: "writing_delta",
                        step: this.#step,
                        text: delta.text,
                    };
                }
            }
            const parseFailure = stepResult.parsed.warnings.find((warning) => warning.startsWith("Protocol parse failure on step"));
            if (parseFailure) {
                if (this.#enqueueRetry("protocol_parse_failure", parseFailure, stepResult.rawOutput)) {
                    yield {
                        type: "warning",
                        message: parseFailure,
                    };
                    continue;
                }
                throw new Error(parseFailure);
            }
            const recordedStep = this.#recordStep(stepResult.parsed, stepResult.rawOutput, stepResult.endpointResult, stepResult.timing);
            for (const event of stepResult.parsed.events) {
                yield {
                    type: "protocol_event",
                    step: this.#step,
                    event,
                };
            }
            if (stepResult.errorEvent?.kind === "error") {
                const detail = jsonStringify(stepResult.errorEvent.payload);
                if (this.#enqueueRetry("protocol_error_event", detail, stepResult.rawOutput)) {
                    yield {
                        type: "warning",
                        message: `Retrying after model protocol error: ${detail}`,
                    };
                    continue;
                }
                throw new Error(`Model emitted an unrecoverable protocol error event: ${detail}`);
            }
            if (stepResult.actions.length > 0) {
                const toolActions = stepResult.actions.filter((action) => action.kind === "call_tool");
                const subagentActions = stepResult.actions.filter((action) => action.kind === "call_subagent");
                yield {
                    type: "batch_started",
                    step: this.#step,
                    tools: toolActions.length,
                    subagents: subagentActions.length,
                };
                for (const action of toolActions) {
                    yield {
                        type: "tool_started",
                        step: this.#step,
                        name: action.name,
                        arguments: action.arguments,
                    };
                }
                for (const action of subagentActions) {
                    yield {
                        type: "subagent_started",
                        step: this.#step,
                        name: action.name,
                        arguments: action.arguments,
                    };
                }
                try {
                    const results = await this.#executeActionBatch(stepResult.actions);
                    for (const result of results) {
                        if (result.kind === "call_tool") {
                            yield {
                                type: "tool_result",
                                step: this.#step,
                                name: result.name,
                                result: result.result,
                            };
                            continue;
                        }
                        yield {
                            type: "subagent_result",
                            step: this.#step,
                            name: result.name,
                            result: result.result,
                        };
                    }
                }
                catch (error) {
                    const detail = error instanceof Error ? error.message : String(error);
                    if (this.#enqueueRetry("action_batch_failure", detail, stepResult.rawOutput)) {
                        yield {
                            type: "warning",
                            message: `Retrying after action batch failure: ${detail}`,
                        };
                        continue;
                    }
                    throw error;
                }
                continue;
            }
            if (this.#shouldStopAfterDuplicateWritingStep(stepResult.parsed, stepResult.actions, recordedStep)) {
                const message = "Stopping early after the model repeated the same completed writing without new actions.";
                this.#warnings.push(message);
                yield {
                    type: "warning",
                    message,
                };
                break;
            }
            if (this.#shouldContinueThinkingPass(stepResult.parsed, stepResult.actions)) {
                this.#enqueueThinkingContinuation(stepResult.rawOutput);
                yield {
                    type: "warning",
                    message: "Continuing orchestrated thinking pass before final completion.",
                };
                continue;
            }
            break;
        }
        if (this.#step >= this.#params.limits.maxSteps) {
            const message = `Agent stopped after reaching maxSteps=${this.#params.limits.maxSteps}.`;
            this.#warnings.push(message);
            yield {
                type: "warning",
                message,
            };
        }
        const result = await this.#finalize(prompt, strippedRequestKeys);
        yield {
            type: "run_completed",
            result,
        };
        return result;
    }
    async #ensureMemory() {
        if (!this.#params.memory.enabled || !this.#params.memory.sessionId || !this.#params.memory.load) {
            return;
        }
        if (this.#memoryLoaded) {
            return;
        }
        this.#memorySnapshot = await this.#params.memory.adapter.load({
            sessionId: this.#params.memory.sessionId,
        });
        this.#memoryLoaded = true;
    }
    async #ensurePrompt() {
        const endpointSections = this.#params.endpoint === "responses"
            ? { endpoint_chat_completions: "" }
            : { endpoint_responses: "" };
        const personalityEnabled = hasActivePersonalityConfig(this.#params);
        const thinkingEnabled = hasActiveThinkingConfig(this.#params);
        const toolsEnabled = hasActiveToolsSection(this.#params);
        const subagentsEnabled = hasActiveSubagentsSection(this.#params);
        const memoryEnabled = hasActiveMemorySection(this.#params, this.#memorySnapshot);
        const disabledSections = {
            ...(this.#params.safety.enabled ? {} : { safety: "" }),
            ...(personalityEnabled ? {} : { personality: "" }),
            ...(thinkingEnabled ? {} : { thinking: "" }),
            ...(toolsEnabled || subagentsEnabled ? {} : { tools_subagents: "" }),
            ...(memoryEnabled ? {} : { memory: "" }),
        };
        this.#promptPromise ??= renderPromptSections({
            promptPack: this.deps.promptPack,
            runtimeOverrides: {
                ...this.#params.prompts,
                sections: {
                    ...endpointSections,
                    ...disabledSections,
                    ...this.#params.prompts.sections,
                },
            },
            context: {
                data: {
                    endpoint: this.#params.endpoint,
                    model: this.#params.model,
                    preset: this.#params.preset,
                    intelligence: this.#params.intelligence,
                    safety_mode: this.#params.safety.enabled ? this.#params.safety.mode : "off",
                    thinking_strategy: this.#params.thinking.strategy,
                    debug_enabled: this.#params.debug,
                },
                blocks: {
                    intelligence_identity_guidance: renderIntelligenceIdentityGuidance(this.#params),
                    personality_config: renderPersonalityBlock(this.#params),
                    safety_config: renderSafetyBlock(this.#params),
                    protocol_safety_single_line_markers: renderProtocolSafetySingleLineMarkers(this.#params),
                    protocol_safety_block_markers: renderProtocolSafetyBlockMarkers(this.#params),
                    protocol_target_sequence: renderProtocolTargetSequence(this.#params),
                    intelligence_protocol_guidance: renderIntelligenceProtocolGuidance(this.#params),
                    thinking_config: renderThinkingBlock(this.#params),
                    intelligence_thinking_guidance: renderIntelligenceThinkingGuidance(this.#params),
                    tools_registry_section: renderToolsBlock(this.#params.tools),
                    subagents_registry_section: renderSubagentsBlock(this.#params.subagents),
                    tools_subagents_selection_rules: renderToolsAndSubagentsSelectionRules(this.#params),
                    intelligence_tools_subagents_guidance: renderIntelligenceToolsSubagentsGuidance(this.#params),
                    memory_context: renderMemoryBlock(this.#params, this.#memorySnapshot),
                    task_context: renderTaskBlock(this.#params),
                    intelligence_task_guidance: renderIntelligenceTaskGuidance(this.#params),
                },
            },
        });
        this.#prompt = await this.#promptPromise;
        return this.#prompt;
    }
    #shouldCompactContext() {
        if (!this.#params.context.enabled || this.#params.context.mode === "off") {
            return false;
        }
        const mode = this.#params.context.mode;
        const manualRequested = Boolean(this.#params.context.manual.enabled) &&
            Boolean(this.#params.context.manual.force);
        const messageCountExceeded = this.#history.length >= (this.#params.context.trigger.messageCount ?? Number.MAX_SAFE_INTEGER);
        const turnCountExceeded = countConversationTurns(this.#history) >=
            (this.#params.context.trigger.turnCount ?? Number.MAX_SAFE_INTEGER);
        const estimatedTokens = estimateMessagesTokens(this.#history) +
            (this.#prompt ? Math.ceil(this.#prompt.fullPrompt.length / 4) : 0);
        const estimatedMaxTokens = this.#params.context.trigger.estimatedMaxTokens ??
            DEFAULT_CONTEXT.trigger.estimatedMaxTokens ??
            32768;
        const contextRatio = this.#params.context.trigger.contextRatio ??
            DEFAULT_CONTEXT.trigger.contextRatio ??
            0.9;
        const estimatedRatio = estimatedTokens / estimatedMaxTokens;
        const contextRatioExceeded = estimatedRatio >= contextRatio;
        if (mode === "manual") {
            return manualRequested;
        }
        if (mode === "auto") {
            return messageCountExceeded || turnCountExceeded || contextRatioExceeded;
        }
        return (manualRequested ||
            messageCountExceeded ||
            turnCountExceeded ||
            contextRatioExceeded);
    }
    #applyContextCompaction() {
        if (!this.#shouldCompactContext()) {
            return {
                operations: [],
                summaryCount: 0,
                droppedCount: 0,
            };
        }
        const stickyPrefixLength = this.#history.findIndex((message) => message.role === "user" || message.role === "assistant" || message.role === "summary");
        const prefixEnd = stickyPrefixLength === -1 ? this.#history.length : stickyPrefixLength;
        const stickyPrefix = this.#history.slice(0, prefixEnd);
        const compressible = this.#history.slice(prefixEnd);
        const recentMessageCount = this.#params.context.keep.recentMessages ??
            DEFAULT_CONTEXT.keep.recentMessages ??
            6;
        const keepRecent = clamp(recentMessageCount, 1, Math.max(1, compressible.length));
        if (compressible.length <= keepRecent) {
            return {
                operations: [],
                summaryCount: 0,
                droppedCount: 0,
            };
        }
        const recent = compressible.slice(-keepRecent);
        const boundary = collectBoundaryMessages(compressible.slice(0, -keepRecent), this.#params.context.keep);
        const keptTail = dedupeMessages([...boundary, ...recent]);
        const protectedKeys = new Set(keptTail.map((message) => `${message.role}:${message.phase ?? ""}:${toTextContent(message.content)}`));
        const reducible = compressible.filter((message) => {
            const key = `${message.role}:${message.phase ?? ""}:${toTextContent(message.content)}`;
            return !protectedKeys.has(key);
        });
        if (reducible.length === 0) {
            return {
                operations: [],
                summaryCount: 0,
                droppedCount: 0,
            };
        }
        let operations = [];
        let summaryCount = 0;
        let droppedCount = 0;
        let nextHistory = [...stickyPrefix, ...keptTail];
        const strategy = this.#params.context.strategy;
        if (strategy === "summarize" || strategy === "hybrid") {
            const summaryText = buildSummaryText(reducible, this.#params);
            if (summaryText) {
                nextHistory = [
                    ...stickyPrefix,
                    {
                        role: "summary",
                        content: summaryText,
                    },
                    ...keptTail,
                ];
                operations.push(`summarized ${reducible.length} message(s) into one summary block`);
                summaryCount += 1;
            }
        }
        if (strategy === "drop_nonessential") {
            const nonessential = reducible.filter((message) => isRuntimeInstructionMessage(message));
            const essential = reducible.filter((message) => !isRuntimeInstructionMessage(message));
            droppedCount += nonessential.length;
            operations.push(`dropped ${nonessential.length} nonessential runtime message(s)`);
            nextHistory = [...stickyPrefix, ...essential, ...keptTail];
        }
        if (strategy === "drop_oldest") {
            droppedCount += reducible.length;
            operations.push(`dropped ${reducible.length} oldest message(s)`);
        }
        if (strategy === "hybrid") {
            const estimatedTokens = estimateMessagesTokens(nextHistory);
            const estimatedMaxTokens = this.#params.context.trigger.estimatedMaxTokens ??
                DEFAULT_CONTEXT.trigger.estimatedMaxTokens ??
                32768;
            const contextRatio = this.#params.context.trigger.contextRatio ??
                DEFAULT_CONTEXT.trigger.contextRatio ??
                0.9;
            const targetTokens = Math.floor(estimatedMaxTokens * contextRatio);
            if (estimatedTokens > targetTokens) {
                const stickyAndSummary = nextHistory.filter((message) => message.role === "system" ||
                    message.role === "developer" ||
                    message.role === "summary");
                const conversationTail = nextHistory.filter((message) => message.role === "user" || message.role === "assistant");
                const availableTail = Math.max(recentMessageCount, conversationTail.length - 1);
                const trimmed = dropOldestMessages(conversationTail, availableTail);
                droppedCount += trimmed.droppedCount;
                if (trimmed.droppedCount > 0) {
                    operations.push(`trimmed ${trimmed.droppedCount} additional message(s) after summarization`);
                }
                nextHistory = [...stickyAndSummary, ...trimmed.kept];
            }
        }
        if (strategy === "drop_oldest") {
            nextHistory = [...stickyPrefix, ...keptTail];
        }
        this.#history = nextHistory.map(cloneMessage);
        this.#contextOperations.push(...operations);
        this.#contextSummaryCount += summaryCount;
        this.#contextDropCount += droppedCount;
        return {
            operations,
            summaryCount,
            droppedCount,
        };
    }
    async #runSingleStep() {
        const startedAt = performance.now();
        if (this.#params.endpoint === "responses") {
            const body = this.#buildResponsesRequest(false);
            const result = await this.deps.openai.responses.create(body);
            const rawOutput = extractTextFromResponse(result);
            const parsed = this.#parseRawOutput(rawOutput);
            const endedAt = performance.now();
            return {
                rawOutput,
                parsed,
                actions: parsed.events.filter((event) => event.kind === "call_tool" || event.kind === "call_subagent"),
                errorEvent: parsed.events.find((event) => event.kind === "error"),
                endpointResult: result,
                timing: {
                    step: this.#step,
                    stream: false,
                    startedAt,
                    endedAt,
                },
            };
        }
        const body = this.#buildChatRequest(false);
        const result = await this.deps.openai.chat.completions.create(body);
        const rawOutput = extractTextFromChatCompletion(result);
        const parsed = this.#parseRawOutput(rawOutput);
        const endedAt = performance.now();
        return {
            rawOutput,
            parsed,
            actions: parsed.events.filter((event) => event.kind === "call_tool" || event.kind === "call_subagent"),
            errorEvent: parsed.events.find((event) => event.kind === "error"),
            endpointResult: result,
            timing: {
                step: this.#step,
                stream: false,
                startedAt,
                endedAt,
            },
        };
    }
    async #runSingleStreamingStep() {
        const startedAt = performance.now();
        const rawDeltas = [];
        const parser = new ProtocolStreamParser({ step: this.#step });
        let parserError;
        let firstTextDeltaAt;
        let lastTextDeltaAt;
        if (this.#params.endpoint === "responses") {
            const stream = this.deps.openai.responses.stream(this.#buildResponsesRequest(true));
            for await (const event of stream) {
                if (event.type !== "response.output_text.delta") {
                    continue;
                }
                const deltaAt = performance.now();
                rawDeltas.push(event.delta);
                firstTextDeltaAt ??= deltaAt;
                lastTextDeltaAt = deltaAt;
                if (!parserError) {
                    try {
                        parser.push(event.delta);
                    }
                    catch (error) {
                        parserError = `Streaming protocol parser failure on step ${this.#step}: ${error instanceof Error ? error.message : String(error)}`;
                    }
                }
            }
            const endpointResult = await stream.finalResponse();
            const endedAt = performance.now();
            const rawOutput = rawDeltas.join("") || endpointResult.output_text;
            const parsed = parserError
                ? (() => {
                    const reparsed = this.#parseRawOutput(rawOutput);
                    return {
                        ...reparsed,
                        warnings: [parserError, ...reparsed.warnings],
                    };
                })()
                : (() => {
                    try {
                        return parser.end();
                    }
                    catch (error) {
                        const reparsed = this.#parseRawOutput(rawOutput);
                        return {
                            ...reparsed,
                            warnings: [
                                `Streaming protocol parser failure on step ${this.#step}: ${error instanceof Error ? error.message : String(error)}`,
                                ...reparsed.warnings,
                            ],
                        };
                    }
                })();
            return {
                rawOutput,
                rawDeltas,
                parsed,
                actions: parsed.events.filter((event) => event.kind === "call_tool" || event.kind === "call_subagent"),
                errorEvent: parsed.events.find((event) => event.kind === "error"),
                endpointResult,
                timing: {
                    step: this.#step,
                    stream: true,
                    startedAt,
                    endedAt,
                    firstTextDeltaAt,
                    lastTextDeltaAt,
                },
            };
        }
        const stream = this.deps.openai.chat.completions.stream(this.#buildChatRequest(true));
        for await (const chunk of stream) {
            const delta = extractChatTextDelta(chunk);
            if (!delta) {
                continue;
            }
            const deltaAt = performance.now();
            rawDeltas.push(delta);
            firstTextDeltaAt ??= deltaAt;
            lastTextDeltaAt = deltaAt;
            if (!parserError) {
                try {
                    parser.push(delta);
                }
                catch (error) {
                    parserError = `Streaming protocol parser failure on step ${this.#step}: ${error instanceof Error ? error.message : String(error)}`;
                }
            }
        }
        const endpointResult = stream.currentChatCompletionSnapshot;
        const endedAt = performance.now();
        const rawOutput = rawDeltas.join("");
        const parsed = parserError
            ? (() => {
                const reparsed = this.#parseRawOutput(rawOutput);
                return {
                    ...reparsed,
                    warnings: [parserError, ...reparsed.warnings],
                };
            })()
            : (() => {
                try {
                    return parser.end();
                }
                catch (error) {
                    const reparsed = this.#parseRawOutput(rawOutput);
                    return {
                        ...reparsed,
                        warnings: [
                            `Streaming protocol parser failure on step ${this.#step}: ${error instanceof Error ? error.message : String(error)}`,
                            ...reparsed.warnings,
                        ],
                    };
                }
            })();
        return {
            rawOutput,
            rawDeltas,
            parsed,
            actions: parsed.events.filter((event) => event.kind === "call_tool" || event.kind === "call_subagent"),
            errorEvent: parsed.events.find((event) => event.kind === "error"),
            endpointResult,
            timing: {
                step: this.#step,
                stream: true,
                startedAt,
                endedAt,
                firstTextDeltaAt,
                lastTextDeltaAt,
            },
        };
    }
    #parseRawOutput(rawOutput) {
        try {
            return parseProtocol(rawOutput, { step: this.#step });
        }
        catch (error) {
            const message = `Protocol parse failure on step ${this.#step}: ${error instanceof Error ? error.message : String(error)}`;
            this.#warnings.push(message);
            return {
                events: [
                    {
                        kind: "writing",
                        content: rawOutput,
                        step: this.#step,
                    },
                ],
                deltas: [
                    {
                        type: "writing_delta",
                        block: "writing",
                        text: rawOutput,
                    },
                ],
                warnings: [message],
            };
        }
    }
    #recordStep(parsed, rawOutput, endpointResult, timing) {
        this.#rawOutputs.push(rawOutput);
        this.#endpointResults.push(endpointResult);
        this.#stepTimings.push(timing);
        this.#warnings.push(...parsed.warnings);
        const stepWritingParts = [];
        for (const event of parsed.events) {
            this.#events.push(event);
            if (event.kind === "writing") {
                stepWritingParts.push(event.content);
            }
            else if (event.kind === "thinking") {
                const thinkingCount = this.#events.filter((entry) => entry.kind === "thinking").length;
                if (thinkingCount > this.#params.limits.maxThinkingBlocks) {
                    this.#warnings.push(`Thinking block count ${thinkingCount} exceeded maxThinkingBlocks=${this.#params.limits.maxThinkingBlocks}.`);
                }
            }
            else if (event.kind === "checkpoint" && this.#params.thinking.checkpointFormat === "structured") {
                if (!event.payload || Object.keys(event.payload).length === 0) {
                    this.#warnings.push("Structured checkpoint format is enabled but checkpoint payload was empty.");
                }
            }
        }
        const writingText = stepWritingParts.join("");
        const fingerprint = normalizeComparableText(writingText);
        if (!fingerprint) {
            return {
                writingText,
                duplicateWriting: false,
                appendedWriting: false,
            };
        }
        if (this.#writingFingerprints.at(-1) === fingerprint) {
            this.#warnings.push("Duplicate writing content was ignored after the model repeated the same answer without new actions.");
            return {
                writingText,
                duplicateWriting: true,
                appendedWriting: false,
            };
        }
        this.#cleanedChunks.push(writingText);
        this.#writingFingerprints.push(fingerprint);
        return {
            writingText,
            duplicateWriting: false,
            appendedWriting: true,
        };
    }
    #shouldStopAfterDuplicateWritingStep(parsed, actions, stepRecord) {
        if (!stepRecord.duplicateWriting || actions.length > 0) {
            return false;
        }
        const meaningfulKinds = parsed.events
            .map((event) => event.kind)
            .filter((kind) => kind !== "thinking" && kind !== "input_safety" && kind !== "output_safety");
        return meaningfulKinds.every((kind) => kind === "writing" || kind === "done");
    }
    #shouldContinueThinkingPass(parsed, actions) {
        if (!this.#params.thinking.enabled ||
            (this.#params.thinking.mode !== "orchestrated" &&
                this.#params.thinking.mode !== "hybrid")) {
            return false;
        }
        if (actions.length > 0) {
            return false;
        }
        const kinds = parsed.events.map((event) => event.kind);
        if (kinds.includes("done")) {
            return false;
        }
        return kinds.includes("checkpoint") || kinds.includes("revise") || kinds.includes("writing");
    }
    #enqueueThinkingContinuation(rawOutput) {
        this.#history.push({
            role: "assistant",
            phase: "commentary",
            content: rawOutput,
        });
        this.#history.push({
            role: "developer",
            content: [
                "Continue from the latest valid state.",
                "Run another concise thinking pass before additional writing.",
                this.#params.thinking.checkpointFormat === "structured"
                    ? "When you emit checkpoint markers, include structured checkpoint payloads."
                    : "Use checkpoint markers when the task changes shape.",
                "Finish with [[[status:done]]] only when the full answer is complete.",
            ].join("\n\n"),
        });
    }
    async #executeToolCall(name, args) {
        if (!this.#params.tools.enabled) {
            throw new Error(`Tool '${name}' was requested but tools are disabled.`);
        }
        if (this.#toolCallCount >= this.#params.limits.maxToolCalls) {
            throw new Error(`Tool limit exceeded for '${name}'.`);
        }
        const tool = this.#params.tools.registry[name];
        if (!tool) {
            throw new Error(`Unknown tool '${name}'.`);
        }
        this.#toolCallCount += 1;
        return await tool.execute(args, {
            openai: this.deps.openai,
            endpoint: this.#params.endpoint,
            model: this.#params.model,
            step: this.#step,
            sessionId: this.#params.memory.sessionId,
            params: this.#params,
        });
    }
    #appendToolResultToHistory(name, args, result) {
        this.#notes.push(`Tool ${name} result: ${jsonStringify(result)}`);
        this.#history.push({
            role: "assistant",
            phase: "commentary",
            content: this.#rawOutputs.at(-1) ?? "",
        });
        this.#history.push({
            role: "developer",
            content: [
                `Tool result for "${name}":`,
                jsonStringify({
                    ok: true,
                    name,
                    arguments: args,
                    result,
                }),
                "Continue from the latest state. Do not repeat completed tool calls.",
            ].join("\n\n"),
        });
    }
    async #executeSubagentCall(name, args) {
        if (!this.#params.subagents.enabled) {
            throw new Error(`Subagent '${name}' was requested but subagents are disabled.`);
        }
        if (this.#subagentCallCount >= this.#params.limits.maxSubagentCalls) {
            throw new Error(`Subagent limit exceeded for '${name}'.`);
        }
        const subagent = this.#params.subagents.registry[name];
        if (!subagent) {
            throw new Error(`Unknown subagent '${name}'.`);
        }
        this.#subagentCallCount += 1;
        if (this.depth + 1 > this.#params.limits.maxDepth) {
            throw new Error(`Subagent depth limit exceeded for '${name}'.`);
        }
        const payloadText = typeof args === "string"
            ? args
            : jsonStringify(args);
        return await this.deps.runSubagent({
            endpoint: subagent.endpoint ?? this.#params.endpoint,
            model: subagent.model ?? this.#params.model,
            preset: subagent.preset ?? this.#params.preset,
            intelligence: subagent.intelligence ?? this.#params.intelligence,
            messages: [
                {
                    role: "developer",
                    content: [
                        `You are the specialized General.AI protocol subagent "${name}".`,
                        subagent.instructions,
                        "Emit every protocol marker on its own line, starting at column 1.",
                        "Do not place multiple protocol markers on the same line.",
                        subagent.subagents?.enabled
                            ? "Only use configured nested subagents when they are materially necessary."
                            : "No nested protocol subagents are available in this run. Solve the task directly.",
                    ].join("\n\n"),
                },
                {
                    role: "user",
                    content: payloadText,
                },
            ],
            personality: subagent.personality ?? this.#params.personality,
            safety: subagent.safety ?? this.#params.safety,
            thinking: subagent.thinking ?? this.#params.thinking,
            context: subagent.context ?? this.#params.context,
            tools: filterToolsForSubagent(subagent.tools
                ? normalizeAgentParams(this.deps, {
                    ...this.#params,
                    tools: subagent.tools,
                }).tools
                : this.#params.tools, name),
            subagents: subagent.subagents ?? { enabled: false, registry: {} },
            prompts: mergePromptOverrides(this.#params.prompts, subagent.prompts),
            limits: subagent.limits ?? this.#params.limits,
            request: mergeRequestOverrides(this.#params.request, subagent.request),
            compatibility: subagent.compatibility ?? this.#params.compatibility,
            memory: subagent.memory ?? this.#params.memory,
            parallel: this.#params.parallel,
            metadata: {
                parent_subagent: name,
                depth: String(this.depth + 1),
            },
        }, this.depth + 1);
    }
    #appendSubagentResultToHistory(name, args, result) {
        this.#notes.push(`Subagent ${name} result: ${result.cleaned}`);
        this.#history.push({
            role: "assistant",
            phase: "commentary",
            content: this.#rawOutputs.at(-1) ?? "",
        });
        this.#history.push({
            role: "developer",
            content: [
                `Subagent result for "${name}":`,
                jsonStringify({
                    ok: true,
                    name,
                    arguments: args,
                    cleaned: result.cleaned,
                }),
                "Continue from the latest state. Do not repeat completed subagent calls.",
            ].join("\n\n"),
        });
    }
    async #executeActionBatch(actions) {
        const uniqueActions = actions.filter((action, index) => {
            const key = `${action.kind}:${action.name}:${jsonStringify(action.arguments)}`;
            return (actions.findIndex((entry) => `${entry.kind}:${entry.name}:${jsonStringify(entry.arguments)}` === key) === index);
        });
        if (uniqueActions.length > this.#params.parallel.maxCallsPerStep) {
            throw new Error(`Action batch size ${uniqueActions.length} exceeded maxCallsPerStep=${this.#params.parallel.maxCallsPerStep}.`);
        }
        const toolActions = uniqueActions.filter((action) => action.kind === "call_tool");
        const subagentActions = uniqueActions.filter((action) => action.kind === "call_subagent");
        if (!this.#params.parallel.allowMixedToolAndSubagentParallelism &&
            toolActions.length > 0 &&
            subagentActions.length > 0) {
            throw new Error("Mixed tool and subagent parallelism is disabled for this run.");
        }
        if (uniqueActions.length > this.#params.parallel.maxParallelActions) {
            throw new Error(`Parallel action count ${uniqueActions.length} exceeded maxParallelActions=${this.#params.parallel.maxParallelActions}.`);
        }
        if (toolActions.length > this.#params.parallel.maxParallelTools) {
            throw new Error(`Parallel tool count ${toolActions.length} exceeded maxParallelTools=${this.#params.parallel.maxParallelTools}.`);
        }
        if (subagentActions.length > this.#params.parallel.maxParallelSubagents) {
            throw new Error(`Parallel subagent count ${subagentActions.length} exceeded maxParallelSubagents=${this.#params.parallel.maxParallelSubagents}.`);
        }
        const actionResults = this.#params.parallel.enabled
            ? await Promise.all(uniqueActions.map(async (action) => {
                if (action.kind === "call_tool") {
                    return {
                        action,
                        result: await this.#executeToolCall(action.name, action.arguments),
                    };
                }
                return {
                    action,
                    result: await this.#executeSubagentCall(action.name, action.arguments),
                };
            }))
            : await (async () => {
                const results = [];
                for (const action of uniqueActions) {
                    if (action.kind === "call_tool") {
                        results.push({
                            action,
                            result: await this.#executeToolCall(action.name, action.arguments),
                        });
                        continue;
                    }
                    results.push({
                        action,
                        result: await this.#executeSubagentCall(action.name, action.arguments),
                    });
                }
                return results;
            })();
        const actionMap = new Map(actionResults.map((entry) => [entry.action, entry.result]));
        const orderedResults = [];
        for (const action of uniqueActions) {
            if (action.kind === "call_tool") {
                const result = actionMap.get(action);
                if (result === undefined) {
                    throw new Error(`Tool batch result for '${action.name}' was missing.`);
                }
                this.#appendToolResultToHistory(action.name, action.arguments, result);
                orderedResults.push({
                    kind: "call_tool",
                    name: action.name,
                    result,
                });
                continue;
            }
            const result = actionMap.get(action);
            if (!result) {
                throw new Error(`Subagent batch result for '${action.name}' was missing.`);
            }
            this.#appendSubagentResultToHistory(action.name, action.arguments, result);
            orderedResults.push({
                kind: "call_subagent",
                name: action.name,
                result,
            });
        }
        return orderedResults;
    }
    async #finalize(prompt, strippedRequestKeys) {
        const safetyEnabled = this.#params.safety.enabled && this.#params.safety.mode !== "off";
        const explicitDone = this.#events.some((event) => event.kind === "done");
        const safetyNormalizedEvents = inferImplicitSafetyEvents(this.#events, safetyEnabled);
        const { events: normalizedEvents, inferred: inferredDone } = inferImplicitDoneEvent(safetyNormalizedEvents);
        const compatibilityProfile = resolveCompatibilityProfile(this.#params.compatibility);
        const finalWarnings = mergeStringLists([
            ...this.#warnings,
            ...validateProtocolSequence(normalizedEvents, safetyEnabled, this.#params.thinking.enabled),
        ]);
        const cleaned = this.#cleanedChunks.join("");
        const output = this.#rawOutputs.join("\n\n");
        const usage = aggregateUsage(this.#endpointResults);
        const performanceSummary = buildPerformanceSummary({
            runStartedAt: this.#runStartedAt,
            completedAt: performance.now(),
            steps: this.#stepTimings,
            endpointResults: this.#endpointResults,
        });
        if (this.#params.memory.enabled && this.#params.memory.save && this.#params.memory.sessionId) {
            const snapshot = buildMemorySnapshot(this.#history, cleaned, this.#notes, this.#memorySnapshot);
            await this.#params.memory.adapter.save({
                sessionId: this.#params.memory.sessionId,
                snapshot,
            });
            this.#memorySnapshot = snapshot;
        }
        return {
            output,
            cleaned,
            events: normalizedEvents,
            meta: {
                warnings: finalWarnings,
                prompt,
                strippedRequestKeys,
                configuration: {
                    preset: this.#params.preset,
                    intelligence: this.#params.intelligence,
                    compatibilityProfile,
                    safetyEnabled,
                    thinkingEnabled: this.#params.thinking.enabled,
                },
                completion: {
                    explicitDone,
                    inferredDone,
                },
                stepCount: this.#step,
                toolCallCount: this.#toolCallCount,
                subagentCallCount: this.#subagentCallCount,
                protocolErrorCount: this.#protocolErrorCount,
                contextOperations: [...this.#contextOperations],
                contextSummaryCount: this.#contextSummaryCount,
                contextDropCount: this.#contextDropCount,
                memorySessionId: this.#params.memory.sessionId,
                performance: performanceSummary,
                endpointResults: [...this.#endpointResults],
            },
            usage,
            endpointResult: this.#endpointResults.at(-1),
        };
    }
    #buildResponsesRequest(stream) {
        const request = stripReservedRequestKeys(this.#params.request?.responses, RESERVED_AGENT_RESPONSE_KEYS);
        const instructions = this.#prompt?.fullPrompt ?? "";
        return {
            ...(request ?? {}),
            model: this.#params.model,
            instructions,
            input: compileMessagesForResponses(this.#history),
            ...(this.#params.metadata ? { metadata: this.#params.metadata } : {}),
            ...(stream ? { stream: true } : {}),
        };
    }
    #buildChatRequest(stream) {
        const request = stripReservedRequestKeys(this.#params.request?.chat_completions, RESERVED_AGENT_CHAT_KEYS);
        const compatibilityProfile = resolveCompatibilityProfile(this.#params.compatibility);
        const promptMessage = {
            role: compatibilityProfile === "modern" ? "developer" : "system",
            content: this.#prompt?.fullPrompt ?? "",
        };
        return {
            ...(request ?? {}),
            model: this.#params.model,
            messages: [
                promptMessage,
                ...compileMessagesForChatCompletions(this.#history, this.#params.compatibility),
            ],
            ...(this.#params.metadata ? { metadata: this.#params.metadata } : {}),
            ...(stream ? { stream: true } : {}),
        };
    }
}
//# sourceMappingURL=runtime.js.map