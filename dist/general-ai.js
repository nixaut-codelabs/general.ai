import { InMemoryMemoryAdapter } from "./memory.js";
import { AgentRuntime } from "./runtime.js";
export class GeneralAI {
    openai;
    native;
    agent;
    #defaults;
    #memoryAdapter;
    #promptPack;
    #debug;
    constructor(options) {
        if (!options?.openai) {
            throw new Error("GeneralAI requires an injected OpenAI client instance.");
        }
        this.openai = options.openai;
        this.#defaults = options.defaults;
        this.#memoryAdapter = options.memoryAdapter ?? new InMemoryMemoryAdapter();
        this.#promptPack = options.promptPack;
        this.#debug = options.debug ?? false;
        this.native = {
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
            openai: this.openai,
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