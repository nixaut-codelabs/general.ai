import test from "node:test";
import assert from "node:assert/strict";
import {
  GeneralAI,
  compileMessagesForChatCompletions,
  defineTool,
} from "../dist/index.js";
import { createFakeOpenAI } from "./helpers.js";

test("agent.generate executes a protocol tool loop on responses", async () => {
  const openai = createFakeOpenAI({
    responseOutputs: [
      [
        "[[[status:thinking]]]",
        "Need a tool.",
        "[[[status:input_safety:{\"safe\":true}]]]",
        "[[[status:call_tool:\"echo\":{\"text\":\"hello\"}]]]",
      ].join("\n"),
      [
        "[[[status:thinking]]]",
        "Tool result received.",
        "[[[status:input_safety:{\"safe\":true}]]]",
        "[[[status:writing]]]",
        "Echo complete.",
        "[[[status:output_safety:{\"safe\":true}]]]",
        "[[[status:done]]]",
      ].join("\n"),
    ],
  });

  const generalAI = new GeneralAI({ openai });
  const echo = defineTool({
    name: "echo",
    description: "Echo text",
    async execute(args) {
      return args;
    },
  });

  const result = await generalAI.agent.generate({
    endpoint: "responses",
    model: "gpt-5.4-mini",
    messages: [{ role: "user", content: "Say hello." }],
    tools: { registry: [echo] },
  });

  assert.match(result.cleaned, /Echo complete/);
  assert.equal(result.meta.toolCallCount, 1);
  assert.ok(result.events.some((event) => event.kind === "call_tool"));
});

test("agent.generate executes multiple tool calls from the same step", async () => {
  const openai = createFakeOpenAI({
    chatOutputs: [
      [
        "[[[status:thinking]]]",
        "Need two tools.",
        "[[[status:input_safety:{\"safe\":true}]]]",
        '[[[status:call_tool:"echo_one":{"text":"hello"}]]]',
        '[[[status:call_tool:"echo_two":{"text":"world"}]]]',
      ].join("\n"),
      [
        "[[[status:thinking]]]",
        "Tool batch complete.",
        "[[[status:writing]]]",
        "Hello world.",
        "[[[status:output_safety:{\"safe\":true}]]]",
        "[[[status:done]]]",
      ].join("\n"),
    ],
  });

  const generalAI = new GeneralAI({ openai });
  const echoOne = defineTool({
    name: "echo_one",
    description: "Echo one",
    async execute(args) {
      return args;
    },
  });
  const echoTwo = defineTool({
    name: "echo_two",
    description: "Echo two",
    async execute(args) {
      return args;
    },
  });

  const result = await generalAI.agent.generate({
    endpoint: "chat_completions",
    model: "gpt-5.4-mini",
    messages: [{ role: "user", content: "Say hello world." }],
    tools: { registry: [echoOne, echoTwo] },
    compatibility: {
      chatRoleMode: "classic",
    },
  });

  assert.match(result.cleaned, /Hello world/);
  assert.equal(result.meta.toolCallCount, 2);
  assert.equal(openai.chatRequestBodies.length, 2);
  assert.ok(
    result.events.filter((event) => event.kind === "call_tool").length >= 2,
  );
});

test("agent.generate supports chat_completions mode", async () => {
  const openai = createFakeOpenAI({
    chatOutputs: [
      [
        "[[[status:thinking]]]",
        "Ready.",
        "[[[status:input_safety:{\"safe\":true}]]]",
        "[[[status:writing]]]",
        "Hello from chat mode.",
        "[[[status:output_safety:{\"safe\":true}]]]",
        "[[[status:done]]]",
      ].join("\n"),
    ],
  });

  const generalAI = new GeneralAI({ openai });
  const result = await generalAI.agent.generate({
    endpoint: "chat_completions",
    model: "gpt-5.4-mini",
    messages: [{ role: "user", content: "Hi" }],
    compatibility: {
      chatRoleMode: "classic",
    },
  });

  assert.match(result.cleaned, /Hello from chat mode/);
  assert.equal(result.meta.stepCount, 1);
  assert.equal(openai.chatRequestBodies[0].messages[0].role, "system");
});

