import type OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParams,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions/completions";
import type {
  Response,
  ResponseCreateParams,
  ResponseInput,
  ResponseStreamEvent,
} from "openai/resources/responses/responses";

export type GeneralAIEndpoint = "responses" | "chat_completions";
export type GeneralAIMessageRole = "system" | "developer" | "user" | "assistant";
export type GeneralAIPhase = "commentary" | "final_answer";

export interface GeneralAITextPart {
  type: "text";
  text: string;
}

export interface GeneralAIImagePart {
  type: "image_url";
  url: string;
  detail?: "auto" | "low" | "high" | "original";
}

export interface GeneralAIAudioPart {
  type: "input_audio";
  data: string;
  format: "mp3" | "wav";
}

export interface GeneralAIFilePart {
  type: "input_file";
  file_id?: string;
  file_url?: string;
  file_data?: string;
  filename?: string;
}

export type GeneralAIContentPart =
  | GeneralAITextPart
  | GeneralAIImagePart
  | GeneralAIAudioPart
  | GeneralAIFilePart;

export interface GeneralAIMessage {
  role: GeneralAIMessageRole;
  content: string | GeneralAIContentPart[];
  name?: string;
  phase?: GeneralAIPhase;
}

export type PromptSectionKey =
  | "identity"
  | "endpoint_responses"
  | "endpoint_chat_completions"
  | "protocol"
  | "safety"
  | "personality"
  | "thinking"
  | "tools_subagents"
  | "memory"
  | "task";

export interface GeneralAIPromptRawOverrides {
  prepend?: string;
  append?: string;
  replace?: string;
}

export interface GeneralAIPromptOverrides {
  sections?: Partial<Record<PromptSectionKey, string>>;
  raw?: GeneralAIPromptRawOverrides;
  data?: Record<string, string | number | boolean | null | undefined>;
  blocks?: Record<string, string | undefined>;
}

export interface GeneralAIPromptPack {
  rootDir?: string;
  sections?: Partial<Record<PromptSectionKey, string>>;
}

export interface GeneralAIPersonalityConfig {
  enabled?: boolean;
  profile?: string;
  persona?: Record<string, string | number | boolean>;
  style?: Record<string, string | number | boolean>;
  behavior?: Record<string, string | number | boolean>;
  boundaries?: Record<string, string | number | boolean>;
  instructions?: string;
  prompt?: string;
}

export type GeneralAISafetyMode = "off" | "relaxed" | "balanced" | "strict";

export interface GeneralAISafetyStageConfig {
  enabled?: boolean;
  instructions?: string;
}

export interface GeneralAISafetyConfig {
  enabled?: boolean;
  mode?: GeneralAISafetyMode;
  input?: GeneralAISafetyStageConfig;
  output?: GeneralAISafetyStageConfig;
  prompt?: string;
}

export interface GeneralAISafetyAssessment {
  safe?: boolean;
  severity?: "none" | "low" | "medium" | "high" | "critical" | string;
  categories?: string[];
  reason?: string;
  action?: "allow" | "warn" | "rewrite" | "refuse" | string;
  confidence?: number;
  [key: string]: unknown;
}

export type GeneralAIThinkingStrategy = "checkpointed" | "minimal" | "none";

export interface GeneralAIThinkingConfig {
  enabled?: boolean;
  strategy?: GeneralAIThinkingStrategy;
  effort?: "minimal" | "low" | "medium" | "high";
  checkpoints?: string[];
  prompt?: string;
}

export interface GeneralAILimits {
  maxSteps?: number;
  maxToolCalls?: number;
  maxSubagentCalls?: number;
  maxThinkingBlocks?: number;
  maxProtocolErrors?: number;
}

export interface GeneralAIMemorySnapshot {
  summary?: string;
  preferences?: string[];
  notes?: string[];
  metadata?: Record<string, string>;
}

export interface GeneralAIMemoryLoadParams {
  sessionId: string;
}

export interface GeneralAIMemorySaveParams {
  sessionId: string;
  snapshot: GeneralAIMemorySnapshot;
}

export interface GeneralAIMemoryAdapter {
  load(params: GeneralAIMemoryLoadParams): Promise<GeneralAIMemorySnapshot | null>;
  save(params: GeneralAIMemorySaveParams): Promise<void>;
}

