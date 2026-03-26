export class InMemoryMemoryAdapter {
    #store = new Map();
    async load(params) {
        return this.#store.get(params.sessionId) ?? null;
    }
    async save(params) {
        this.#store.set(params.sessionId, params.snapshot);
    }
}
//# sourceMappingURL=memory.js.map