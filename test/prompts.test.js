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