export interface GeneralAIMemoryConfig {
  enabled?: boolean;
  sessionId?: string;
  load?: boolean;
  save?: boolean;
  adapter?: GeneralAIMemoryAdapter;
  prompt?: string;
}

export interface GeneralAIToolExecutionContext {
  openai: OpenAI;
  endpoint: GeneralAIEndpoint;
  model: string;
  step: number;
  sessionId?: string;
  signal?: AbortSignal;
  params: GeneralAIAgentParams;
}

export interface GeneralAIToolAccessPolicy {
  root?: boolean;
  subagents?: boolean | string[];
}

export interface GeneralAIToolDefinition<
  TArgs = Record<string, unknown>,
  TResult = unknown,
> {
  name: string;
  description: string;
  inputSchema?: unknown;
  metadata?: Record<string, string>;
  access?: GeneralAIToolAccessPolicy;
  execute(
    args: TArgs,
    context: GeneralAIToolExecutionContext,
  ): Promise<TResult> | TResult;
}

export interface GeneralAIToolsConfig {
  enabled?: boolean;
  registry?:
    | Record<string, GeneralAIToolDefinition>
    | GeneralAIToolDefinition[];
  prompt?: string;
}

export interface GeneralAISubagentDefinition {
  name: string;
  description: string;
  instructions: string;
  endpoint?: GeneralAIEndpoint;
  model?: string;
  personality?: GeneralAIPersonalityConfig;
  safety?: GeneralAISafetyConfig;
  thinking?: GeneralAIThinkingConfig;
  prompts?: GeneralAIPromptOverrides;
  limits?: GeneralAILimits;
  tools?: GeneralAIToolsConfig;
  subagents?: GeneralAISubagentsConfig;
  request?: GeneralAIRequestOverrides;
}

export interface GeneralAISubagentInvocationContext {
  openai: OpenAI;
  parentParams: GeneralAIAgentParams;
  step: number;
  sessionId?: string;
}

export interface GeneralAISubagentsConfig {
  enabled?: boolean;
  registry?:
    | Record<string, GeneralAISubagentDefinition>
    | GeneralAISubagentDefinition[];
  prompt?: string;
}

export interface GeneralAIRequestOverrides {
  responses?: Partial<ResponseCreateParams>;
  chat_completions?: Partial<ChatCompletionCreateParams>;
}

export interface GeneralAICompatibilityConfig {
  chatRoleMode?: "modern" | "classic";
}

export interface GeneralAIAgentParams {
  endpoint: GeneralAIEndpoint;
  model: string;
  messages: GeneralAIMessage[];
  personality?: GeneralAIPersonalityConfig;
  safety?: GeneralAISafetyConfig;
  thinking?: GeneralAIThinkingConfig;
  tools?: GeneralAIToolsConfig;
  subagents?: GeneralAISubagentsConfig;
  memory?: GeneralAIMemoryConfig;
  prompts?: GeneralAIPromptOverrides;
  limits?: GeneralAILimits;
  request?: GeneralAIRequestOverrides;
  compatibility?: GeneralAICompatibilityConfig;
  metadata?: Record<string, string>;
  debug?: boolean;
}

export interface GeneralAIRenderedPromptSection {
  key: PromptSectionKey;
  title: string;
  text: string;
}

export interface GeneralAIRenderedPrompts {
  sections: GeneralAIRenderedPromptSection[];
  fullPrompt: string;
}

export interface GeneralAIUsageSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
}

export interface GeneralAIProtocolEventBase {
  kind: string;
  step: number;
  rawMarker?: string;
}

export interface GeneralAIWritingEvent extends GeneralAIProtocolEventBase {
  kind: "writing";
  content: string;
}

export interface GeneralAIThinkingEvent extends GeneralAIProtocolEventBase {
  kind: "thinking";
  content: string;
}

export interface GeneralAIInputSafetyEvent extends GeneralAIProtocolEventBase {
  kind: "input_safety";
  payload: GeneralAISafetyAssessment;
}

export interface GeneralAIOutputSafetyEvent extends GeneralAIProtocolEventBase {
  kind: "output_safety";
  payload: GeneralAISafetyAssessment;
}

export interface GeneralAICallToolEvent extends GeneralAIProtocolEventBase {
  kind: "call_tool";
  name: string;
  arguments: unknown;
}

