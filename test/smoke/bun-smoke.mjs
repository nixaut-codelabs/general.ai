import { GeneralAI } from "../../dist/index.js";
import { createFakeOpenAI } from "../helpers.js";

const generalAI = new GeneralAI({
  openai: createFakeOpenAI(),
});

if (!generalAI.agent || !generalAI.native) {
  throw new Error("GeneralAI surfaces were not created.");
}
