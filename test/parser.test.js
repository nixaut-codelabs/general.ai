import test from "node:test";
import assert from "node:assert/strict";
import { ProtocolStreamParser, parseProtocol } from "../dist/index.js";

test("parseProtocol parses writing, tool calls, and done markers", () => {
  const parsed = parseProtocol(
    [
      "[[[status:thinking]]]",
      "Planning",
      "[[[status:input_safety:{\"safe\":true}]]]",
      "[[[status:writing]]]",
      "Hello there.",
      "[[[status:call_tool:\"echo\":{\"text\":\"hello\"}]]]",
      "",
    ].join("\n"),
    { step: 1 },
  );

  assert.equal(parsed.events[0].kind, "thinking");
  assert.equal(parsed.events[1].kind, "input_safety");
  assert.equal(parsed.events[2].kind, "writing");
  assert.equal(parsed.events[3].kind, "call_tool");
  assert.equal(parsed.events[3].name, "echo");
});

test("parseProtocol falls back to implicit writing when markers are missing", () => {
  const parsed = parseProtocol("Plain text answer without markers.", { step: 1 });
  assert.equal(parsed.events[0].kind, "writing");
  assert.match(parsed.warnings[0], /implicit writing/i);
});

test("parseProtocol accepts block-style safety payloads", () => {
  const parsed = parseProtocol(
    [
      "[[[status:thinking]]]",
      "Plan",
      "[[[status:input_safety]]]",
      "{}",
      "[[[status:writing]]]",
      "Merhaba",
      "[[[status:output_safety]]]",
      "{}",
      "[[[status:done]]]",
    ].join("\n"),
    { step: 1 },
  );

  assert.deepEqual(parsed.events.map((event) => event.kind), [
    "thinking",
    "input_safety",
    "writing",
    "output_safety",
    "done",
  ]);
});

test("parseProtocol accepts near-miss markers with one missing closing bracket", () => {
  const parsed = parseProtocol(
    [
      "[[[status:thinking]]",
      "Plan",
      '[[[status:call_subagent:"math_helper":{"expression":"17 * 23"}]]',
    ].join("\n"),
    { step: 1 },
  );

  assert.deepEqual(parsed.events.map((event) => event.kind), [
    "thinking",
    "call_subagent",
  ]);
  assert.equal(parsed.events[1].name, "math_helper");
});

test("parseProtocol normalizes inline markers onto separate lines", () => {
  const parsed = parseProtocol(
    "[[[status:thinking]]]Plan [[[status:writing]]]Merhaba[[[status:done]]]",
    { step: 1 },
  );

  assert.deepEqual(parsed.events.map((event) => event.kind), [
    "thinking",
    "writing",
    "done",
  ]);
  assert.equal(parsed.events[1].content.trim(), "Merhaba");
});

test("ProtocolStreamParser supports incremental parsing", () => {
  const parser = new ProtocolStreamParser({ step: 1 });
  parser.push("[[[status:writing]]]\nHello");
  const parsed = parser.end();

  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0].kind, "writing");
  assert.equal(parsed.events[0].content, "Hello");
});
