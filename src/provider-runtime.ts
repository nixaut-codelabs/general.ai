import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionCreateParams,
} from "openai/resources/chat/completions/completions";
import type {
  Response,
  ResponseCreateParams,
} from "openai/resources/responses/responses";
import type {
  GeneralAINativeSurface,
  GeneralAIProviderClientLike,
  GeneralAIProviderConfig,
} from "./types.js";

interface ProviderKeyEntry {
  index: number;
  label: string;
  key: string;
  client: GeneralAIProviderClientLike;
}

interface QueueTicket {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
}

class ProviderRequestQueue {
  readonly enabled: boolean;
  readonly maxConcurrentRequests: number;
  readonly maxQueuedRequests: number;
  readonly strategy: "fifo";

  #activeCount = 0;
  #pending: QueueTicket[] = [];

  constructor(config: GeneralAIProviderConfig["queue"] = {}) {
    this.enabled = config.enabled ?? true;
    this.maxConcurrentRequests = Math.max(1, config.maxConcurrentRequests ?? 3);
    this.maxQueuedRequests = Math.max(0, config.maxQueuedRequests ?? 100);
    this.strategy = config.strategy ?? "fifo";
  }

  async acquire(): Promise<() => void> {
    if (!this.enabled) {
      return () => {};
    }

    if (this.#activeCount < this.maxConcurrentRequests) {
      this.#activeCount += 1;
      return this.#createRelease();
    }

    if (this.#pending.length >= this.maxQueuedRequests) {
      throw new Error(
        `Provider request queue is full (maxQueuedRequests=${this.maxQueuedRequests}).`,
      );
    }

    return await new Promise<() => void>((resolve, reject) => {
      this.#pending.push({ resolve, reject });
    });
  }

  #createRelease(): () => void {
    let released = false;

    return () => {
      if (released || !this.enabled) {
        return;
      }

      released = true;
      this.#activeCount = Math.max(0, this.#activeCount - 1);
      this.#drain();
    };
  }

  #drain(): void {
    if (!this.enabled) {
      return;
    }

    while (
      this.#activeCount < this.maxConcurrentRequests &&
      this.#pending.length > 0
    ) {
      const ticket =
        this.strategy === "fifo" ? this.#pending.shift() : this.#pending.shift();
      if (!ticket) {
        return;
      }

      this.#activeCount += 1;
      ticket.resolve(this.#createRelease());
    }
  }
}

function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    status?: number;
    code?: number | string;
    error?: { code?: number | string };
  };

  return (
    candidate.status === 429 ||
    candidate.code === 429 ||
    candidate.error?.code === 429
  );
}

