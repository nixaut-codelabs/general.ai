import test from "node:test";
import assert from "node:assert/strict";
import { GeneralAI, defineTool } from "../dist/index.js";
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
