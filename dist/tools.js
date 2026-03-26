export function defineTool(definition) {
    return definition;
}
export function defineSubagent(definition) {
    return definition;
}
export function createOpenAIWebSearchTool(options) {
    return defineTool({
        name: options.name ?? "web_search",
        description: options.description ??
            "Search the web using the OpenAI Responses web_search built-in tool.",
        inputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
                query: {
                    type: "string",
                    description: "The natural language search query.",
                },
            },
            required: ["query"],
        },
        async execute(args) {
            const webSearchTool = {
                type: "web_search",
            };
            if (options.search_context_size) {
                webSearchTool.search_context_size = options.search_context_size;
            }
            if (options.user_location !== undefined) {
                webSearchTool.user_location = options.user_location;
            }
            if (options.filters !== undefined) {
                webSearchTool.filters = options.filters;
            }
            const response = await options.openai.responses.create({
                model: options.model ?? "gpt-5.4-mini",
                input: args.query,
                tools: [webSearchTool],
                ...options.request,
            });
            return {
                answer: response.output_text ?? "",
                response,
            };
        },
    });
}
//# sourceMappingURL=tools.js.map