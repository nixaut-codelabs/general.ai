import OpenAI from "openai";
import { GeneralAI } from "../dist/index.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const generalAI = new GeneralAI({ openai });

const response = await generalAI.native.responses.create({
  model: "gpt-5.4-mini",
  input: "Give a one-sentence explanation of prompt caching.",
});

console.log(response.output_text);
