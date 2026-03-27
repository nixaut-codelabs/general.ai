import test from "node:test";
import assert from "node:assert/strict";
import { GeneralAI } from "../dist/index.js";
import { createFakeOpenAI } from "./helpers.js";

test("renderPrompts returns assembled English prompt sections", async () => {
  const generalAI = new GeneralAI({
    openai: createFakeOpenAI(),
  });

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

  assert.ok(prompt.fullPrompt.includes("General.AI"));
  assert.ok(prompt.fullPrompt.includes("Task override."));
  assert.ok(prompt.sections.length > 0);
});

test("renderPrompts omits safety prompt and safety protocol requirements when safety is disabled", async () => {
  const generalAI = new GeneralAI({
    openai: createFakeOpenAI(),
  });

  const prompt = await generalAI.agent.renderPrompts({
    endpoint: "chat_completions",
    model: "gpt-5.4-mini",
    messages: [{ role: "user", content: "Hello" }],
    safety: {
      enabled: false,
      mode: "strict",
    },
  });

  assert.ok(!prompt.sections.some((section) => section.key === "safety"));
  assert.ok(!prompt.fullPrompt.includes("Current safety configuration:"));
  assert.ok(!prompt.fullPrompt.includes("`[[[status:input_safety"));
  assert.ok(!prompt.fullPrompt.includes("`[[[status:output_safety"));
});

test("renderPrompts omits inactive personality, thinking, tools, subagents, and memory sections", async () => {
  const generalAI = new GeneralAI({
    openai: createFakeOpenAI(),
  });

  const prompt = await generalAI.agent.renderPrompts({
    endpoint: "chat_completions",
    model: "gpt-5.4-mini",
    messages: [{ role: "user", content: "Hello" }],
    thinking: {
      enabled: false,
      mode: "hybrid",
    },
    personality: {
      enabled: false,
    },
    tools: {
      enabled: false,
      registry: [],
    },
    subagents: {
      enabled: false,
      registry: [],
    },
    memory: {
      enabled: false,
    },
    context: {
      enabled: false,
      mode: "off",
    },
    parallel: {
      enabled: false,
    },
  });

  assert.ok(!prompt.sections.some((section) => section.key === "personality"));
  assert.ok(!prompt.sections.some((section) => section.key === "thinking"));
  assert.ok(!prompt.sections.some((section) => section.key === "tools_subagents"));
  assert.ok(!prompt.sections.some((section) => section.key === "memory"));
  assert.ok(!prompt.fullPrompt.includes("No custom personality override"));
  assert.ok(!prompt.fullPrompt.includes("Thinking enabled: false"));
  assert.ok(!prompt.fullPrompt.includes("No General.AI protocol tools"));
  assert.ok(!prompt.fullPrompt.includes("No General.AI protocol subagents"));
  assert.ok(!prompt.fullPrompt.includes("No memory snapshot is currently loaded."));
  assert.ok(!prompt.fullPrompt.includes("Parallel actions enabled: false"));
  assert.ok(!prompt.fullPrompt.includes("Context management mode: off"));
  assert.ok(!prompt.fullPrompt.includes("Protocol sequence does not begin"));
});

test("renderPrompts adapts guidance text for high intelligence models", async () => {
  const generalAI = new GeneralAI({
    openai: createFakeOpenAI(),
  });

  const prompt = await generalAI.agent.renderPrompts({
    endpoint: "chat_completions",
    model: "gpt-5.4-mini",
    messages: [{ role: "user", content: "Hello" }],
    intelligence: "high",
  });

  assert.ok(prompt.fullPrompt.includes("Current model guidance level: high."));
  assert.ok(prompt.fullPrompt.includes("Treat the protocol as a lightweight runtime contract."));
  assert.ok(prompt.fullPrompt.includes("Preset: balanced"));
  assert.ok(prompt.fullPrompt.includes("Intelligence guidance level: high"));
});
