import assert from "node:assert/strict";
import { GeneralAI, InMemoryMemoryAdapter } from "../../dist/index.js";
import { createFakeOpenAI } from "../helpers.js";

const generalAI = new GeneralAI({
  openai: createFakeOpenAI(),
  memoryAdapter: new InMemoryMemoryAdapter(),
});

assert.ok(generalAI.native);
assert.ok(generalAI.agent);