export interface GeneralAICallSubagentEvent extends GeneralAIProtocolEventBase {
  kind: "call_subagent";
  name: string;
  arguments: unknown;
}

export interface GeneralAICheckpointEvent extends GeneralAIProtocolEventBase {
  kind: "checkpoint";
}

export interface GeneralAIReviseEvent extends GeneralAIProtocolEventBase {
  kind: "revise";
}

export interface GeneralAIDoneEvent extends GeneralAIProtocolEventBase {
  kind: "done";
}

export interface GeneralAIErrorEvent extends GeneralAIProtocolEventBase {
  kind: "error";
  payload: Record<string, unknown>;
}

export type GeneralAIProtocolEvent =
  | GeneralAIWritingEvent
  | GeneralAIThinkingEvent
  | GeneralAIInputSafetyEvent
  | GeneralAIOutputSafetyEvent
  | GeneralAICallToolEvent
  | GeneralAICallSubagentEvent
  | GeneralAICheckpointEvent
  | GeneralAIReviseEvent
  | GeneralAIDoneEvent
  | GeneralAIErrorEvent;

export interface GeneralAIProtocolDeltaEvent {
  type: "writing_delta" | "thinking_delta";
  block: "writing" | "thinking";
  text: string;
}

export interface GeneralAIParsedProtocol {
  events: GeneralAIProtocolEvent[];
  deltas: GeneralAIProtocolDeltaEvent[];
  warnings: string[];
}

export interface GeneralAIAgentMeta {
  warnings: string[];
  prompt: GeneralAIRenderedPrompts;
  strippedRequestKeys: string[];
  stepCount: number;
  toolCallCount: number;
  subagentCallCount: number;
  protocolErrorCount: number;
  memorySessionId?: string;
  endpointResults: unknown[];
}

export interface GeneralAIAgentResult {
  output: string;
  cleaned: string;
  events: GeneralAIProtocolEvent[];
  meta: GeneralAIAgentMeta;
  usage: GeneralAIUsageSummary;
  endpointResult: unknown;
}

export type GeneralAIAgentStreamEvent =
  | {
      type: "run_started";
      endpoint: GeneralAIEndpoint;
      model: string;
    }
  | {
      type: "prompt_rendered";
      prompt: GeneralAIRenderedPrompts;
    }
  | {
      type: "step_started";
      step: number;
    }
  | {
      type: "raw_text_delta";
      step: number;
      text: string;
    }
  | {
      type: "writing_delta";
      step: number;
      text: string;
    }
  | {
      type: "protocol_event";
      step: number;
      event: GeneralAIProtocolEvent;
    }
  | {
      type: "tool_started";
      step: number;
      name: string;
      arguments: unknown;
    }
  | {
      type: "tool_result";
      step: number;
      name: string;
      result: unknown;
    }
  | {
      type: "subagent_started";
      step: number;
      name: string;
      arguments: unknown;
    }
  | {
      type: "subagent_result";
      step: number;
      name: string;
      result: GeneralAIAgentResult;
    }
  | {
      type: "warning";
      message: string;
    }
  | {
      type: "run_completed";
      result: GeneralAIAgentResult;
    };

export interface GeneralAILibraryDefaults {
  debug?: boolean;
  agent?: Partial<
    Omit<
      GeneralAIAgentParams,
      "endpoint" | "model" | "messages" | "request" | "metadata"
    >
  >;
}

export interface GeneralAINativeSurface {
  openai: OpenAI;
  responses: OpenAI["responses"];
  chat: OpenAI["chat"];
}

export interface GeneralAIConstructorOptions {
  openai: OpenAI;
  defaults?: GeneralAILibraryDefaults;
  memoryAdapter?: GeneralAIMemoryAdapter;
  promptPack?: GeneralAIPromptPack;
  debug?: boolean;
}

export type GeneralAINativeResponseResult = Response;
export type GeneralAINativeResponsesInput = ResponseInput;
export type GeneralAINativeResponseStreamEvent = ResponseStreamEvent;
export type GeneralAINativeChatResult = ChatCompletion;
export type GeneralAINativeChatMessage = ChatCompletionMessageParam;
export type GeneralAINativeChatStreamChunk = ChatCompletionChunk;
