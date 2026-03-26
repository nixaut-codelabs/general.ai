import OpenAI from "openai";
import { GeneralAI } from "../dist/index.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const generalAI = new GeneralAI({ openai });

const completion = await generalAI.native.chat.completions.create({
  model: "gpt-5.4-mini",
  messages: [{ role: "user", content: "Say hello in one sentence." }],
});

console.log(completion.choices[0]?.message?.content ?? "");
