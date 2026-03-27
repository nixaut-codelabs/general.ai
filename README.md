# General.AI

Beta-stage, TypeScript-first OpenAI-compatible orchestration runtime for Node and Bun.

Use `native` when you want exact SDK behavior.  
Use `agent` when you want protocol-guided orchestration, tools, subagents, retries, context management, and cleaned output.

General.AI is not a thin wrapper. It is a protocol-guided orchestration runtime designed to make model behavior more stable and controllable.

Tested heavily on NVIDIA-compatible OpenAI-style endpoints. Broader provider validation is in progress.

> This README follows the current beta track of General.AI. If you are on the stable `latest` channel, newer capabilities such as context management/compression, structured checkpoints, parallel action batching, and `classic_v2` compatibility may not be available yet. Use the beta install instructions below when you want the features called out in the Beta Changelog.

[![npm version](https://img.shields.io/npm/v/@lightining/general.ai?color=cb3837&label=npm)](https://npmjs.com/package/@lightining/general.ai)
[![npm downloads](https://img.shields.io/npm/dm/@lightining/general.ai)](https://npmjs.com/package/@lightining/general.ai)
[![Node >=22](https://img.shields.io/badge/node-%3E%3D22-339933)](https://nodejs.org/)
[![Bun >=1.1](https://img.shields.io/badge/bun-%3E%3D1.1-000000)](https://bun.sh/)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache%202.0-blue)](./LICENSE)

- npm: <https://npmjs.com/package/@lightining/general.ai>
- GitHub: <https://github.com/nixaut-codelabs/general.ai>

## Table Of Contents

- [Why General.AI](#why-generalai)
- [Why Use It](#why-use-it)
- [Install](#install)
- [Beta Install](#beta-install)
- [Quick Start](#quick-start)
- [Killer Demo](#killer-demo)
- [Native And Agent](#native-and-agent)
- [Compatibility Profiles](#compatibility-profiles)
- [Tools](#tools)
- [Subagents](#subagents)
- [Thinking, Safety, And Context](#thinking-safety-and-context)
- [Observability](#observability)
- [Prompt Overrides](#prompt-overrides)
- [Streaming](#streaming)
- [Testing](#testing)
- [Beta Changelog](#beta-changelog)
- [Package Notes](#package-notes)
- [License](#license)

## Why General.AI

Most projects end up in one of two bad places:

- they stay very close to the raw provider API and rebuild orchestration from scratch
- or they use a wrapper that hides too much and makes advanced provider behavior harder to reach

General.AI tries to sit in the middle:

- `native` keeps the OpenAI client shape intact
- `agent` adds a controllable orchestration runtime on top

That means you can stay close to the transport layer when you want, and move up to a higher-level runtime when you need more stability, structure, and visibility.

## Why Use It

Use General.AI when you want:

- more stable behavior from smaller or inconsistent models
- a protocol-guided runtime instead of ad hoc prompt glue
- tools, subagents, retries, cleaned output, and context handling in one place
- visibility into why the runtime called a tool, opened a subagent, or compacted context
- direct access to OpenAI-compatible APIs without losing provider-native escape hatches

Do not use it if all you want is a very thin helper around the OpenAI SDK. In that case, stay on `native`.

## Install

```bash
npm install @lightining/general.ai openai
```

or:

```bash
bun add @lightining/general.ai openai
```

Runtime targets:

- Node `>=22`
- Bun `>=1.1.0`

General.AI is ESM-only.

## Beta Install

If you want the current beta track:

```bash
npm install @lightining/general.ai@beta openai
```

or:

```bash
bun add @lightining/general.ai@beta openai
```

Channel guide:

- `latest`: slower-moving stable channel
- `beta`: newest runtime features, compatibility work, and beta-only capabilities documented in this README

If you only want the stable channel, stay on `latest`.

## Quick Start

### Simple Start

```ts
import OpenAI from "openai";
import { GeneralAI } from "@lightining/general.ai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const generalAI = new GeneralAI({ openai });

const result = await generalAI.agent.generate({
  endpoint: "chat_completions",
  model: "gpt-5.4-mini",
  messages: [
    { role: "user", content: "Say hello briefly in Turkish." },
  ],
});

console.log(result.cleaned);
```

### Advanced Start

```ts
import OpenAI from "openai";
import { GeneralAI } from "@lightining/general.ai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const generalAI = new GeneralAI({ openai });

const result = await generalAI.agent.generate({
  endpoint: "chat_completions",
  model: "gpt-5.4-mini",
  messages: [
    { role: "user", content: "Say hello briefly in Turkish." },
  ],
  compatibility: {
    profile: "classic_v2",
  },
});

console.log(result.cleaned);
console.log(result.meta.warnings);
```

Returned shape:

```ts
type GeneralAIAgentResult = {
  output: string;
  cleaned: string;
  events: ProtocolEvent[];
  meta: {
    warnings: string[];
    prompt: RenderedPrompts;
    strippedRequestKeys: string[];
    stepCount: number;
    toolCallCount: number;
    subagentCallCount: number;
    protocolErrorCount: number;
    contextOperations: string[];
    contextSummaryCount: number;
    contextDropCount: number;
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

## Killer Demo

This is the kind of call where General.AI starts to feel different from a thin wrapper:

```ts
const result = await generalAI.agent.generate({
  endpoint: "chat_completions",
  model: "gpt-5.4-mini",
  messages: [
    {
      role: "user",
      content: "Use tools if needed, delegate arithmetic to a subagent if useful, and give me a short final answer.",
    },
  ],
  compatibility: {
    profile: "classic_v2",
  },
  tools: {
    registry: [weatherTool, calculatorTool],
  },
  subagents: {
    registry: [mathHelper],
  },
  context: {
    mode: "auto",
    strategy: "hybrid",
  },
});

console.log(result.cleaned);
console.log(result.meta.contextOperations);
console.log(result.meta.warnings);
```

In one runtime call, General.AI can:

- call one or more tools
- delegate to one or more subagents
- retry after malformed protocol output
- summarize or drop older context
- return cleaned user-visible output separately from raw protocol output

## Native And Agent

General.AI exposes two surfaces.

### `native`

Use `native` when you want exact OpenAI SDK behavior.

```ts
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
```

This keeps:

- request bodies OpenAI-native
- response objects OpenAI-native
- stream events OpenAI-native

### `agent`

Use `agent` when you want runtime orchestration.

The agent runtime can:

- assemble layered prompts
- enforce a structured text protocol
- parse runtime events from model output
- retry recoverable protocol failures
- call tools and subagents
- maintain optional memory
- summarize or drop old context before the model hits its limit
- return both raw protocol output and cleaned user-visible output

## Compatibility Profiles

Some OpenAI-compatible providers are stricter than others about message roles and continuation shaping.

General.AI supports compatibility profiles:

- `modern`
- `classic`
- `classic_v2`
- `auto`

Example:

```ts
compatibility: {
  profile: "classic_v2",
}
```

What they mean:

- `modern`: modern OpenAI-style behavior
- `classic`: safer classic `system` / `user` / `assistant` shaping
- `classic_v2`: stricter provider-safe continuation shaping for gateways that dislike late system-style messages
- `auto`: currently resolves to `modern` unless explicitly overridden

If you are using stricter compatible gateways, `classic_v2` is the safest place to start.

## Tools

General.AI tools are runtime-defined JavaScript functions triggered by protocol markers.

```ts
import { defineTool } from "@lightining/general.ai";

const echoTool = defineTool({
  name: "echo",
  description: "Echo text back for runtime testing.",
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

Tool access can be scoped:

- root only
- all subagents
- selected subagents only

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
```

The runtime also supports multiple tool calls in the same step, with configurable parallel limits.

## Subagents

Subagents are bounded delegated General.AI runs with their own config.

```ts
import { defineSubagent } from "@lightining/general.ai";

const mathHelper = defineSubagent({
  name: "math_helper",
  description: "A precise arithmetic specialist.",
  instructions: "Solve delegated arithmetic carefully and return a concise answer.",
  model: "gpt-5.4-mini",
  request: {
    chat_completions: {
      temperature: 0.1,
    },
  },
});
```

Subagents can override:

- `endpoint`
- `model`
- `request`
- `personality`
- `safety`
- `thinking`
- `context`
- `prompts`
- `limits`
- `tools`
- `subagents`
- `compatibility`
- `memory`

They can also participate in parallel action batches.

## Thinking, Safety, And Context

These systems are separate on purpose.

### Thinking

```ts
thinking: {
  enabled: true,
  mode: "hybrid",
  strategy: "checkpointed",
  checkpointFormat: "structured",
  effort: "high",
}
```

Available thinking modes:

- `none`
- `inline`
- `orchestrated`
- `hybrid`

### Safety

```ts
safety: {
  enabled: true,
  mode: "balanced",
  input: {
    enabled: true,
  },
  output: {
    enabled: true,
  },
}
```

Safety runs inside the agent protocol instead of forcing separate moderation-style API calls for every step.

### Context Management

```ts
context: {
  enabled: true,
  mode: "auto",
  strategy: "hybrid",
  trigger: {
    contextRatio: 0.9,
  },
}
```

Supported context strategies:

- `summarize`
- `drop_oldest`
- `drop_nonessential`
- `hybrid`

Supported modes:

- `off`
- `auto`
- `manual`
- `hybrid`

This is runtime-managed context control. It is not a built-in provider compression feature.

## Observability

General.AI is designed to be inspectable.

You can already inspect:

- parsed protocol events
- warnings and retry reasons
- cleaned output and raw protocol output
- tool and subagent counts
- prompt rendering output
- context compaction operations
- endpoint result history

This helps answer questions like:

- why did it call a tool?
- why did it open a subagent?
- why did it summarize or drop old messages?
- why did it retry after malformed model output?

## Prompt Overrides

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

Prompt placeholders:

- `{data:key}` for scalar values
- `{block:key}` for multiline blocks

Example:

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

Raw overrides are also supported:

```ts
prompts: {
  raw: {
    prepend: "Extra preamble",
    append: "Extra appendix",
    replace: "Replace the entire rendered prompt",
  },
}
```

## Streaming

Use `native` for exact provider stream events.  
Use `agent.stream()` for parsed runtime events and cleaned writing deltas.

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

Common stream events:

- `run_started`
- `prompt_rendered`
- `step_started`
- `raw_text_delta`
- `writing_delta`
- `protocol_event`
- `batch_started`
- `tool_started`
- `tool_result`
- `subagent_started`
- `subagent_result`
- `context_compacted`
- `warning`
- `run_completed`

The streaming path also includes recovery for malformed protocol output from real models.

## Testing

Deterministic tests:

```bash
npm test
```

Cross-runtime smoke tests:

```bash
npm run smoke
```

Manual public-surface walkthrough:

```bash
bun run test.js
```

`test.js` can also exercise optional live provider checks when environment variables are set. It covers:

- native chat
- agent protocol generation
- parallel tool batching
- subagent delegation
- orchestrated thinking
- context summarization
- context dropping
- streaming

Useful environment variables:

```bash
GENERAL_AI_API_KEY=...
GENERAL_AI_BASE_URL=...
GENERAL_AI_MODEL=...
GENERAL_AI_SKIP_LIVE=1
```

If `GENERAL_AI_SKIP_LIVE=1` is set, the broader manual scripts skip live provider checks.

## Beta Changelog

Install the beta channel:

```bash
npm install @lightining/general.ai@beta openai
```

or:

```bash
bun add @lightining/general.ai@beta openai
```

Current beta highlights:

- parallel tool and subagent action batching
- subagent-specific models and endpoint request parameters
- thinking modes: `inline`, `orchestrated`, `hybrid`
- structured `checkpoint` and `revise` support
- context management with summarize / drop / hybrid strategies
- stronger streaming fallback and retry behavior
- compatibility profiles including `classic_v2`

Features listed above are beta-track features. If you install `@lightining/general.ai` without `@beta`, you may be on an older stable release that does not include all of them yet.

Beta reality check:

- protocol compliance still depends on model quality
- some providers are stricter than others about message shaping
- broader provider validation is still in progress

## Package Notes

Bundled prompts are written in English for consistency, but user-visible output still follows the user’s language unless they explicitly ask for another one.

General.AI is ESM-only.

The current SDK baseline is `openai@^6.33.0`.

General.AI beta is aimed at:

- app backends
- internal LLM runtimes
- tool and subagent orchestration layers
- OpenAI-compatible provider integrations

It is not intended as a browser bundle.

## License

Apache-2.0. See [LICENSE](./LICENSE).
