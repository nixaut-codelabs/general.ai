import { DEFAULT_LIMITS, DEFAULT_SAFETY, DEFAULT_THINKING, } from "./defaults.js";
import { compileMessagesForChatCompletions, compileMessagesForResponses, extractChatTextDelta, extractTextFromChatCompletion, extractTextFromResponse, getReservedRequestKeys, stripReservedRequestKeys, RESERVED_AGENT_CHAT_KEYS, RESERVED_AGENT_RESPONSE_KEYS, } from "./endpoint-adapters.js";
import { renderPromptSections } from "./prompts.js";
import { parseProtocol, ProtocolStreamParser, validateProtocolSequence } from "./protocol.js";
import { aggregateUsage, buildMemorySnapshot, cloneMessage, jsonStringify, mergeStringLists, summarizeMessages, } from "./utils.js";
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
function mergeConfigRecords(...records) {
    return Object.assign({}, ...records);
}
function normalizeAgentParams(deps, params) {
    const defaults = deps.defaults?.agent;
    const safetyInput = {
        ...DEFAULT_SAFETY.input,
        ...defaults?.safety?.input,
        ...params.safety?.input,
    };
    const safetyOutput = {
        ...DEFAULT_SAFETY.output,
        ...defaults?.safety?.output,
        ...params.safety?.output,
    };
    const thinking = {
        ...DEFAULT_THINKING,
        ...defaults?.thinking,
        ...params.thinking,
        checkpoints: params.thinking?.checkpoints ?? defaults?.thinking?.checkpoints ?? DEFAULT_THINKING.checkpoints,
    };
    const limits = {
        ...DEFAULT_LIMITS,
        ...defaults?.limits,
        ...params.limits,
    };
    const safety = {
        ...DEFAULT_SAFETY,
        ...defaults?.safety,
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
        debug: params.debug ?? defaults?.debug ?? deps.defaults?.debug ?? deps.debug,
        safety,
        thinking,
        limits,
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
    if (!tools.enabled || Object.keys(tools.registry).length === 0) {
        return "No General.AI protocol tools are configured for this run.";
    }
    const lines = ["Available protocol tools:"];
    for (const tool of Object.values(tools.registry)) {
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
    if (!subagents.enabled || Object.keys(subagents.registry).length === 0) {
        return "No General.AI protocol subagents are configured for this run.";
    }
    const lines = ["Available protocol subagents:"];
    for (const subagent of Object.values(subagents.registry)) {
        lines.push(`- ${subagent.name}: ${subagent.description}`);
    }
    return lines.join("\n");
}
function renderPersonalityBlock(params) {
    if (!params.personality?.enabled) {
        return "No custom personality override is active. Stay direct, accurate, and adaptive.";
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
    return sections.join("\n\n");
}
function renderSafetyBlock(params) {
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
    const checkpoints = params.thinking.checkpoints.map((value) => `- ${value}`).join("\n");
    return [
        `Thinking enabled: ${String(params.thinking.enabled)}`,
        `Thinking strategy: ${params.thinking.strategy}`,
        `Thinking effort: ${params.thinking.effort}`,
        `Thinking checkpoints:\n${checkpoints}`,
        params.thinking.prompt ?? "",
    ]
        .filter(Boolean)
        .join("\n\n");
}
function renderMemoryBlock(params, snapshot) {
    if (!params.memory.enabled || !snapshot) {
        return "No memory snapshot is currently loaded.";
    }
    return [
        snapshot.summary ? `Summary:\n${snapshot.summary}` : "",
        snapshot.preferences?.length
            ? `Preferences:\n${snapshot.preferences.map((value) => `- ${value}`).join("\n")}`
            : "",
        snapshot.notes?.length
            ? `Notes:\n${snapshot.notes.map((value) => `- ${value}`).join("\n")}`
            : "",
        params.memory.prompt ?? "",
    ]
        .filter(Boolean)
        .join("\n\n");
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
        `Chat role mode: ${params.compatibility?.chatRoleMode ?? "modern"}`,
        `Conversation preview:\n${summarizeMessages(params.messages)}`,
        `Run metadata:\n${metadata}`,
    ].join("\n\n");
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
        await this.#ensureMemory();
        const prompt = await this.#ensurePrompt();
        const strippedRequestKeys = getReservedRequestKeys(this.#params.endpoint, this.#params.request);
        this.#warnings.push(...strippedRequestKeys.map((key) => `Reserved request key '${key}' was ignored in agent mode.`));
        while (this.#step < this.#params.limits.maxSteps) {
            this.#step += 1;
            const stepResult = await this.#runSingleStep();
            const parseFailure = stepResult.parsed.warnings.find((warning) => warning.startsWith("Protocol parse failure on step"));
            if (parseFailure) {
                if (this.#enqueueRetry("protocol_parse_failure", parseFailure, stepResult.rawOutput)) {
                    continue;
                }
                throw new Error(parseFailure);
            }
            this.#recordStep(stepResult.parsed, stepResult.rawOutput, stepResult.endpointResult);
            if (stepResult.action?.kind === "error") {
                const detail = jsonStringify(stepResult.action.payload);
                if (this.#enqueueRetry("protocol_error_event", detail, stepResult.rawOutput)) {
                    continue;
                }
                throw new Error(`Model emitted an unrecoverable protocol error event: ${detail}`);
            }
            if (stepResult.action?.kind === "call_tool") {
                try {
                    await this.#handleToolCall(stepResult.action.name, stepResult.action.arguments);
                }
                catch (error) {
                    const detail = error instanceof Error ? error.message : String(error);
                    if (this.#enqueueRetry("tool_call_failure", detail, stepResult.rawOutput)) {
                        continue;
                    }
                    throw error;
                }
                continue;
            }
            if (stepResult.action?.kind === "call_subagent") {
                try {
                    await this.#handleSubagentCall(stepResult.action.name, stepResult.action.arguments);
                }
                catch (error) {
                    const detail = error instanceof Error ? error.message : String(error);
                    if (this.#enqueueRetry("subagent_call_failure", detail, stepResult.rawOutput)) {
                        continue;
                    }
                    throw error;
                }
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
            this.#recordStep(stepResult.parsed, stepResult.rawOutput, stepResult.endpointResult);
            for (const event of stepResult.parsed.events) {
                yield {
                    type: "protocol_event",
                    step: this.#step,
                    event,
                };
            }
            if (stepResult.action?.kind === "error") {
                const detail = jsonStringify(stepResult.action.payload);
                if (this.#enqueueRetry("protocol_error_event", detail, stepResult.rawOutput)) {
                    yield {
                        type: "warning",
                        message: `Retrying after model protocol error: ${detail}`,
                    };
                    continue;
                }
                throw new Error(`Model emitted an unrecoverable protocol error event: ${detail}`);
            }
            if (stepResult.action?.kind === "call_tool") {
                yield {
                    type: "tool_started",
                    step: this.#step,
                    name: stepResult.action.name,
                    arguments: stepResult.action.arguments,
                };
                let result;
                try {
                    result = await this.#handleToolCall(stepResult.action.name, stepResult.action.arguments);
                }
                catch (error) {
                    const detail = error instanceof Error ? error.message : String(error);
                    if (this.#enqueueRetry("tool_call_failure", detail, stepResult.rawOutput)) {
                        yield {
                            type: "warning",
                            message: `Retrying after tool failure: ${detail}`,
                        };
                        continue;
                    }
                    throw error;
                }
                yield {
                    type: "tool_result",
                    step: this.#step,
                    name: stepResult.action.name,
                    result,
                };
                continue;
            }
            if (stepResult.action?.kind === "call_subagent") {
                yield {
                    type: "subagent_started",
                    step: this.#step,
                    name: stepResult.action.name,
                    arguments: stepResult.action.arguments,
                };
                let result;
                try {
                    result = await this.#handleSubagentCall(stepResult.action.name, stepResult.action.arguments);
                }
                catch (error) {
                    const detail = error instanceof Error ? error.message : String(error);
                    if (this.#enqueueRetry("subagent_call_failure", detail, stepResult.rawOutput)) {
                        yield {
                            type: "warning",
                            message: `Retrying after subagent failure: ${detail}`,
                        };
                        continue;
                    }
                    throw error;
                }
                yield {
                    type: "subagent_result",
                    step: this.#step,
                    name: stepResult.action.name,
                    result,
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
        this.#promptPromise ??= renderPromptSections({
            promptPack: this.deps.promptPack,
            runtimeOverrides: {
                ...this.#params.prompts,
                sections: {
                    ...endpointSections,
                    ...this.#params.prompts.sections,
                },
            },
            context: {
                data: {
                    endpoint: this.#params.endpoint,
                    model: this.#params.model,
                    safety_mode: this.#params.safety.enabled ? this.#params.safety.mode : "off",
                    thinking_strategy: this.#params.thinking.strategy,
                    debug_enabled: this.#params.debug,
                },
                blocks: {
                    personality_config: renderPersonalityBlock(this.#params),
                    safety_config: renderSafetyBlock(this.#params),
                    thinking_config: renderThinkingBlock(this.#params),
                    tools_registry: renderToolsBlock(this.#params.tools),
                    subagents_registry: renderSubagentsBlock(this.#params.subagents),
                    memory_context: renderMemoryBlock(this.#params, this.#memorySnapshot),
                    task_context: renderTaskBlock(this.#params),
                },
            },
        });
        this.#prompt = await this.#promptPromise;
        return this.#prompt;
    }
    async #runSingleStep() {
        if (this.#params.endpoint === "responses") {
            const body = this.#buildResponsesRequest(false);
            const result = await this.deps.openai.responses.create(body);
            const rawOutput = extractTextFromResponse(result);
            const parsed = this.#parseRawOutput(rawOutput);
            return {
                rawOutput,
                parsed,
                action: parsed.events.find((event) => event.kind === "call_tool" || event.kind === "call_subagent"
                    ? true
                    : event.kind === "error"),
                endpointResult: result,
            };
        }
        const body = this.#buildChatRequest(false);
        const result = await this.deps.openai.chat.completions.create(body);
        const rawOutput = extractTextFromChatCompletion(result);
        const parsed = this.#parseRawOutput(rawOutput);
        return {
            rawOutput,
            parsed,
            action: parsed.events.find((event) => event.kind === "call_tool" || event.kind === "call_subagent"
                ? true
                : event.kind === "error"),
            endpointResult: result,
        };
    }
    async #runSingleStreamingStep() {
        const rawDeltas = [];
        const parser = new ProtocolStreamParser({ step: this.#step });
        if (this.#params.endpoint === "responses") {
            const stream = this.deps.openai.responses.stream(this.#buildResponsesRequest(true));
            for await (const event of stream) {
                if (event.type !== "response.output_text.delta") {
                    continue;
                }
                rawDeltas.push(event.delta);
                parser.push(event.delta);
            }
            const endpointResult = await stream.finalResponse();
            const rawOutput = rawDeltas.join("") || endpointResult.output_text;
            const parsed = parser.end();
            return {
                rawOutput,
                rawDeltas,
                parsed,
                action: parsed.events.find((event) => event.kind === "call_tool" || event.kind === "call_subagent"
                    ? true
                    : event.kind === "error"),
                endpointResult,
            };
        }
        const stream = this.deps.openai.chat.completions.stream(this.#buildChatRequest(true));
        for await (const chunk of stream) {
            const delta = extractChatTextDelta(chunk);
            if (!delta) {
                continue;
            }
            rawDeltas.push(delta);
            parser.push(delta);
        }
        const endpointResult = stream.currentChatCompletionSnapshot;
        const rawOutput = rawDeltas.join("");
        const parsed = parser.end();
        return {
            rawOutput,
            rawDeltas,
            parsed,
            action: parsed.events.find((event) => event.kind === "call_tool" || event.kind === "call_subagent"
                ? true
                : event.kind === "error"),
            endpointResult,
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
    #recordStep(parsed, rawOutput, endpointResult) {
        this.#rawOutputs.push(rawOutput);
        this.#endpointResults.push(endpointResult);
        this.#warnings.push(...parsed.warnings);
        this.#warnings.push(...validateProtocolSequence(parsed.events, this.#params.safety.enabled && this.#params.safety.mode !== "off"));
        for (const event of parsed.events) {
            this.#events.push(event);
            if (event.kind === "writing") {
                this.#cleanedChunks.push(event.content);
            }
        }
    }
    async #handleToolCall(name, args) {
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
        const result = await tool.execute(args, {
            openai: this.deps.openai,
            endpoint: this.#params.endpoint,
            model: this.#params.model,
            step: this.#step,
            sessionId: this.#params.memory.sessionId,
            params: this.#params,
        });
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
        return result;
    }
    async #handleSubagentCall(name, args) {
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
        const payloadText = typeof args === "string"
            ? args
            : jsonStringify(args);
        const result = await this.deps.runSubagent({
            endpoint: subagent.endpoint ?? this.#params.endpoint,
            model: subagent.model ?? this.#params.model,
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
            tools: filterToolsForSubagent(subagent.tools
                ? normalizeAgentParams(this.deps, {
                    ...this.#params,
                    tools: subagent.tools,
                }).tools
                : this.#params.tools, name),
            subagents: subagent.subagents ?? { enabled: false, registry: {} },
            prompts: mergePromptOverrides(this.#params.prompts, subagent.prompts),
            limits: subagent.limits ?? this.#params.limits,
            request: subagent.request ?? this.#params.request,
            compatibility: this.#params.compatibility,
            metadata: {
                parent_subagent: name,
                depth: String(this.depth + 1),
            },
        }, this.depth + 1);
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
        return result;
    }
    async #finalize(prompt, strippedRequestKeys) {
        const cleaned = this.#cleanedChunks.join("");
        const output = this.#rawOutputs.join("\n\n");
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
            events: [...this.#events],
            meta: {
                warnings: mergeStringLists(this.#warnings),
                prompt,
                strippedRequestKeys,
                stepCount: this.#step,
                toolCallCount: this.#toolCallCount,
                subagentCallCount: this.#subagentCallCount,
                protocolErrorCount: this.#protocolErrorCount,
                memorySessionId: this.#params.memory.sessionId,
                endpointResults: [...this.#endpointResults],
            },
            usage: aggregateUsage(this.#endpointResults),
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
        const promptMessage = {
            role: this.#params.compatibility?.chatRoleMode === "classic"
                ? "system"
                : "developer",
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