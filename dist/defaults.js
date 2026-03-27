export const PROMPT_SECTION_ORDER = [
    "identity",
    "endpoint_responses",
    "endpoint_chat_completions",
    "protocol",
    "safety",
    "personality",
    "thinking",
    "tools_subagents",
    "memory",
    "task",
];
export const PROMPT_SECTION_TITLES = {
    identity: "Identity",
    endpoint_responses: "Responses Endpoint",
    endpoint_chat_completions: "Chat Completions Endpoint",
    protocol: "Protocol",
    safety: "Safety",
    personality: "Personality",
    thinking: "Thinking",
    tools_subagents: "Tools And Subagents",
    memory: "Memory",
    task: "Task Context",
};
export const DEFAULT_PROMPT_OVERRIDES = {};
export const DEFAULT_SAFETY = {
    enabled: true,
    mode: "balanced",
    input: {
        enabled: true,
        instructions: "",
    },
    output: {
        enabled: true,
        instructions: "",
    },
    prompt: "",
};
export const DEFAULT_THINKING = {
    enabled: true,
    mode: "inline",
    strategy: "checkpointed",
    effort: "medium",
    checkpoints: [
        "Before the first user-visible writing block",
        "At major task transitions",
        "After each tool or subagent result",
        "Before final completion",
    ],
    checkpointFormat: "structured",
    prompt: "",
};
export const DEFAULT_LIMITS = {
    maxSteps: 8,
    maxToolCalls: 4,
    maxSubagentCalls: 2,
    maxThinkingBlocks: 8,
    maxProtocolErrors: 3,
    maxParallelActions: 4,
    maxParallelTools: 4,
    maxParallelSubagents: 2,
    maxCallsPerStep: 6,
    maxDepth: 3,
    timeoutMs: 60000,
};
export const DEFAULT_PARALLEL = {
    enabled: true,
    maxParallelActions: DEFAULT_LIMITS.maxParallelActions,
    maxParallelTools: DEFAULT_LIMITS.maxParallelTools,
    maxParallelSubagents: DEFAULT_LIMITS.maxParallelSubagents,
    maxCallsPerStep: DEFAULT_LIMITS.maxCallsPerStep,
    allowMixedToolAndSubagentParallelism: true,
};
export const DEFAULT_CONTEXT = {
    enabled: true,
    mode: "auto",
    strategy: "hybrid",
    trigger: {
        contextRatio: 0.9,
        messageCount: 32,
        turnCount: 12,
        estimatedMaxTokens: 32768,
    },
    keep: {
        recentMessages: 6,
        boundaryUserMessages: 1,
        boundaryAssistantMessages: 1,
    },
    summary: {
        profile: "balanced",
        includeFacts: true,
        includePreferences: true,
        includeOpenLoops: true,
        includeDecisions: true,
        includeArtifacts: true,
        maxItems: 8,
    },
    manual: {
        enabled: true,
        force: false,
        includeUserIntent: true,
        note: "",
    },
    prompt: "",
};
//# sourceMappingURL=defaults.js.map