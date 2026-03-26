import type OpenAI from "openai";
import type { ResponseCreateParams, WebSearchTool } from "openai/resources/responses/responses";
import type {
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
  openai: OpenAI;
  name?: string;
  model?: string;
  description?: string;
  search_context_size?: WebSearchTool["search_context_size"];
  user_location?: WebSearchTool["user_location"];
  filters?: WebSearchTool["filters"];
  request?: Partial<ResponseCreateParams>;
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
