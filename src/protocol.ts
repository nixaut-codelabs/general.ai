import type {
  GeneralAICallSubagentEvent,
  GeneralAICallToolEvent,
  GeneralAICheckpointEvent,
  GeneralAIDoneEvent,
  GeneralAIErrorEvent,
  GeneralAIInputSafetyEvent,
  GeneralAIOutputSafetyEvent,
  GeneralAIParsedProtocol,
  GeneralAIProtocolDeltaEvent,
  GeneralAIProtocolEvent,
  GeneralAIReviseEvent,
  GeneralAIThinkingEvent,
  GeneralAIWritingEvent,
} from "./types.js";

const MARKER_PREFIX = "[[[status:";
const MARKER_SUFFIX = "]]]";
const LENIENT_MARKER_SUFFIX = "]]";

interface ParseContext {
  step: number;
}

type OpenBlock =
  | { openBlock: "writing" | "thinking"; rawMarker: string }
  | {
      openBlock: "input_safety" | "output_safety" | "error";
      rawMarker: string;
    }
  | {
      openBlock: "call_tool" | "call_subagent";
      rawMarker: string;
      name: string;
    };

function buildMarker(inner: string, suffix = MARKER_SUFFIX): string {
  return `${MARKER_PREFIX}${inner}${suffix}`;
}

function normalizeProtocolText(text: string): string {
  return text
    .replace(/([^\n])(\[\[\[status:)/g, "$1\n$2")
    .replace(/(\[\[\[status:[^\n]*?(?:\]\]\]|\]\](?!\])))(?=[^\n])/g, "$1\n");
}

