import OpenAI from "openai";
class ProviderRequestQueue {
    enabled;
    maxConcurrentRequests;
    maxQueuedRequests;
    strategy;
    #activeCount = 0;
    #pending = [];
    constructor(config = {}) {
        this.enabled = config.enabled ?? true;
        this.maxConcurrentRequests = Math.max(1, config.maxConcurrentRequests ?? 3);
        this.maxQueuedRequests = Math.max(0, config.maxQueuedRequests ?? 100);
        this.strategy = config.strategy ?? "fifo";
    }
    async acquire() {
        if (!this.enabled) {
            return () => { };
        }
        if (this.#activeCount < this.maxConcurrentRequests) {
            this.#activeCount += 1;
            return this.#createRelease();
        }
        if (this.#pending.length >= this.maxQueuedRequests) {
            throw new Error(`Provider request queue is full (maxQueuedRequests=${this.maxQueuedRequests}).`);
        }
        return await new Promise((resolve, reject) => {
            this.#pending.push({ resolve, reject });
        });
    }
    #createRelease() {
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
    #drain() {
        if (!this.enabled) {
            return;
        }
        while (this.#activeCount < this.maxConcurrentRequests &&
            this.#pending.length > 0) {
            const ticket = this.strategy === "fifo" ? this.#pending.shift() : this.#pending.shift();
            if (!ticket) {
                return;
            }
            this.#activeCount += 1;
            ticket.resolve(this.#createRelease());
        }
    }
}
function isRateLimitError(error) {
    if (!error || typeof error !== "object") {
        return false;
    }
    const candidate = error;
    return (candidate.status === 429 ||
        candidate.code === 429 ||
        candidate.error?.code === 429);
}
function wrapManagedStream(stream, release) {
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
                        for await (const chunk of target) {
                            yield chunk;
                        }
                    }
                    finally {
                        releaseOnce();
                    }
                };
            }
            if (prop === "finalResponse" && typeof target.finalResponse === "function") {
                return async (...args) => {
                    try {
                        return await target.finalResponse(...args);
                    }
                    finally {
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
    config;
    nativeSurface;
    #keys;
    #nextKeyIndex = 0;
    #queue;
    #maxRateLimitHandoffs;
    #revisitKeysInSameRequest;
    constructor(config, openaiFactory) {
        if (!config?.baseURL) {
            throw new Error("Provider config requires a baseURL.");
        }
        if (!config.apiKeys?.length) {
            throw new Error("Provider config requires at least one API key.");
        }
        const factory = openaiFactory ??
            ((options) => new OpenAI({
                apiKey: options.apiKey,
                baseURL: options.baseURL,
                defaultHeaders: options.defaultHeaders,
                defaultQuery: options.defaultQuery,
                timeout: options.timeout,
            }));
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
        this.#maxRateLimitHandoffs = Math.max(0, this.config.rotation?.maxRateLimitHandoffs ?? 0);
        this.#revisitKeysInSameRequest =
            this.config.rotation?.revisitKeysInSameRequest ?? false;
        this.#keys = this.config.apiKeys.map((entry, index) => {
            const normalized = typeof entry === "string" ? { key: entry, label: `key-${index + 1}` } : entry;
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
    #createFacade() {
        return {
            responses: {
                create: async (body) => await this.responsesCreate(body),
                stream: (body) => this.responsesStream(body),
            },
            chat: {
                completions: {
                    create: async (body) => await this.chatCreate(body),
                    stream: (body) => this.chatStream(body),
                },
            },
        };
    }
    async responsesCreate(body) {
        const release = await this.#queue.acquire();
        try {
            return await this.#runWithRateLimitHandoff((client) => client.responses.create(body));
        }
        finally {
            release();
        }
    }
    async chatCreate(body) {
        const release = await this.#queue.acquire();
        try {
            return await this.#runWithRateLimitHandoff((client) => client.chat.completions.create(body));
        }
        finally {
            release();
        }
    }
    responsesStream(body) {
        let streamPromise;
        let release;
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
                    const stream = await this.#runWithRateLimitHandoff((client) => Promise.resolve(client.responses.stream(body)));
                    return wrapManagedStream(stream, releaseOnce);
                }
                catch (error) {
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
                    for await (const chunk of stream) {
                        yield chunk;
                    }
                }
                finally {
                    releaseOnce();
                }
            },
            async finalResponse(...args) {
                const stream = await getStream();
                try {
                    return await stream.finalResponse(...args);
                }
                finally {
                    releaseOnce();
                }
            },
        };
    }
    chatStream(body) {
        let streamPromise;
        let activeStream;
        let release;
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
                    const stream = await this.#runWithRateLimitHandoff((client) => Promise.resolve(client.chat.completions.stream(body)));
                    activeStream = wrapManagedStream(stream, releaseOnce);
                    return activeStream;
                }
                catch (error) {
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
                    for await (const chunk of stream) {
                        yield chunk;
                    }
                }
                finally {
                    releaseOnce();
                }
            },
            get currentChatCompletionSnapshot() {
                return activeStream?.currentChatCompletionSnapshot;
            },
        };
    }
    async #runWithRateLimitHandoff(request) {
        const attempted = new Set();
        let handoffs = 0;
        let lastError;
        while (true) {
            const entry = this.#selectNextKey(attempted);
            if (!entry) {
                break;
            }
            attempted.add(entry.index);
            try {
                return await request(entry.client);
            }
            catch (error) {
                lastError = error;
                const canHandoff = isRateLimitError(error) &&
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
        const exhaustedError = new Error(`Rate limit fallback keys exhausted after ${attempted.size} key attempt(s).`);
        exhaustedError.cause = lastError;
        throw exhaustedError;
    }
    #hasRemainingKeys(attempted) {
        if (this.#revisitKeysInSameRequest) {
            return this.#keys.length > 0;
        }
        return attempted.size < this.#keys.length;
    }
    #selectNextKey(attempted) {
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
//# sourceMappingURL=provider-runtime.js.map