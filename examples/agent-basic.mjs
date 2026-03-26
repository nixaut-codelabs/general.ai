import OpenAI from "openai";
import { GeneralAI, defineTool } from "../dist/index.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const generalAI = new GeneralAI({ openai });

const echoTool = defineTool({
  name: "echo",
  description: "Echo a string back for runtime testing.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      text: { type: "string" },
    },
    required: ["text"],
  },
  async execute(args) {
    return { echoed: args.text };
  },
});

const result = await generalAI.agent.generate({
  endpoint: "responses",
  model: "gpt-5.4-mini",
  messages: [{ role: "user", content: "Introduce yourself briefly." }],
  tools: {
    registry: [echoTool],
  },
});

console.log(result.cleaned);
