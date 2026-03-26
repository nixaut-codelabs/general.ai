import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionContentPartText,
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions/completions";
import type {
  EasyInputMessage,
  Response,
  ResponseInput,
  ResponseInputContent,
} from "openai/resources/responses/responses";
import type {
  GeneralAIContentPart,
  GeneralAICompatibilityConfig,
  GeneralAIEndpoint,
  GeneralAIMessage,
  GeneralAIRequestOverrides,
} from "./types.js";

export const RESERVED_AGENT_RESPONSE_KEYS = [
  "input",
  "instructions",
  "model",
  "stream",
  "text",
  "tools",
  "tool_choice",
] as const;

export const RESERVED_AGENT_CHAT_KEYS = [
  "messages",
  "model",
  "stream",
  "response_format",
  "tools",
  "tool_choice",
] as const;

export function getReservedRequestKeys(
  endpoint: GeneralAIEndpoint,
  request: GeneralAIRequestOverrides | undefined,
): string[] {
  const source =
    endpoint === "responses"
      ? request?.responses
      : request?.chat_completions;
  const reserved =
    endpoint === "responses"
      ? RESERVED_AGENT_RESPONSE_KEYS
      : RESERVED_AGENT_CHAT_KEYS;

  return reserved.filter((key) => source && key in source);
}

function toChatTextPart(text: string): ChatCompletionContentPart {
  return {
    type: "text",
    text,
  };
}

function toInstructionText(
  content: GeneralAIMessage["content"],
): string {
  if (typeof content === "string") {
    return content;
  }

  return content.map((part) => {
    if (part.type !== "text") {
      throw new Error(
        "Late system/developer messages in classic chat mode only support text content parts.",
      );
    }

    return part.text;
  }).join("\n");
}

function toChatContentParts(
  role: GeneralAIMessage["role"],
  content: GeneralAIMessage["content"],
): string | ChatCompletionContentPart[] | ChatCompletionContentPartText[] {
  if (typeof content === "string") {
    return content;
  }

  const parts = content.map((part) => mapPartToChat(role, part));
  return role === "assistant" || role === "developer" || role === "system"
    ? parts.every((part) => part.type === "text")
      ? parts as Array<{ type: "text"; text: string }>
      : (() => {
          throw new Error(
            `${role} messages in chat_completions mode only support text content parts.`,
          );
        })()
    : parts;
}

function mapPartToChat(
  role: GeneralAIMessage["role"],
  part: GeneralAIContentPart,
): ChatCompletionContentPart {
  switch (part.type) {
    case "text":
      return toChatTextPart(part.text);
    case "image_url":
      if (role !== "user") {
        throw new Error(`Only user messages may include image parts in chat_completions mode.`);
      }
      return {
        type: "image_url",
        image_url: {
          url: part.url,
          detail: part.detail === "original" ? "auto" : part.detail,
        },
      };
    case "input_audio":
      if (role !== "user") {
        throw new Error(`Only user messages may include audio parts in chat_completions mode.`);
      }
      return {
        type: "input_audio",
        input_audio: {
          data: part.data,
          format: part.format,
        },
      };
    case "input_file":
      throw new Error("input_file parts are not supported in chat_completions mode.");
    default:
      throw new Error("Unsupported chat content part.");
  }
}

function mapPartToResponses(part: GeneralAIContentPart): ResponseInputContent {
  switch (part.type) {
    case "text":
      return {
        type: "input_text",
        text: part.text,
      };
    case "image_url":
      const image: any = {
        type: "input_image",
        image_url: part.url,
      };
      if (part.detail) {
        image.detail = part.detail;
      }
      return image;
    case "input_audio":
      throw new Error("input_audio parts are not supported inside message content for responses mode.");
    case "input_file":
      return {
        type: "input_file",
        file_id: part.file_id,
        file_url: part.file_url,
        file_data: part.file_data,
        filename: part.filename,
      };
    default:
      throw new Error("Unsupported responses content part.");
  }
}

export function compileMessagesForChatCompletions(
  messages: GeneralAIMessage[],
  compatibility: GeneralAICompatibilityConfig = {},
): ChatCompletionMessageParam[] {
  const roleMode = compatibility.chatRoleMode ?? "modern";
  let sawConversationTurn = false;

  return messages.map((message) => {
    if (roleMode === "classic" && (message.role === "developer" || message.role === "system")) {
      if (sawConversationTurn) {
        return {
          role: "user",
          content: [
            "[General.AI runtime continuation instruction]",
            toInstructionText(message.content),
          ].join("\n\n"),
          name: message.name,
        };
      }

      const content = toChatContentParts(message.role, message.content);
      return {
        role: "system",
        content: content as string | ChatCompletionContentPartText[],
        name: message.name,
      };
    }

    if (message.role === "developer") {
      const content = toChatContentParts("developer", message.content);
      return {
        role: roleMode === "classic" ? "system" : "developer",
        content: content as string | ChatCompletionContentPartText[],
        name: message.name,
      };
    }

    if (message.role === "system") {
      const content = toChatContentParts("system", message.content);
      return {
        role: "system",
        content: content as string | ChatCompletionContentPartText[],
        name: message.name,
      };
    }

    if (message.role === "assistant") {
      sawConversationTurn = true;
      const content = toChatContentParts("assistant", message.content);
      return {
        role: "assistant",
        content: content as string | Array<{ type: "text"; text: string }>,
        name: message.name,
      };
    }

    sawConversationTurn = true;
    return {
      role: "user",
      content: toChatContentParts("user", message.content),
      name: message.name,
    };
  });
}

export function compileMessagesForResponses(
  messages: GeneralAIMessage[],
): ResponseInput {
  return messages.map((message) => {
    const input: EasyInputMessage = {
      type: "message",
      role: message.role,
      content:
        typeof message.content === "string"
          ? message.content
          : message.content.map(mapPartToResponses),
    };

    if (message.phase && message.role === "assistant") {
      input.phase = message.phase;
    }

    return input;
  });
}

export function extractTextFromChatCompletion(result: ChatCompletion): string {
  const message = result.choices[0]?.message;
  if (!message?.content) {
    return "";
  }

  if (typeof message.content === "string") {
    return message.content;
  }

  const parts = message.content as Array<{ text?: string; refusal?: string }>;
  return parts.map((part) => {
    if ("text" in part) {
      return part.text ?? "";
    }

    if ("refusal" in part) {
      return part.refusal ?? "";
    }

    return "";
  }).join("");
}

export function extractTextFromResponse(result: Response): string {
  return result.output_text ?? "";
}

export function extractChatTextDelta(chunk: ChatCompletionChunk): string {
  const content = chunk.choices[0]?.delta?.content;
  return typeof content === "string" ? content : "";
}

export function stripReservedRequestKeys<T extends Record<string, unknown>>(
  value: T | undefined,
  keys: readonly string[],
): Partial<T> | undefined {
  if (!value) {
    return undefined;
  }

  const copy: Partial<T> = { ...value };
  for (const key of keys) {
    delete copy[key as keyof T];
  }

  return copy;
}
