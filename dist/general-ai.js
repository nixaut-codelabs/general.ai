import { InMemoryMemoryAdapter } from "./memory.js";
import { ProviderRuntime } from "./provider-runtime.js";
import { AgentRuntime } from "./runtime.js";
export class GeneralAI {
    openai;
    native;
    agent;
    #defaults;
    #memoryAdapter;
    #promptPack;
    #debug;
    #providerRuntime;
    constructor(options) {
        if (!options?.openai && !options?.provider) {
            throw new Error("GeneralAI requires either an injected OpenAI client instance or a provider config.");
        }
        if (options?.openai && options?.provider) {
            throw new Error("GeneralAI constructor accepts either openai or provider, not both.");
        }
        this.#providerRuntime = options.provider
            ? new ProviderRuntime(options.provider, options.openaiFactory)
            : undefined;
        this.openai = (options.openai ?? this.#providerRuntime?.nativeSurface.openai);
        this.#defaults = options.defaults;
        this.#memoryAdapter = options.memoryAdapter ?? new InMemoryMemoryAdapter();
        this.#promptPack = options.promptPack;
        this.#debug = options.debug ?? false;
        this.native = this.#providerRuntime?.nativeSurface ?? {
            openai: this.openai,
            responses: this.openai.responses,
            chat: this.openai.chat,
        };
        this.agent = {
            generate: async (params) => await this.#runAgent(params),
            stream: (params) => this.#streamAgent(params),
            renderPrompts: async (params) => {
                const runtime = this.#createRuntime(params, 0);
                return await runtime.renderPrompts();
            },
        };
    }
    async #runAgent(params, depth = 0) {
        const runtime = this.#createRuntime(params, depth);
        return await runtime.run();
    }
    #streamAgent(params, depth = 0) {
        const runtime = this.#createRuntime(params, depth);
        return runtime.stream();
    }
    #createRuntime(params, depth) {
        return new AgentRuntime({
            openai: this.native.openai,
            defaults: this.#defaults,
            promptPack: this.#promptPack,
            memoryAdapter: this.#memoryAdapter,
            debug: this.#debug,
            runSubagent: async (subagentParams, subDepth) => await this.#runAgent(subagentParams, subDepth),
        }, params, depth);
    }
}
export default GeneralAI;
//# sourceMappingURL=general-ai.js.map