test("classic chat mode downgrades continuation instructions after assistant turns", async () => {
  const openai = createFakeOpenAI({
    chatOutputs: [
      [
        "[[[status:thinking]]]",
        "Need a tool.",
        "[[[status:input_safety:{\"safe\":true}]]]",
        "[[[status:call_tool:\"echo\":{\"text\":\"hello\"}]]]",
      ].join("\n"),
      [
        "[[[status:writing]]]",
        "Hello after tool.",
        "[[[status:done]]]",
      ].join("\n"),
    ],
  });

  const generalAI = new GeneralAI({ openai });
  const echo = defineTool({
    name: "echo",
    description: "Echo text",
    async execute(args) {
      return args;
    },
  });

  const result = await generalAI.agent.generate({
    endpoint: "chat_completions",
    model: "gpt-5.4-mini",
    messages: [{ role: "user", content: "Hi" }],
    tools: { registry: [echo] },
    compatibility: {
      chatRoleMode: "classic",
    },
  });

  assert.match(result.cleaned, /Hello after tool/);
  assert.equal(openai.chatRequestBodies.length, 2);
  assert.deepEqual(
    openai.chatRequestBodies[1].messages.map((message) => message.role),
    ["system", "user", "assistant", "user"],
  );
});

test("classic_v2 compatibility downgrades system-like continuation messages to user messages", () => {
  const compiled = compileMessagesForChatCompletions(
    [
      { role: "summary", content: "Older context summary." },
      { role: "developer", content: "Runtime continuation." },
      { role: "user", content: "Hello" },
    ],
    {
      profile: "classic_v2",
    },
  );

  assert.deepEqual(
    compiled.map((message) => message.role),
    ["user", "user", "user"],
  );
  assert.match(compiled[0].content, /summary context/i);
  assert.match(compiled[1].content, /runtime continuation instruction/i);
});

test("agent.generate uses a single leading system prompt in classic_v2 mode", async () => {
  const openai = createFakeOpenAI({
    chatOutputs: [
      [
        "[[[status:writing]]]",
        "Hello from classic_v2.",
        "[[[status:done]]]",
      ].join("\n"),
    ],
  });

  const generalAI = new GeneralAI({ openai });
  const result = await generalAI.agent.generate({
    endpoint: "chat_completions",
    model: "gpt-5.4-mini",
    messages: [
      { role: "summary", content: "Old summary." },
      { role: "developer", content: "Continue carefully." },
      { role: "user", content: "Hi" },
    ],
    compatibility: {
      profile: "classic_v2",
    },
    safety: {
      enabled: false,
      mode: "off",
    },
  });

  assert.match(result.cleaned, /classic_v2/i);
  assert.deepEqual(
    openai.chatRequestBodies[0].messages.map((message) => message.role),
    ["system", "user", "user", "user"],
  );
});

test("subagent instructions are injected into delegated chat runs", async () => {
  const openai = createFakeOpenAI({
    chatOutputs: [
      '[[[status:call_subagent:"math_helper":{"expression":"17 * 23"}]]]',
      [
        "[[[status:writing]]]",
        "391",
        "[[[status:done]]]",
      ].join("\n"),
      [
        "[[[status:writing]]]",
        "17 ile 23'ün çarpımı 391'dir.",
        "[[[status:done]]]",
      ].join("\n"),
    ],
  });

  const generalAI = new GeneralAI({ openai });

  const result = await generalAI.agent.generate({
    endpoint: "chat_completions",
    model: "gpt-5.4-mini",
    messages: [{ role: "user", content: "What is 17 multiplied by 23?" }],
    compatibility: {
      chatRoleMode: "classic",
    },
    safety: {
      enabled: false,
      mode: "off",
    },
    thinking: {
      enabled: false,
      strategy: "none",
    },
    subagents: {
      registry: [
        {
          name: "math_helper",
          description: "Math helper.",
          instructions: "Solve the delegated arithmetic task and do not call any subagents.",
        },
      ],
    },
  });

  assert.match(result.cleaned, /391/);
  assert.equal(result.meta.subagentCallCount, 1);
  assert.equal(openai.chatRequestBodies.length, 3);
  assert.equal(openai.chatRequestBodies[1].messages[1].role, "system");
  assert.match(
    openai.chatRequestBodies[1].messages[1].content,
    /Solve the delegated arithmetic task/,
  );
});

test("orchestrated thinking continues across multiple internal passes", async () => {
  const openai = createFakeOpenAI({
    chatOutputs: [
      [
        "[[[status:thinking]]]",
        "Answer the first part.",
        "[[[status:writing]]]",
        "First answer.",
        '[[[status:checkpoint:{"completed":["first_answer"],"remaining":["second_answer"],"confidence":"medium","next":"continue"}]]]',
      ].join("\n"),
      [
        "[[[status:thinking]]]",
        "Answer the second part.",
        "[[[status:writing]]]",
        "Second answer.",
        "[[[status:done]]]",
      ].join("\n"),
    ],
  });

  const generalAI = new GeneralAI({ openai });
  const result = await generalAI.agent.generate({
    endpoint: "chat_completions",
    model: "gpt-5.4-mini",
    messages: [{ role: "user", content: "Answer part one and part two." }],
    compatibility: {
      chatRoleMode: "classic",
    },
    safety: {
      enabled: false,
      mode: "off",
    },
    thinking: {
      enabled: true,
      mode: "orchestrated",
      strategy: "checkpointed",
      checkpointFormat: "structured",
    },
  });

  assert.match(result.cleaned, /First answer/);
  assert.match(result.cleaned, /Second answer/);
  assert.equal(result.meta.stepCount, 2);
  assert.equal(openai.chatRequestBodies.length, 2);
});