function parseJsonPayload(payload: string, marker: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("JSON payload must decode to an object.");
    }

    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `Invalid JSON payload in protocol marker ${marker}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function parseOptionalJsonPayload(
  payload: string,
  marker: string,
): Record<string, unknown> {
  const trimmed = payload.trim();
  if (!trimmed) {
    return {};
  }

  return parseJsonPayload(trimmed, marker);
}

function parseMarker(
  inner: string,
  context: ParseContext,
  rawMarker = buildMarker(inner),
): GeneralAIProtocolEvent | OpenBlock {

  if (inner === "writing") {
    return { openBlock: "writing", rawMarker };
  }

  if (inner === "thinking") {
    return { openBlock: "thinking", rawMarker };
  }

  if (inner === "checkpoint") {
    const event: GeneralAICheckpointEvent = {
      kind: "checkpoint",
      payload: {},
      step: context.step,
      rawMarker,
    };
    return event;
  }

  if (inner.startsWith("checkpoint:")) {
    const event: GeneralAICheckpointEvent = {
      kind: "checkpoint",
      payload: parseJsonPayload(inner.slice("checkpoint:".length), rawMarker),
      step: context.step,
      rawMarker,
    };
    return event;
  }

  if (inner === "revise") {
    const event: GeneralAIReviseEvent = {
      kind: "revise",
      payload: {},
      step: context.step,
      rawMarker,
    };
    return event;
  }

  if (inner.startsWith("revise:")) {
    const event: GeneralAIReviseEvent = {
      kind: "revise",
      payload: parseJsonPayload(inner.slice("revise:".length), rawMarker),
      step: context.step,
      rawMarker,
    };
    return event;
  }

  if (inner === "done") {
    const event: GeneralAIDoneEvent = {
      kind: "done",
      step: context.step,
      rawMarker,
    };
    return event;
  }

  if (inner.startsWith("input_safety:")) {
    const payload = parseJsonPayload(inner.slice("input_safety:".length), rawMarker);
    const event: GeneralAIInputSafetyEvent = {
      kind: "input_safety",
      payload,
      step: context.step,
      rawMarker,
    };
    return event;
  }

  if (inner === "input_safety") {
    return {
      openBlock: "input_safety",
      rawMarker,
    };
  }

  if (inner.startsWith("output_safety:")) {
    const payload = parseJsonPayload(inner.slice("output_safety:".length), rawMarker);
    const event: GeneralAIOutputSafetyEvent = {
      kind: "output_safety",
      payload,
      step: context.step,
      rawMarker,
    };
    return event;
  }

  if (inner === "output_safety") {
    return {
      openBlock: "output_safety",
      rawMarker,
    };
  }

  if (inner.startsWith("error:")) {
    const payload = parseJsonPayload(inner.slice("error:".length), rawMarker);
    const event: GeneralAIErrorEvent = {
      kind: "error",
      payload,
      step: context.step,
      rawMarker,
    };
    return event;
  }

  if (inner === "error") {
    return {
      openBlock: "error",
      rawMarker,
    };
  }

  if (inner.startsWith('call_tool:"')) {
    const remainder = inner.slice('call_tool:"'.length);
    const splitIndex = remainder.indexOf('":');
    if (splitIndex === -1) {
      return {
        openBlock: "call_tool",
        rawMarker,
        name: remainder.slice(0, -1),
      };
    }

    const name = remainder.slice(0, splitIndex);
    const payload = JSON.parse(remainder.slice(splitIndex + 2)) as unknown;
    const event: GeneralAICallToolEvent = {
      kind: "call_tool",
      name,
      arguments: payload,
      step: context.step,
      rawMarker,
    };
    return event;
  }

  if (inner.startsWith('call_subagent:"')) {
    const remainder = inner.slice('call_subagent:"'.length);
    const splitIndex = remainder.indexOf('":');
    if (splitIndex === -1) {
      return {
        openBlock: "call_subagent",
        rawMarker,
        name: remainder.slice(0, -1),
      };
    }

    const name = remainder.slice(0, splitIndex);
    const payload = JSON.parse(remainder.slice(splitIndex + 2)) as unknown;
    const event: GeneralAICallSubagentEvent = {
      kind: "call_subagent",
      name,
      arguments: payload,
      step: context.step,
      rawMarker,
    };
    return event;
  }

  throw new Error(`Unknown protocol marker: ${rawMarker}`);
}

function flushBlock(
  block:
    | { type: "writing" | "thinking"; rawMarker: string; content: string }
    | {
        type: "input_safety" | "output_safety" | "error";
        rawMarker: string;
        content: string;
      }
    | {
        type: "call_tool" | "call_subagent";
        rawMarker: string;
        content: string;
        name: string;
      }
    | null,
  context: ParseContext,
  events: GeneralAIProtocolEvent[],
): void {
  if (!block) {
    return;
  }

  if (
    (block.type === "writing" || block.type === "thinking") &&
    !block.content.trim()
  ) {
    return;
  }

  if (block.type === "writing") {
    const event: GeneralAIWritingEvent = {
      kind: "writing",
      content: block.content,
      step: context.step,
      rawMarker: block.rawMarker,
    };
    events.push(event);
    return;
  }

  if (
    block.type === "input_safety" ||
    block.type === "output_safety" ||
    block.type === "error" ||
    block.type === "call_tool" ||
    block.type === "call_subagent"
  ) {
    flushStructuredBlock(block, context, events);
    return;
  }

  const event: GeneralAIThinkingEvent = {
    kind: "thinking",
    content: block.content,
    step: context.step,
    rawMarker: block.rawMarker,
  };
  events.push(event);
  return;
}

function flushStructuredBlock(
  block:
    | {
        type: "input_safety" | "output_safety" | "error";
        rawMarker: string;
        content: string;
      }
    | {
        type: "call_tool" | "call_subagent";
        rawMarker: string;
        content: string;
        name: string;
      },
  context: ParseContext,
  events: GeneralAIProtocolEvent[],
): void {
  if (block.type === "input_safety") {
    events.push({
      kind: "input_safety",
      payload: parseOptionalJsonPayload(block.content, block.rawMarker),
      step: context.step,
      rawMarker: block.rawMarker,
    });
    return;
  }

  if (block.type === "output_safety") {
    events.push({
      kind: "output_safety",
      payload: parseOptionalJsonPayload(block.content, block.rawMarker),
      step: context.step,
      rawMarker: block.rawMarker,
    });
    return;
  }

  if (block.type === "error") {
    events.push({
      kind: "error",
      payload: parseOptionalJsonPayload(block.content, block.rawMarker),
      step: context.step,
      rawMarker: block.rawMarker,
    });
    return;
  }

  if (block.type === "call_tool") {
    events.push({
      kind: "call_tool",
      name: block.name,
      arguments: parseOptionalJsonPayload(block.content, block.rawMarker),
      step: context.step,
      rawMarker: block.rawMarker,
    });
    return;
  }

  if (block.type === "call_subagent") {
    events.push({
      kind: "call_subagent",
      name: block.name,
      arguments: parseOptionalJsonPayload(block.content, block.rawMarker),
      step: context.step,
      rawMarker: block.rawMarker,
    });
  }
}

export class ProtocolStreamParser {
  #buffer = "";
  #events: GeneralAIProtocolEvent[] = [];
  #warnings: string[] = [];
  #deltas: GeneralAIProtocolDeltaEvent[] = [];
  #seenMarker = false;
  #activeBlock:
    | { type: "writing" | "thinking"; rawMarker: string; content: string }
    | {
        type: "input_safety" | "output_safety" | "error";
        rawMarker: string;
        content: string;
      }
    | {
        type: "call_tool" | "call_subagent";
        rawMarker: string;
        content: string;
        name: string;
      }
    | null = null;

  constructor(private readonly context: ParseContext) {}

  push(chunk: string): GeneralAIParsedProtocol {
    this.#buffer = normalizeProtocolText(this.#buffer + chunk);
    this.#consume(false);
    return this.snapshot();
  }

  end(): GeneralAIParsedProtocol {
    this.#consume(true);
    return this.snapshot();
  }

  snapshot(): GeneralAIParsedProtocol {
    return {
      events: [...this.#events],
      deltas: [...this.#deltas],
      warnings: [...this.#warnings],
    };
  }

  #consume(flushPartial: boolean): void {
    while (this.#buffer.length > 0) {
      if (this.#buffer.startsWith(MARKER_PREFIX)) {
        const newlineIndex = this.#buffer.indexOf("\n");
        if (!flushPartial && newlineIndex === -1) {
          break;
        }

        const line =
          newlineIndex === -1 ? this.#buffer : this.#buffer.slice(0, newlineIndex);
        const suffix = line.endsWith(MARKER_SUFFIX)
          ? MARKER_SUFFIX
          : line.endsWith(LENIENT_MARKER_SUFFIX)
            ? LENIENT_MARKER_SUFFIX
            : null;

        if (!suffix) {
          break;
        }

        const marker = line;
        this.#buffer =
          newlineIndex === -1 ? "" : this.#buffer.slice(newlineIndex + 1);
        this.#seenMarker = true;
        flushBlock(this.#activeBlock, this.context, this.#events);
        this.#activeBlock = null;

        const parsed = parseMarker(
          marker.slice(MARKER_PREFIX.length, -suffix.length),
          this.context,
          marker,
        );

        if ("openBlock" in parsed) {
          this.#activeBlock =
            "name" in parsed
              ? {
                  type: parsed.openBlock,
                  rawMarker: parsed.rawMarker,
                  content: "",
                  name: parsed.name,
                }
              : {
                  type: parsed.openBlock,
                  rawMarker: parsed.rawMarker,
                  content: "",
                };
          continue;
        }

        this.#events.push(parsed);
        continue;
      }

      const nextMarkerIndex = this.#buffer.indexOf(`\n${MARKER_PREFIX}`);
      if (this.#activeBlock) {
        if (nextMarkerIndex !== -1) {
          this.#appendToBlock(this.#buffer.slice(0, nextMarkerIndex + 1));
          this.#buffer = this.#buffer.slice(nextMarkerIndex + 1);
          continue;
        }

        if (flushPartial) {
          this.#appendToBlock(this.#buffer);
          this.#buffer = "";
          break;
        }

        const lastNewline = this.#buffer.lastIndexOf("\n");
        if (lastNewline === -1) {
          break;
        }

        this.#appendToBlock(this.#buffer.slice(0, lastNewline + 1));
        this.#buffer = this.#buffer.slice(lastNewline + 1);
        continue;
      }

      if (flushPartial) {
        if (!this.#seenMarker && this.#buffer.trim()) {
          this.#warnings.push(
            "Model output did not include protocol markers. Falling back to implicit writing block.",
          );
          this.#events.push({
            kind: "writing",
            content: this.#buffer,
            step: this.context.step,
          });
        } else if (this.#buffer.trim()) {
          this.#warnings.push(
            `Ignoring stray text outside protocol blocks: ${this.#buffer.trim()}`,
          );
        }

        this.#buffer = "";
        break;
      }

      break;
    }

    if (flushPartial) {
      flushBlock(this.#activeBlock, this.context, this.#events);
      this.#activeBlock = null;
    }
  }

  #appendToBlock(text: string): void {
    if (!this.#activeBlock || !text) {
      return;
    }

    this.#activeBlock.content += text;
    if (this.#activeBlock.type === "writing" || this.#activeBlock.type === "thinking") {
      this.#deltas.push({
        type:
          this.#activeBlock.type === "writing" ? "writing_delta" : "thinking_delta",
        block: this.#activeBlock.type,
        text,
      });
    }
  }
}

