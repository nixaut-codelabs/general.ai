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
export function createCalculatorTool(options = {}) {
    return defineTool({
        name: options.name ?? "calculator",
        description: options.description ??
            "Perform basic arithmetic on two numbers: add, subtract, multiply, or divide.",
        inputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
                left: {
                    type: "number",
                    description: "The left-hand numeric operand.",
                },
                right: {
                    type: "number",
                    description: "The right-hand numeric operand.",
                },
                operation: {
                    type: "string",
                    enum: ["add", "subtract", "multiply", "divide"],
                    description: "The arithmetic operation to perform.",
                },
            },
            required: ["left", "right", "operation"],
        },
        async execute(args) {
            let result;
            switch (args.operation) {
                case "add":
                    result = args.left + args.right;
                    break;
                case "subtract":
                    result = args.left - args.right;
                    break;
                case "multiply":
                    result = args.left * args.right;
                    break;
                case "divide":
                    if (args.right === 0) {
                        throw new Error("Calculator tool cannot divide by zero.");
                    }
                    result = args.left / args.right;
                    break;
                default:
                    throw new Error(`Unsupported calculator operation '${String(args.operation)}'.`);
            }
            return {
                operation: args.operation,
                left: args.left,
                right: args.right,
                result,
            };
        },
    });
}
//# sourceMappingURL=tools.js.map