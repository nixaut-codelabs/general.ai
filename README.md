<div align="center">

# General.AI

**Production-ready, TypeScript-first OpenAI orchestration for Node and Bun**

Native OpenAI passthrough when you want exact SDK behavior.  
An agent runtime when you want prompts, protocol parsing, tools, subagents, safety, memory, retries, and cleaned output.

[![npm version](https://img.shields.io/npm/v/general.ai?color=cb3837&label=npm)](https://npmjs.com/package/general.ai)
[![npm downloads](https://img.shields.io/npm/dm/general.ai)](https://npmjs.com/package/general.ai)
[![Node >=22](https://img.shields.io/badge/node-%3E%3D22-339933)](https://nodejs.org/)
[![Bun >=1.1](https://img.shields.io/badge/bun-%3E%3D1.1-000000)](https://bun.sh/)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache%202.0-blue)](./LICENSE)

[npm](https://npmjs.com/package/general.ai) • [GitHub](https://github.com/nixaut-codelabs/general.ai)

</div>

---

## What General.AI Is

`general.ai` exposes **two complementary surfaces**:

- `native`: exact OpenAI SDK access with no request, response, or stream-shape mutation
- `agent`: a structured orchestration runtime that layers prompt assembly, protocol parsing, retries, tools, subagents, safety, memory, streaming, and cleaned output on top of OpenAI models

This split is intentional:

- use **`native`** when you want raw provider behavior
- use **`agent`** when you want a consistent runtime with higher-level orchestration

> General.AI’s bundled prompts are written in English for consistency, but user-visible output still mirrors the user’s language unless the user explicitly asks for another one.

---

## Table Of Contents

- [Install](#install)
- [Why General.AI](#why-generalai)
- [Feature Matrix](#feature-matrix)
- [Quick Start](#quick-start)
- [Native Surface](#native-surface)
- [Agent Surface](#agent-surface)
- [Tools](#tools)
- [Subagents](#subagents)
- [Prompt Packs And Overrides](#prompt-packs-and-overrides)
- [Thinking, Safety, Personality, Memory](#thinking-safety-personality-memory)
- [Streaming](#streaming)
- [Compatibility Mode](#compatibility-mode)
- [Protocol](#protocol)
- [Examples](#examples)
- [Testing](#testing)
- [Publishing](#publishing)
- [Package Notes](#package-notes)
- [License](#license)

---

## Install

```bash
npm install general.ai openai
```

or:

```bash
bun add general.ai openai
```

**Runtime targets**

- Node `>=22`
- Bun `>=1.1.0`

General.AI is **ESM-only**.

---

## Why General.AI

Most wrappers do one of two things badly:

- they hide the provider too much and make advanced OpenAI features harder to reach
- or they stay so thin that you still have to rebuild orchestration yourself

General.AI is designed to avoid both failures.

### Design goals

- **No lock-in at the transport layer**: `native` exposes the injected OpenAI client exactly
- **Strong orchestration defaults**: `agent` ships with an opinionated runtime and robust prompts
- **TypeScript-first**: public types are shipped from `dist/*.d.ts`
- **OpenAI-first but provider-friendly**: supports official OpenAI and OpenAI-compatible providers
- **Operationally pragmatic**: retries, parser tolerance, compatibility modes, tool gating, memory, and streaming are already built in

---

## Feature Matrix

| Capability | `native` | `agent` |
| --- | --- | --- |
| Exact OpenAI SDK shapes | Yes | No, returns General.AI runtime results |
| `responses` endpoint | Yes | Yes |
| `chat.completions` endpoint | Yes | Yes |
| Streaming | Yes, exact provider events | Yes, parsed runtime events + cleaned deltas |
| Prompt assembly | No | Yes |
| Protocol parsing | No | Yes |
| Cleaned user-visible output | No | Yes |
| Tool loop | Provider-native only | Yes, protocol-driven |
| Subagents | No | Yes |
| Safety markers | No | Yes |
| Thinking checkpoints | No | Yes |
| Memory adapter | No | Yes |
| Retry on malformed protocol / execution failures | No | Yes |
| Compatibility mode for classic providers | N/A | Yes |

---

## Quick Start

```ts
import OpenAI from "openai";
import { GeneralAI } from "general.ai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const generalAI = new GeneralAI({ openai });

const result = await generalAI.agent.generate({
  endpoint: "responses",
  model: "gpt-5.4-mini",
  messages: [
    { role: "user", content: "Explain prompt caching briefly." },
  ],
});

console.log(result.cleaned);
console.log(result.events);
console.log(result.usage);
```

### Returned shape

```ts
type GeneralAIAgentResult = {
  output: string;        // full raw protocol output
  cleaned: string;       // only writing blocks
  events: ProtocolEvent[];
  meta: {
    warnings: string[];
    prompt: RenderedPrompts;
    strippedRequestKeys: string[];
    stepCount: number;
    toolCallCount: number;
    subagentCallCount: number;
    protocolErrorCount: number;
    memorySessionId?: string;
    endpointResults: unknown[];
  };
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedInputTokens: number;
    reasoningTokens: number;
  };
  endpointResult: unknown;
};
```

---

## Native Surface

Use the native surface when you want **exact OpenAI SDK behavior**.

```ts
import OpenAI from "openai";
import { GeneralAI } from "general.ai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const generalAI = new GeneralAI({ openai });

const response = await generalAI.native.responses.create({
  model: "gpt-5.4-mini",
  input: "Give a one-sentence explanation of prompt caching.",
});

const completion = await generalAI.native.chat.completions.create({
  model: "gpt-5.4-mini",
  messages: [
    { role: "user", content: "Say hello in one sentence." },
  ],
});

console.log(response.output_text);
console.log(completion.choices[0]?.message?.content ?? "");
```

### Why this matters

- request bodies stay OpenAI-native
- response objects stay OpenAI-native
- stream events stay OpenAI-native
- advanced provider parameters stay available exactly where the SDK supports them

This is the right surface when you need:

- exact built-in OpenAI tool behavior
- exact stream event handling
- structured outputs or advanced endpoint fields without wrapper interpretation
- minimal abstraction

---

## Agent Surface

Use the agent surface when you want **runtime orchestration** rather than raw provider behavior.

```ts
const result = await generalAI.agent.generate({
  endpoint: "chat_completions",
  model: "gpt-5.4-mini",
  messages: [
    { role: "user", content: "Introduce yourself briefly." },
  ],
  compatibility: {
    chatRoleMode: "classic",
  },
});

console.log(result.cleaned);
```

### Agent responsibilities

- assemble a strong internal prompt stack
- drive a strict protocol
- parse runtime events from model output
- retry recoverable protocol/execution failures
- execute tools and subagents
- maintain optional memory
- return both raw protocol and cleaned output

### Core agent parameters

| Field | Required | Description |
| --- | --- | --- |
| `endpoint` | Yes | `"responses"` or `"chat_completions"` |
| `model` | Yes | Provider model name |
| `messages` | Yes | Normalized conversation array |
| `personality` | No | Persona, style, behavior, boundaries, prompt text |
| `safety` | No | Input/output safety behavior |
| `thinking` | No | Checkpointed thinking strategy |
| `tools` | No | Runtime tool registry |
| `subagents` | No | Delegated specialist registry |
| `memory` | No | Session memory adapter config |
| `prompts` | No | Prompt section overrides |
| `limits` | No | Step/tool/subagent/protocol error limits |
| `request` | No | Endpoint-native OpenAI pass-through values |
| `compatibility` | No | Provider compatibility knobs such as classic chat role mode |
| `metadata` | No | Extra metadata for prompt/task context |
| `debug` | No | Enable debug-oriented prompt/runtime behavior |

---

## Tools

General.AI tools are **runtime-defined JavaScript functions** triggered by protocol markers.

```ts
import { defineTool } from "general.ai";

const echoTool = defineTool({
  name: "echo",
  description: "Echo a string back for runtime testing.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      text: { type: "string" },
    },
    required: ["text"],
  },
  async execute(args) {
    return { echoed: args.text };
  },
});
```

### Tool access policy

You can explicitly decide whether a tool is callable:

- from the root agent
- from all subagents
- from selected subagents only

```ts
const rootOnlyTool = defineTool({
  name: "root_only",
  description: "Only callable from the root agent.",
  access: {
    subagents: false,
  },
  async execute() {
    return { ok: true };
  },
});

const mathOnlyTool = defineTool({
  name: "math_only",
  description: "Only callable from the math_helper subagent.",
  access: {
    subagents: ["math_helper"],
  },
  async execute() {
    return { ok: true };
  },
});
```

### Built-in helper

General.AI also ships a helper for OpenAI web search via Responses:

```ts
import OpenAI from "openai";
import { createOpenAIWebSearchTool } from "general.ai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const webSearch = createOpenAIWebSearchTool({
  openai,
  model: "gpt-5.4-mini",
});
```

---

## Subagents

Subagents are **bounded delegated General.AI runs** with their own instructions, model, limits, safety, and tool access.

```ts
import { defineSubagent } from "general.ai";

const mathHelper = defineSubagent({
  name: "math_helper",
  description: "A precise arithmetic specialist.",
  instructions: [
    "Solve delegated arithmetic carefully.",
    "Return a concise answer.",
    "Do not call nested subagents unless explicitly required.",
  ].join(" "),
});
```

Use them in a run:

```ts
const result = await generalAI.agent.generate({
  endpoint: "chat_completions",
  model: "gpt-5.4-mini",
  messages: [
    {
      role: "system",
      content: "Delegate arithmetic work to the available subagent when useful.",
    },
    {
      role: "user",
      content: "What is 17 multiplied by 23?",
    },
  ],
  subagents: {
    registry: [mathHelper],
  },
  compatibility: {
    chatRoleMode: "classic",
  },
});
```

### What the runtime already handles for you

- subagent instructions are automatically injected
- subagents inherit compatibility mode
- nested subagents can be disabled
- tool visibility can be filtered per subagent
- recoverable subagent execution failures can trigger retries

---

## Prompt Packs And Overrides

General.AI renders a layered prompt stack in this order:

1. identity
2. endpoint adapter rules
3. protocol
4. safety
5. personality
6. thinking
7. tools and subagents
8. memory
9. task context

Bundled prompts live in `prompts/*.txt`.

### Override a section

```ts
const prompt = await generalAI.agent.renderPrompts({
  endpoint: "responses",
  model: "gpt-5.4-mini",
  messages: [{ role: "user", content: "Hello" }],
  prompts: {
    sections: {
      task: "Task override.\n{block:task_context}",
    },
  },
});
```

### Placeholders

- `{data:key}` for scalar values
- `{block:key}` for multiline blocks

### Raw prompt overrides

```ts
prompts: {
  raw: {
    prepend: "Extra preamble",
    append: "Extra appendix",
    replace: "Replace the full rendered prompt entirely",
  },
}
```

---

## Thinking, Safety, Personality, Memory

These systems are separate on purpose.

### Thinking

Thinking defaults to a checkpointed strategy in agent mode.

```ts
thinking: {
  enabled: true,
  strategy: "checkpointed",
  effort: "high",
  checkpoints: [
    "Before the first writing block",
    "After each tool result",
    "Before final completion",
  ],
}
```

### Safety

Safety is configured independently for input and output.

```ts
safety: {
  enabled: true,
  mode: "balanced",
  input: {
    enabled: true,
    instructions: "Inspect the user request carefully.",
  },
  output: {
    enabled: true,
    instructions: "Inspect the final answer before completion.",
  },
}
```

### Personality

```ts
personality: {
  enabled: true,
  profile: "direct_technical",
  persona: { honesty: "high" },
  style: { verbosity: "medium", tone: "direct" },
  behavior: { avoid_sycophancy: true },
  boundaries: { insult_user: false },
  instructions: "Be clear, direct, and technically precise.",
}
```

### Memory

General.AI ships with `InMemoryMemoryAdapter`, and you can inject your own adapter.

```ts
import { GeneralAI, InMemoryMemoryAdapter } from "general.ai";

const memoryAdapter = new InMemoryMemoryAdapter();
const generalAI = new GeneralAI({ openai, memoryAdapter });

await generalAI.agent.generate({
  endpoint: "chat_completions",
  model: "gpt-5.4-mini",
  messages: [{ role: "user", content: "Remember this preference." }],
  memory: {
    enabled: true,
    sessionId: "user-123",
  },
});
```

---

## Streaming

### Native streaming

Use the OpenAI SDK directly through `native` when you want exact provider stream events.

### Agent streaming

Use `agent.stream()` when you want parsed runtime events and cleaned writing deltas.

```ts
const stream = generalAI.agent.stream({
  endpoint: "responses",
  model: "gpt-5.4-mini",
  messages: [{ role: "user", content: "Say hello." }],
});

for await (const event of stream) {
  if (event.type === "writing_delta") {
    process.stdout.write(event.text);
  }
}
```

Typical stream events include:

- `run_started`
- `prompt_rendered`
- `step_started`
- `raw_text_delta`
- `writing_delta`
- `protocol_event`
- `tool_started`
- `tool_result`
- `subagent_started`
- `subagent_result`
- `warning`
- `run_completed`

---

## Compatibility Mode

Some OpenAI-compatible providers do not fully support newer chat roles such as `developer`.

For those providers, use:

```ts
compatibility: {
  chatRoleMode: "classic",
}
```

This enables safer continuation behavior for providers that expect classic `system` / `user` / `assistant` flows.

This is especially useful with:

- older compatible gateways
- NVIDIA-style OpenAI-compatible endpoints
- providers that reject post-assistant `system` or `developer` messages

---

## Protocol

General.AI’s agent runtime uses a text protocol based on triple-bracket markers.

### Common markers

- `[[[status:thinking]]]`
- `[[[status:writing]]]`
- `[[[status:input_safety:{...}]]]`
- `[[[status:output_safety:{...}]]]`
- `[[[status:call_tool:"name":{...}]]]`
- `[[[status:call_subagent:"name":{...}]]]`
- `[[[status:checkpoint]]]`
- `[[[status:revise]]]`
- `[[[status:error:{...}]]]`
- `[[[status:done]]]`

### Important runtime rule

Only `writing` blocks survive into `result.cleaned`.

That means:

- `thinking` is runtime-only
- safety markers are runtime-only
- tool and subagent markers are runtime-only
- `cleaned` is the user-facing answer

### Parser behavior

The parser is intentionally tolerant of real-world model behavior:

- block-style JSON markers are supported
- one-missing-bracket marker near-misses are tolerated
- inline marker runs can be normalized onto separate lines
- malformed protocol can trigger automatic retries up to `limits.maxProtocolErrors`

---

## Advanced OpenAI Pass-Through

The `agent` surface owns the orchestration keys, but endpoint-native extra parameters still pass through via:

- `request.responses`
- `request.chat_completions`

Example:

```ts
const result = await generalAI.agent.generate({
  endpoint: "responses",
  model: "gpt-5.4-mini",
  messages: [{ role: "user", content: "Summarize this." }],
  request: {
    responses: {
      prompt_cache_key: "summary:v1",
      reasoning: { effort: "medium" },
      service_tier: "auto",
      store: false,
      background: false,
    },
  },
});
```

Reserved keys that would break agent orchestration, such as `input`, `messages`, or native tool transport fields, are stripped and reported in `result.meta.strippedRequestKeys`.

---

## Examples

Included examples:

- [examples/native-chat.mjs](./examples/native-chat.mjs)
- [examples/native-responses.mjs](./examples/native-responses.mjs)
- [examples/agent-basic.mjs](./examples/agent-basic.mjs)

Run an example:

```bash
npm run build
node examples/native-chat.mjs
```

---

## Testing

### Deterministic test suite

```bash
npm test
```

This runs:

- build
- unit and runtime integration tests in `test/**/*.test.js`

### Cross-runtime smoke tests

```bash
npm run smoke
```

### Full public-surface and live smoke script

```bash
bun run test.js
```

The root [test.js](./test.js) is a comprehensive manual verification script that covers:

- deterministic API surface checks with fake clients
- parser behavior
- prompt rendering
- memory
- tool gating
- subagent execution
- retry behavior
- streaming
- live provider smoke tests

#### Useful environment variables

```bash
GENERAL_AI_API_KEY=...
GENERAL_AI_BASE_URL=...
GENERAL_AI_MODEL=...
GENERAL_AI_SKIP_LIVE=1
```

If `GENERAL_AI_SKIP_LIVE=1` is set, `test.js` skips live provider checks.

---

## Publishing

The package is configured for production publishing with:

- repository metadata
- homepage and issue tracker links
- Apache-2.0 license file
- ESM entrypoints and declaration files
- `sideEffects: false`
- `prepublishOnly` checks
- `publishConfig.provenance`

### Publish pipeline

```bash
npm test
npm run smoke
npm run pack:check
npm publish
```

Or rely on:

```bash
npm publish
```

because `prepublishOnly` already runs:

- `npm test`
- `npm run smoke`
- `npm run pack:check`

### Inspect the tarball

```bash
npm pack --dry-run
```

---

## Package Notes

### Internal prompt language

Bundled prompts are English by default for consistency across providers and prompt packs.

### User-facing language

The assistant should still answer in the user’s language unless the user explicitly asks for another language.

### ESM-only package

Use `import`, not `require`.

### OpenAI SDK baseline

General.AI currently targets the installed OpenAI Node SDK family represented by `openai@^6.33.0`.

### Production scope

General.AI is built for:

- app backends
- internal LLM runtimes
- tool and subagent orchestration layers
- OpenAI and OpenAI-compatible provider integrations

It is **not** intended as a browser bundle.

---

## Links

- npm: [npmjs.com/package/general.ai](https://npmjs.com/package/general.ai)
- GitHub: [github.com/nixaut-codelabs/general.ai](https://github.com/nixaut-codelabs/general.ai)

---

## License

Apache-2.0. See [LICENSE](./LICENSE).
