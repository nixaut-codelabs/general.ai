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
    strategy: "checkpointed",
    effort: "medium",
    checkpoints: [
        "Before the first user-visible writing block",
        "At major task transitions",
        "After each tool or subagent result",
        "Before final completion",
    ],
    prompt: "",
};
export const DEFAULT_LIMITS = {
    maxSteps: 8,
    maxToolCalls: 4,
    maxSubagentCalls: 2,
    maxThinkingBlocks: 8,
    maxProtocolErrors: 3,
};
//# sourceMappingURL=defaults.js.map