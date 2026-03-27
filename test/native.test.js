import test from "node:test";
import assert from "node:assert/strict";
import { GeneralAI } from "../dist/index.js";
import { createFakeOpenAI, createFakeOpenAIFactory } from "./helpers.js";

test("native surface re-exposes exact client surfaces", () => {
  const openai = createFakeOpenAI();
  const generalAI = new GeneralAI({ openai });

  assert.equal(generalAI.native.openai, openai);
  assert.equal(generalAI.native.responses, openai.responses);
  assert.equal(generalAI.native.chat, openai.chat);
});

test("GeneralAI can be constructed from provider config with round-robin key rotation", async () => {
  const requests = [];
  const { factory } = createFakeOpenAIFactory({
    createClient(context) {
      return {
        responses: {
          async create() {
            requests.push({ key: context.apiKey, endpoint: "responses" });
            return {
              id: `resp_${requests.length}`,
              output_text: `response from ${context.apiKey}`,
              usage: {
                input_tokens: 1,
                input_tokens_details: { cached_tokens: 0 },
                output_tokens: 1,
                output_tokens_details: { reasoning_tokens: 0 },
                total_tokens: 2,
              },
            };
          },
          stream() {
            throw new Error("not used");
          },
        },
        chat: {
          completions: {
            async create(body) {
              requests.push({ key: context.apiKey, endpoint: "chat", model: body.model });
              return {
                id: `chat_${requests.length}`,
                object: "chat.completion",
                created: Date.now(),
                model: body.model,
                choices: [
                  {
                    index: 0,
                    finish_reason: "stop",
                    logprobs: null,
                    message: { role: "assistant", content: `hello from ${context.apiKey}` },
                  },
                ],
                usage: {
                  prompt_tokens: 1,
                  completion_tokens: 1,
                  total_tokens: 2,
                  prompt_tokens_details: { cached_tokens: 0 },
                  completion_tokens_details: { reasoning_tokens: 0 },
                },
              };
            },
            stream() {
              throw new Error("not used");
            },
          },
        },
      };
    },
  });

  const generalAI = new GeneralAI({
    provider: {
      baseURL: "https://example.com/v1",
      apiKeys: ["A", "B", "C"],
    },
    openaiFactory: factory,
  });

  await generalAI.native.chat.completions.create({
    model: "test-model",
    messages: [{ role: "user", content: "hi" }],
  });
  await generalAI.native.chat.completions.create({
    model: "test-model",
    messages: [{ role: "user", content: "hi" }],
  });
  await generalAI.native.chat.completions.create({
    model: "test-model",
    messages: [{ role: "user", content: "hi" }],
  });
  await generalAI.native.chat.completions.create({
    model: "test-model",
    messages: [{ role: "user", content: "hi" }],
  });

  assert.deepEqual(
    requests.map((entry) => entry.key),
    ["A", "B", "C", "A"],
  );
});

test("provider-backed native requests hand off to the next key on 429 without revisiting prior keys", async () => {
  const requests = [];
  const { factory } = createFakeOpenAIFactory({
    createClient(context) {
      return {
        responses: {
          async create(body) {
            requests.push({ key: context.apiKey, endpoint: "responses", body });
            if (context.apiKey !== "B") {
              const error = new Error(`rate limited on ${context.apiKey}`);
              error.status = 429;
              throw error;
            }

            return {
              id: "resp_ok",
              output_text: "ok from B",
              usage: {
                input_tokens: 1,
                input_tokens_details: { cached_tokens: 0 },
                output_tokens: 1,
                output_tokens_details: { reasoning_tokens: 0 },
                total_tokens: 2,
              },
            };
          },
          stream() {
            throw new Error("not used");
          },
        },
        chat: {
          completions: {
            async create() {
              throw new Error("not used");
            },
            stream() {
              throw new Error("not used");
            },
          },
        },
      };
    },
  });

  const generalAI = new GeneralAI({
    provider: {
      baseURL: "https://example.com/v1",
      apiKeys: ["A", "B"],
      rotation: {
        strategy: "round_robin",
        onRateLimit: "next_key",
        maxRateLimitHandoffs: 3,
        revisitKeysInSameRequest: false,
      },
    },
    openaiFactory: factory,
  });

  const response = await generalAI.native.responses.create({
    model: "test-model",
    input: "hello",
  });

  assert.equal(response.output_text, "ok from B");
  assert.deepEqual(
    requests.map((entry) => entry.key),
    ["A", "B"],
  );
});

test("provider request queue enforces max concurrent requests", async () => {
  let active = 0;
  let maxObserved = 0;

  const { factory } = createFakeOpenAIFactory({
    createClient(context) {
      return {
        responses: {
          async create() {
            active += 1;
            maxObserved = Math.max(maxObserved, active);
            await new Promise((resolve) => setTimeout(resolve, context.apiKey === "A" ? 40 : 10));
            active -= 1;
            return {
              id: `resp_${context.apiKey}`,
              output_text: context.apiKey,
              usage: {
                input_tokens: 1,
                input_tokens_details: { cached_tokens: 0 },
                output_tokens: 1,
                output_tokens_details: { reasoning_tokens: 0 },
                total_tokens: 2,
              },
            };
          },
          stream() {
            throw new Error("not used");
          },
        },
        chat: {
          completions: {
            async create() {
              throw new Error("not used");
            },
            stream() {
              throw new Error("not used");
            },
          },
        },
      };
    },
  });

  const generalAI = new GeneralAI({
    provider: {
      baseURL: "https://example.com/v1",
      apiKeys: ["A", "B"],
      queue: {
        enabled: true,
        maxConcurrentRequests: 1,
        maxQueuedRequests: 10,
      },
    },
    openaiFactory: factory,
  });

  await Promise.all([
    generalAI.native.responses.create({ model: "m", input: "1" }),
    generalAI.native.responses.create({ model: "m", input: "2" }),
  ]);

  assert.equal(maxObserved, 1);
});
