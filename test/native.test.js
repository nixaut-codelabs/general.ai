import test from "node:test";
import assert from "node:assert/strict";
import { GeneralAI } from "../dist/index.js";
import { createFakeOpenAI } from "./helpers.js";

test("native surface re-exposes exact client surfaces", () => {
  const openai = createFakeOpenAI();
  const generalAI = new GeneralAI({ openai });

  assert.equal(generalAI.native.openai, openai);
  assert.equal(generalAI.native.responses, openai.responses);
  assert.equal(generalAI.native.chat, openai.chat);
});