function wrapManagedStream<T extends object>(
  stream: T,
  release: () => void,
): T {
  let released = false;
  const releaseOnce = () => {
    if (released) {
      return;
    }

    released = true;
    release();
  };

  return new Proxy(stream, {
    get(target, prop, receiver) {
      if (prop === Symbol.asyncIterator) {
        return async function* iterator() {
          try {
            for await (const chunk of target as AsyncIterable<unknown>) {
              yield chunk;
            }
          } finally {
            releaseOnce();
          }
        };
      }

      if (prop === "finalResponse" && typeof (target as any).finalResponse === "function") {
        return async (...args: unknown[]) => {
          try {
            return await (target as any).finalResponse(...args);
          } finally {
            releaseOnce();
          }
        };
      }

      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export class ProviderRuntime {
  readonly config: Required<
    Pick<GeneralAIProviderConfig, "baseURL">
  > &
    Omit<GeneralAIProviderConfig, "baseURL">;

  readonly nativeSurface: GeneralAINativeSurface;

  #keys: ProviderKeyEntry[];
  #nextKeyIndex = 0;
  #queue: ProviderRequestQueue;
  #maxRateLimitHandoffs: number;
  #revisitKeysInSameRequest: boolean;

  constructor(
    config: GeneralAIProviderConfig,
    openaiFactory?: (options: {
      apiKey: string;
      baseURL: string;
      defaultHeaders?: Record<string, string>;
      defaultQuery?: Record<string, string>;
      timeout?: number;
    }) => GeneralAIProviderClientLike,
  ) {
    if (!config?.baseURL) {
      throw new Error("Provider config requires a baseURL.");
    }

    if (!config.apiKeys?.length) {
      throw new Error("Provider config requires at least one API key.");
    }

    const factory =
      openaiFactory ??
      ((options) =>
        new OpenAI({
          apiKey: options.apiKey,
          baseURL: options.baseURL,
          defaultHeaders: options.defaultHeaders,
          defaultQuery: options.defaultQuery,
          timeout: options.timeout,
        }) as unknown as GeneralAIProviderClientLike);

    this.config = {
      name: config.name ?? "provider",
      baseURL: config.baseURL,
      apiKeys: config.apiKeys,
      defaultHeaders: config.defaultHeaders,
      defaultQuery: config.defaultQuery,
      timeout: config.timeout,
      rotation: {
        strategy: "round_robin",
        onRateLimit: "next_key",
        maxRateLimitHandoffs: Math.max(0, (config.apiKeys?.length ?? 1) - 1),
        revisitKeysInSameRequest: false,
        ...config.rotation,
      },
      queue: {
        enabled: true,
        maxConcurrentRequests: 3,
        maxQueuedRequests: 100,
        strategy: "fifo",
        ...config.queue,
      },
    };

    this.#queue = new ProviderRequestQueue(this.config.queue);
    this.#maxRateLimitHandoffs = Math.max(
      0,
      this.config.rotation?.maxRateLimitHandoffs ?? 0,
    );
    this.#revisitKeysInSameRequest =
      this.config.rotation?.revisitKeysInSameRequest ?? false;

    this.#keys = this.config.apiKeys.map((entry, index) => {
      const normalized =
        typeof entry === "string" ? { key: entry, label: `key-${index + 1}` } : entry;

      return {
        index,
        key: normalized.key,
        label: normalized.label ?? `key-${index + 1}`,
        client: factory({
          apiKey: normalized.key,
          baseURL: this.config.baseURL,
          defaultHeaders: this.config.defaultHeaders,
          defaultQuery: this.config.defaultQuery,
          timeout: this.config.timeout,
        }),
      };
    });

    const facade = this.#createFacade();
    this.nativeSurface = {
      openai: facade,
      responses: facade.responses,
      chat: facade.chat,
    };
  }

  #createFacade(): GeneralAIProviderClientLike {
    return {
      responses: {
        create: async (body: ResponseCreateParams) => await this.responsesCreate(body),
        stream: (body: ResponseCreateParams) => this.responsesStream(body),
      },
      chat: {
        completions: {
          create: async (body: ChatCompletionCreateParams) => await this.chatCreate(body),
          stream: (body: ChatCompletionCreateParams) => this.chatStream(body),
        },
      },
    };
  }

  async responsesCreate(body: ResponseCreateParams): Promise<Response> {
    const release = await this.#queue.acquire();
    try {
      return await this.#runWithRateLimitHandoff((client) =>
        client.responses.create(body),
      );
    } finally {
      release();
    }
  }

  async chatCreate(body: ChatCompletionCreateParams): Promise<ChatCompletion> {
    const release = await this.#queue.acquire();
    try {
      return await this.#runWithRateLimitHandoff((client) =>
        client.chat.completions.create(body),
      );
    } finally {
      release();
    }
  }

  responsesStream(body: ResponseCreateParams): unknown {
    let streamPromise: Promise<object> | undefined;
    let release: (() => void) | undefined;
    let released = false;

    const releaseOnce = () => {
      if (released) {
        return;
      }
      released = true;
      release?.();
    };

    const getStream = async () => {
      if (streamPromise) {
        return await streamPromise;
      }

      streamPromise = (async () => {
        release = await this.#queue.acquire();
        try {
          const stream = await this.#runWithRateLimitHandoff((client) =>
            Promise.resolve(client.responses.stream(body) as object),
          );
          return wrapManagedStream(stream, releaseOnce);
        } catch (error) {
          releaseOnce();
          throw error;
        }
      })();

      return await streamPromise;
    };

    return {
      async *[Symbol.asyncIterator]() {
        const stream = await getStream();
        try {
          for await (const chunk of stream as AsyncIterable<unknown>) {
            yield chunk;
          }
        } finally {
          releaseOnce();
        }
      },
      async finalResponse(...args: unknown[]) {
        const stream = await getStream();
        try {
          return await (stream as any).finalResponse(...args);
        } finally {
          releaseOnce();
        }
      },
    };
  }

  chatStream(body: ChatCompletionCreateParams): unknown {
    let streamPromise: Promise<object> | undefined;
    let activeStream: any;
    let release: (() => void) | undefined;
    let released = false;

    const releaseOnce = () => {
      if (released) {
        return;
      }
      released = true;
      release?.();
    };

    const getStream = async () => {
      if (streamPromise) {
        return await streamPromise;
      }

      streamPromise = (async () => {
        release = await this.#queue.acquire();
        try {
          const stream = await this.#runWithRateLimitHandoff((client) =>
            Promise.resolve(client.chat.completions.stream(body) as object),
          );
          activeStream = wrapManagedStream(stream, releaseOnce);
          return activeStream;
        } catch (error) {
          releaseOnce();
          throw error;
        }
      })();

      return await streamPromise;
    };

    return {
      async *[Symbol.asyncIterator]() {
        const stream = await getStream();
        try {
          for await (const chunk of stream as AsyncIterable<unknown>) {
            yield chunk;
          }
        } finally {
          releaseOnce();
        }
      },
      get currentChatCompletionSnapshot() {
        return activeStream?.currentChatCompletionSnapshot;
      },
    };
  }

  async #runWithRateLimitHandoff<T>(
    request: (client: GeneralAIProviderClientLike) => Promise<T>,
  ): Promise<T> {
    const attempted = new Set<number>();
    let handoffs = 0;
    let lastError: unknown;

    while (true) {
      const entry = this.#selectNextKey(attempted);
      if (!entry) {
        break;
      }

      attempted.add(entry.index);

      try {
        return await request(entry.client);
      } catch (error) {
        lastError = error;

        const canHandoff =
          isRateLimitError(error) &&
          this.config.rotation?.onRateLimit === "next_key" &&
          this.#keys.length > 1 &&
          handoffs < this.#maxRateLimitHandoffs &&
          this.#hasRemainingKeys(attempted);

        if (!canHandoff) {
          throw error;
        }

        handoffs += 1;
      }
    }

    const exhaustedError = new Error(
      `Rate limit fallback keys exhausted after ${attempted.size} key attempt(s).`,
    );
    (exhaustedError as Error & { cause?: unknown }).cause = lastError;
    throw exhaustedError;
  }

  #hasRemainingKeys(attempted: Set<number>): boolean {
    if (this.#revisitKeysInSameRequest) {
      return this.#keys.length > 0;
    }

    return attempted.size < this.#keys.length;
  }

  #selectNextKey(attempted: Set<number>): ProviderKeyEntry | undefined {
    if (this.#keys.length === 0) {
      return undefined;
    }

    for (let offset = 0; offset < this.#keys.length; offset += 1) {
      const candidateIndex = (this.#nextKeyIndex + offset) % this.#keys.length;
      if (!this.#revisitKeysInSameRequest && attempted.has(candidateIndex)) {
        continue;
      }

      this.#nextKeyIndex = (candidateIndex + 1) % this.#keys.length;
      return this.#keys[candidateIndex];
    }

    return undefined;
  }
}
