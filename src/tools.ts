import type { ResponseCreateParams, WebSearchTool } from "openai/resources/responses/responses";
import type {
  GeneralAIProviderClientLike,
  GeneralAIToolDefinition,
  GeneralAISubagentDefinition,
} from "./types.js";

export function defineTool<TArgs = Record<string, unknown>, TResult = unknown>(
  definition: GeneralAIToolDefinition<TArgs, TResult>,
): GeneralAIToolDefinition<TArgs, TResult> {
  return definition;
}

export function defineSubagent(
  definition: GeneralAISubagentDefinition,
): GeneralAISubagentDefinition {
  return definition;
}

export interface OpenAIWebSearchToolOptions {
  openai: GeneralAIProviderClientLike;
  name?: string;
  model?: string;
  description?: string;
  search_context_size?: WebSearchTool["search_context_size"];
  user_location?: WebSearchTool["user_location"];
  filters?: WebSearchTool["filters"];
  request?: Partial<ResponseCreateParams>;
}

export interface CalculatorToolOptions {
  name?: string;
  description?: string;
}

export type CalculatorOperation =
  | "add"
  | "subtract"
  | "multiply"
  | "divide";

export interface CalculatorToolArgs {
  left: number;
  right: number;
  operation: CalculatorOperation;
}

export function createOpenAIWebSearchTool(
  options: OpenAIWebSearchToolOptions,
): GeneralAIToolDefinition<{ query: string }, { answer: string; response: unknown }> {
  return defineTool({
    name: options.name ?? "web_search",
    description:
      options.description ??
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
      const webSearchTool: WebSearchTool = {
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
      } as any);

      return {
        answer: (response as any).output_text ?? "",
        response,
      };
    },
  });
}

export function createCalculatorTool(
  options: CalculatorToolOptions = {},
): GeneralAIToolDefinition<
  CalculatorToolArgs,
  { operation: CalculatorOperation; left: number; right: number; result: number }
> {
  return defineTool({
    name: options.name ?? "calculator",
    description:
      options.description ??
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
      let result: number;

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