test("subagents can override model and endpoint-specific request parameters", async () => {
  const openai = createFakeOpenAI({
    chatOutputs: [
      '[[[status:call_subagent:"math_helper":{"expression":"17 * 23"}]]]',
      [
        "[[[status:writing]]]",
        "391",
        "[[[status:done]]]",
      ].join("\n"),
      [
        "[[[status:writing]]]",
        "Final answer: 391",
        "[[[status:done]]]",
      ].join("\n"),
    ],
  });

  const generalAI = new GeneralAI({ openai });

  const result = await generalAI.agent.generate({
    endpoint: "chat_completions",
    model: "root-model",
    messages: [{ role: "user", content: "What is 17 multiplied by 23?" }],
    compatibility: {
      chatRoleMode: "classic",
    },
    safety: {
      enabled: false,
      mode: "off",
    },
    thinking: {
      enabled: false,
      strategy: "none",
    },
    request: {
      chat_completions: {
        top_p: 0.9,
      },
    },
    subagents: {
      registry: [
        {
          name: "math_helper",
          description: "Math helper.",
          instructions: "Solve the delegated arithmetic task.",
          model: "math-specialist-model",
          request: {
            chat_completions: {
              temperature: 0.1,
            },
          },
        },
      ],
    },
  });

  assert.match(result.cleaned, /391/);
  assert.equal(openai.chatRequestBodies.length, 3);
  assert.equal(openai.chatRequestBodies[1].model, "math-specialist-model");
  assert.equal(openai.chatRequestBodies[1].temperature, 0.1);
  assert.equal(openai.chatRequestBodies[1].top_p, 0.9);
});

test("agent retries after a recoverable protocol parse failure", async () => {
  const openai = createFakeOpenAI({
    chatOutputs: [
      '[[[status:input_safety:{"safe":true,}]]]',
      [
        "[[[status:thinking]]]",
        "Recovered.",
        "[[[status:writing]]]",
        "Recovered answer.",
        "[[[status:done]]]",
      ].join("\n"),
    ],
  });

  const generalAI = new GeneralAI({ openai });
  const result = await generalAI.agent.generate({
    endpoint: "chat_completions",
    model: "gpt-5.4-mini",
    messages: [{ role: "user", content: "Hi" }],
    compatibility: {
      chatRoleMode: "classic",
    },
  });

  assert.match(result.cleaned, /Recovered answer/);
  assert.equal(result.meta.protocolErrorCount, 1);
  assert.equal(openai.chatRequestBodies.length, 2);
});

test("subagent runs inherit only tools allowed for that subagent", async () => {
  const openai = createFakeOpenAI({
    chatOutputs: [
      '[[[status:call_subagent:"math_helper":{"expression":"17 * 23"}]]]',
      [
        "[[[status:writing]]]",
        "391",
        "[[[status:done]]]",
      ].join("\n"),
      [
        "[[[status:writing]]]",
        "391",
        "[[[status:done]]]",
      ].join("\n"),
    ],
  });

  const generalAI = new GeneralAI({ openai });

  await generalAI.agent.generate({
    endpoint: "chat_completions",
    model: "gpt-5.4-mini",
    messages: [{ role: "user", content: "What is 17 multiplied by 23?" }],
    compatibility: {
      chatRoleMode: "classic",
    },
    safety: {
      enabled: false,
      mode: "off",
    },
    thinking: {
      enabled: false,
      strategy: "none",
    },
    tools: {
      registry: [
        defineTool({
          name: "root_only",
          description: "Should not appear in subagents.",
          access: {
            subagents: false,
          },
          async execute() {
            return {};
          },
        }),
        defineTool({
          name: "shared_tool",
          description: "May appear in subagents.",
          access: {
            subagents: true,
          },
          async execute() {
            return {};
          },
        }),
      ],
    },
    subagents: {
      registry: [
        {
          name: "math_helper",
          description: "Math helper.",
          instructions: "Solve the delegated arithmetic task.",
        },
      ],
    },
  });

  const subagentPrompt = openai.chatRequestBodies[1].messages[0].content;
  assert.match(subagentPrompt, /shared_tool/);
  assert.doesNotMatch(subagentPrompt, /root_only/);
});