export function parseProtocol(
  text: string,
  context: ParseContext = { step: 1 },
): GeneralAIParsedProtocol {
  const parser = new ProtocolStreamParser(context);
  parser.push(text);
  return parser.end();
}

export function validateProtocolSequence(
  events: GeneralAIProtocolEvent[],
  safetyEnabled: boolean,
): string[] {
  const warnings: string[] = [];
  const kinds = events.map((event) => event.kind);

  if (events.length === 0) {
    warnings.push("No protocol events were produced.");
    return warnings;
  }

  if (events[0]?.kind !== "thinking") {
    warnings.push("Protocol sequence does not begin with a thinking block.");
  }

  if (safetyEnabled && !kinds.includes("input_safety")) {
    warnings.push("Protocol sequence does not include input_safety.");
  }

  if (safetyEnabled && !kinds.includes("output_safety")) {
    warnings.push("Protocol sequence does not include output_safety.");
  }

  const doneIndex = kinds.lastIndexOf("done");
  if (doneIndex === -1) {
    warnings.push("Protocol sequence does not include done.");
  }

  const outputSafetyIndex = kinds.lastIndexOf("output_safety");
  if (outputSafetyIndex !== -1 && doneIndex !== -1 && outputSafetyIndex > doneIndex) {
    warnings.push("output_safety appears after done.");
  }

  return warnings;
}
