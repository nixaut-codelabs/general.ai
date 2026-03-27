export function createResponseUsage(overrides = {}) {
  return {
    input_tokens: 10,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: 5,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 15,
    ...overrides,
  };
}

export function createChatUsage(overrides = {}) {
  return {
    prompt_tokens: 10,
    completion_tokens: 5,
    total_tokens: 15,
    prompt_tokens_details: { cached_tokens: 0 },
    completion_tokens_details: { reasoning_tokens: 0 },
    ...overrides,
  };
}

function createAsyncIterable(items) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) {
        yield item;
      }
    },
  };
}

export function createFakeOpenAI(options = {}) {
  const responseOutputs = [...(options.responseOutputs ?? [])];
  const chatOutputs = [...(options.chatOutputs ?? [])];
  const responseRequestBodies = [];
  const chatRequestBodies = [];

  return {
    responseRequestBodies,
    chatRequestBodies,
    responses: {
      async create(body) {
        responseRequestBodies.push(body);
        const outputText = responseOutputs.shift() ?? "";
        return {
          id: `resp_${responseRequestBodies.length}`,
          output_text: outputText,
          usage: createResponseUsage(),
        };
      },
      stream(body) {
        responseRequestBodies.push(body);
        const outputText = responseOutputs.shift() ?? "";
        const deltas = outputText ? [outputText] : [];
        return {
          ...createAsyncIterable(
            deltas.map((delta) => ({
              type: "response.output_text.delta",
              delta,
            })),
          ),
          async finalResponse() {
            return {
              id: `resp_stream_${responseRequestBodies.length}`,
              output_text: outputText,
              usage: createResponseUsage(),
            };
          },
        };
      },
    },
    chat: {
      completions: {
        async create(body) {
          chatRequestBodies.push(body);
          const outputText = chatOutputs.shift() ?? "";
          return {
            id: `chat_${chatRequestBodies.length}`,
            object: "chat.completion",
            created: Date.now(),
            model: body.model,
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                logprobs: null,
                message: {
                  role: "assistant",
                  content: outputText,
                },
              },
            ],
            usage: createChatUsage(),
          };
        },
        stream(body) {
          chatRequestBodies.push(body);
          const outputText = chatOutputs.shift() ?? "";
          const chunks = outputText
            ? [
                {
                  choices: [
                    {
                      index: 0,
                      delta: { content: outputText },
                    },
                  ],
                },
              ]
            : [];

          return {
            ...createAsyncIterable(chunks),
            currentChatCompletionSnapshot: {
              id: `chat_stream_${chatRequestBodies.length}`,
              model: body.model,
              created: Date.now(),
              choices: [
                {
                  index: 0,
                  finish_reason: "stop",
                  logprobs: null,
                  message: { content: outputText, role: "assistant" },
                },
              ],
            },
          };
        },
      },
    },
  };
}

export function createFakeOpenAIFactory(factoryOptions = {}) {
  const created = [];
  const createClient =
    factoryOptions.createClient ??
    ((context) =>
      createFakeOpenAI({
        responseOutputs: factoryOptions.responseOutputs?.[context.apiKey] ?? [],
        chatOutputs: factoryOptions.chatOutputs?.[context.apiKey] ?? [],
      }));

  return {
    created,
    factory(options) {
      const context = {
        ...options,
        instanceIndex: created.length,
      };
      const client = createClient(context);
      created.push({
        context,
        client,
      });
      return client;
    },
  };
}