test("context management can summarize older messages before a run", async () => {
  const openai = createFakeOpenAI({
    responseOutputs: [
      [
        "[[[status:thinking]]]",
        "Ready.",
        "[[[status:writing]]]",
        "Compressed.",
        "[[[status:done]]]",
      ].join("\n"),
    ],
  });

  const generalAI = new GeneralAI({ openai });
  const result = await generalAI.agent.generate({
    endpoint: "responses",
    model: "gpt-5.4-mini",
    messages: [
      { role: "user", content: "Message one." },
      { role: "assistant", content: "Answer one." },
      { role: "user", content: "Message two." },
      { role: "assistant", content: "Answer two." },
      { role: "user", content: "Latest message." },
    ],
    safety: {
      enabled: false,
      mode: "off",
    },
    context: {
      mode: "auto",
      strategy: "summarize",
      trigger: {
        messageCount: 4,
        estimatedMaxTokens: 128,
        contextRatio: 0.1,
      },
      keep: {
        recentMessages: 2,
        boundaryUserMessages: 1,
        boundaryAssistantMessages: 1,
      },
      manual: {
        enabled: true,
        force: true,
        includeUserIntent: true,
        note: "Do not forget the main topic.",
      },
    },
  });

  const compiledInput = openai.responseRequestBodies[0].input;
  assert.equal(result.meta.contextSummaryCount, 1);
  assert.ok(
    compiledInput.some((message) =>
      message.role === "developer" &&
      typeof message.content === "string" &&
      message.content.includes("Conversation summary"),
    ),
  );
});

test("context management can drop older messages without generating a summary", async () => {
  const openai = createFakeOpenAI({
    responseOutputs: [
      [
        "[[[status:thinking]]]",
        "Ready.",
        "[[[status:writing]]]",
        "Dropped.",
        "[[[status:done]]]",
      ].join("\n"),
    ],
  });

  const generalAI = new GeneralAI({ openai });
  const result = await generalAI.agent.generate({
    endpoint: "responses",
    model: "gpt-5.4-mini",
    messages: [
      { role: "user", content: "Message one." },
      { role: "assistant", content: "Answer one." },
      { role: "user", content: "Message two." },
      { role: "assistant", content: "Answer two." },
      { role: "user", content: "Latest message." },
    ],
    safety: {
      enabled: false,
      mode: "off",
    },
    context: {
      mode: "manual",
      strategy: "drop_oldest",
      keep: {
        recentMessages: 2,
        boundaryUserMessages: 0,
        boundaryAssistantMessages: 0,
      },
      manual: {
        enabled: true,
        force: true,
      },
    },
  });

  const compiledInput = openai.responseRequestBodies[0].input;
  assert.equal(result.meta.contextSummaryCount, 0);
  assert.ok(result.meta.contextDropCount > 0);
  assert.ok(
    !compiledInput.some((message) =>
      message.role === "developer" &&
      typeof message.content === "string" &&
      message.content.includes("Conversation summary"),
    ),
  );
});

test("agent.stream yields deltas and final result", async () => {
  const openai = createFakeOpenAI({
    responseOutputs: [
      [
        "[[[status:thinking]]]",
        "Streaming.",
        "[[[status:input_safety:{\"safe\":true}]]]",
        "[[[status:writing]]]",
        "Hello stream.",
        "[[[status:output_safety:{\"safe\":true}]]]",
        "[[[status:done]]]",
      ].join("\n"),
    ],
  });

  const generalAI = new GeneralAI({ openai });
  const events = [];
  const stream = generalAI.agent.stream({
    endpoint: "responses",
    model: "gpt-5.4-mini",
    messages: [{ role: "user", content: "Hi" }],
  });

  for await (const event of stream) {
    events.push(event);
  }

  assert.ok(events.some((event) => event.type === "run_completed"));
  assert.ok(events.some((event) => event.type === "writing_delta"));
});

test("agent.stream recovers from malformed streaming protocol output", async () => {
  const openai = createFakeOpenAI({
    chatOutputs: [
      "[[[status:input_safety]]]\n{\"safe\":true",
      [
        "[[[status:thinking]]]",
        "Recovered.",
        "[[[status:writing]]]",
        "Recovered stream answer.",
        "[[[status:done]]]",
      ].join("\n"),
    ],
  });

  const generalAI = new GeneralAI({ openai });
  const events = [];
  const stream = generalAI.agent.stream({
    endpoint: "chat_completions",
    model: "gpt-5.4-mini",
    messages: [{ role: "user", content: "Hi" }],
    compatibility: {
      chatRoleMode: "classic",
    },
    safety: {
      enabled: false,
      mode: "off",
    },
  });

  for await (const event of stream) {
    events.push(event);
  }

  const completed = events.find((event) => event.type === "run_completed");
  assert.ok(completed);
  assert.match(completed.result.cleaned, /Recovered stream answer/);
});
