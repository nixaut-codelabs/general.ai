import assert from "node:assert/strict";
import { inspect } from "node:util";
import { performance } from "node:perf_hooks";
import { OpenAI } from "openai";
import {
    GeneralAI,
    InMemoryMemoryAdapter,
    ProtocolStreamParser,
    compileMessagesForChatCompletions,
    compileMessagesForResponses,
    createOpenAIWebSearchTool,
    defineSubagent,
    defineTool,
    extractTextFromChatCompletion,
    extractTextFromResponse,
    parseProtocol,
    renderPromptSections,
    validateProtocolSequence,
} from "./dist/index.js";
import { createFakeOpenAI } from "./test/helpers.js";

const TEST_MODEL = "gpt-5.4-mini";
const LIVE_MODEL = process.env.GENERAL_AI_MODEL ?? "gpt-5.4-mini";
const LIVE_API_KEY =
    process.env.GENERAL_AI_API_KEY ??
    process.env.OPENAI_API_KEY
const LIVE_BASE_URL =
    process.env.GENERAL_AI_BASE_URL;
const RUN_LIVE = process.env.GENERAL_AI_SKIP_LIVE === "1" ? false : Boolean(LIVE_API_KEY);

class SkipCaseError extends Error {
    constructor(message) {
        super(message);
        this.name = "SkipCaseError";
    }
}

const results = [];

function divider(title) {
    console.log("\n" + "=".repeat(88));
    console.log(title);
    console.log("=".repeat(88));
}

function preview(value, maxLength = 700) {
    if (value === undefined) {
        return "";
    }

    const text =
        typeof value === "string"
            ? value
            : inspect(value, { depth: 5, colors: false, maxArrayLength: 20 });

    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function protocol(lines) {
    return lines.join("\n");
}

async function runCase(section, name, fn) {
    const start = performance.now();

    try {
        const detail = await fn();
        const durationMs = (performance.now() - start).toFixed(1);
        results.push({ status: "pass", section, name, durationMs });
        console.log(`[PASS] ${section} :: ${name} (${durationMs}ms)`);
        if (detail) {
            console.log(preview(detail));
        }
    } catch (error) {
        const durationMs = (performance.now() - start).toFixed(1);
        if (error instanceof SkipCaseError) {
            results.push({ status: "skip", section, name, durationMs, reason: error.message });
            console.log(`[SKIP] ${section} :: ${name} (${durationMs}ms)`);
            console.log(error.message);
            return;
        }

        results.push({ status: "fail", section, name, durationMs, error });
        console.log(`[FAIL] ${section} :: ${name} (${durationMs}ms)`);
        console.log(preview(error));
    }
}

function printSummary() {
    divider("SUMMARY");

    const passed = results.filter((entry) => entry.status === "pass").length;
    const skipped = results.filter((entry) => entry.status === "skip").length;
    const failed = results.filter((entry) => entry.status === "fail").length;

    console.log(`Passed: ${passed}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Failed: ${failed}`);

    if (failed > 0) {
        console.log("\nFailed cases:");
        for (const entry of results.filter((value) => value.status === "fail")) {
            console.log(`- ${entry.section} :: ${entry.name}`);
        }
        process.exitCode = 1;
        return;
    }

    console.log("\nAll requested test.js checks passed.");
}

function createLiveClient() {
    if (!RUN_LIVE) {
        throw new SkipCaseError(
            "Live provider tests are disabled. Set GENERAL_AI_API_KEY or remove GENERAL_AI_SKIP_LIVE=1.",
        );
    }

    return new OpenAI({
        apiKey: LIVE_API_KEY,
        baseURL: LIVE_BASE_URL,
    });
}

async function runDeterministicSuite() {
    divider("DETERMINISTIC PUBLIC API TESTS");

    await runCase("constructor", "GeneralAI requires an injected OpenAI client", async () => {
        assert.throws(() => new GeneralAI({}), /requires an injected OpenAI client/i);
        return "Constructor throws when no OpenAI client is provided.";
    });

    await runCase("native", "native surface re-exposes exact client references", async () => {
        const fake = createFakeOpenAI();
        const generalAI = new GeneralAI({ openai: fake });

        assert.equal(generalAI.native.openai, fake);
        assert.equal(generalAI.native.responses, fake.responses);
        assert.equal(generalAI.native.chat, fake.chat);
        return "native.openai, native.responses, and native.chat all reference the injected client.";
    });

    await runCase("helpers", "chat compiler maps classic roles and continuation instructions", async () => {
        const compiled = compileMessagesForChatCompletions(
            [
                { role: "developer", content: "Primary runtime contract." },
                { role: "user", content: "Hello" },
                { role: "assistant", content: "Hi" },
                { role: "developer", content: "Continue from tool result." },
            ],
            { chatRoleMode: "classic" },
        );

        assert.deepEqual(compiled.map((message) => message.role), [
            "system",
            "user",
            "assistant",
            "user",
        ]);
        assert.match(compiled[3].content, /runtime continuation instruction/i);
        return compiled;
    });

    await runCase("helpers", "responses compiler and text extractors handle structured content", async () => {
        const compiled = compileMessagesForResponses([
            {
                role: "user",
                content: [
                    { type: "text", text: "Hello" },
                    { type: "image_url", url: "https://example.com/cat.png", detail: "high" },
                ],
            },
            {
                role: "assistant",
                phase: "final_answer",
                content: "Done",
            },
        ]);

        assert.equal(compiled[0].content[0].type, "input_text");
        assert.equal(compiled[0].content[1].type, "input_image");
        assert.equal(compiled[1].phase, "final_answer");

        const chatText = extractTextFromChatCompletion({
            choices: [
                {
                    message: {
                        content: [{ text: "Hello " }, { text: "world" }],
                    },
                },
            ],
        });
        const responseText = extractTextFromResponse({
            output_text: "Responses text",
        });

        assert.equal(chatText, "Hello world");
        assert.equal(responseText, "Responses text");
        return { compiled, chatText, responseText };
    });

    await runCase("protocol", "parseProtocol handles standard, block, lenient, and inline markers", async () => {
        const standard = parseProtocol(
            protocol([
                "[[[status:thinking]]]",
                "Planning.",
                "[[[status:input_safety:{\"safe\":true}]]]",
                "[[[status:writing]]]",
                "Hello there.",
                "[[[status:call_tool:\"echo\":{\"text\":\"hello\"}]]]",
            ]),
            { step: 1 },
        );
        assert.deepEqual(standard.events.map((event) => event.kind), [
            "thinking",
            "input_safety",
            "writing",
            "call_tool",
        ]);

        const blockStyle = parseProtocol(
            protocol([
                "[[[status:thinking]]]",
                "Plan",
                "[[[status:input_safety]]]",
                "{}",
                "[[[status:writing]]]",
                "Merhaba",
                "[[[status:output_safety]]]",
                "{}",
                "[[[status:done]]]",
            ]),
            { step: 1 },
        );
        assert.deepEqual(blockStyle.events.map((event) => event.kind), [
            "thinking",
            "input_safety",
            "writing",
            "output_safety",
            "done",
        ]);

        const lenient = parseProtocol(
            protocol([
                "[[[status:thinking]]",
                "Plan",
                '[[[status:call_subagent:"math_helper":{"expression":"17 * 23"}]]',
            ]),
            { step: 1 },
        );
        assert.deepEqual(lenient.events.map((event) => event.kind), [
            "thinking",
            "call_subagent",
        ]);

        const inline = parseProtocol(
            "[[[status:thinking]]]Plan [[[status:writing]]]Merhaba[[[status:done]]]",
            { step: 1 },
        );
        assert.deepEqual(inline.events.map((event) => event.kind), [
            "thinking",
            "writing",
            "done",
        ]);
        assert.equal(inline.events[1].content.trim(), "Merhaba");

        return {
            standard: standard.events.map((event) => event.kind),
            blockStyle: blockStyle.events.map((event) => event.kind),
            lenient: lenient.events.map((event) => event.kind),
            inline: inline.events.map((event) => event.kind),
        };
    });

    await runCase("protocol", "ProtocolStreamParser supports incremental parsing and sequence validation", async () => {
        const parser = new ProtocolStreamParser({ step: 1 });
        parser.push("[[[status:thinking]]]\nDrafting");
        parser.push("\n[[[status:writing]]]\nHello");
        parser.push("\n[[[status:done]]]");
        const parsed = parser.end();

        assert.deepEqual(parsed.events.map((event) => event.kind), [
            "thinking",
            "writing",
            "done",
        ]);
        assert.equal(parsed.events[1].content, "Hello\n");

        const warnings = validateProtocolSequence(
            [{ kind: "writing", content: "Bad sequence", step: 1 }],
            true,
        );
        assert.ok(warnings.some((warning) => /does not begin with a thinking block/i.test(warning)));
        return { events: parsed.events.map((event) => event.kind), warnings };
    });

    await runCase("prompts", "renderPromptSections applies sections, data, blocks, and raw overrides", async () => {
        const rendered = await renderPromptSections({
            runtimeOverrides: {
                sections: {
                    task: "Task override for {data:model}.\n{block:task_context}",
                },
                raw: {
                    append: "RAW APPEND {data:endpoint}",
                },
            },
            context: {
                data: {
                    endpoint: "responses",
                    model: TEST_MODEL,
                    safety_mode: "balanced",
                    thinking_strategy: "checkpointed",
                    debug_enabled: false,
                },
                blocks: {
                    personality_config: "Persona block",
                    safety_config: "Safety block",
                    thinking_config: "Thinking block",
                    tools_registry: "Tools block",
                    subagents_registry: "Subagents block",
                    memory_context: "Memory block",
                    task_context: "Task block",
                },
            },
        });

        assert.match(rendered.fullPrompt, /Task override for gpt-5\.4-mini/i);
        assert.match(rendered.fullPrompt, /RAW APPEND responses/i);
        assert.ok(rendered.sections.length > 0);
        return rendered.fullPrompt;
    });

    await runCase("prompts", "agent.renderPrompts includes personality, safety, thinking, and task metadata", async () => {
        const generalAI = new GeneralAI({
            openai: createFakeOpenAI(),
        });

        const prompt = await generalAI.agent.renderPrompts({
            endpoint: "responses",
            model: TEST_MODEL,
            messages: [{ role: "user", content: "Hello there" }],
            personality: {
                profile: "critic",
                instructions: "Be direct.",
                persona: { honesty: "high" },
            },
            safety: {
                mode: "strict",
                input: { instructions: "Inspect input." },
                output: { instructions: "Inspect output." },
            },
            thinking: {
                effort: "high",
                checkpoints: ["Before writing", "Before done"],
            },
            metadata: {
                suite: "test.js",
            },
        });

        assert.match(prompt.fullPrompt, /Profile: critic/);
        assert.match(prompt.fullPrompt, /Inspect input/i);
        assert.match(prompt.fullPrompt, /Before writing/i);
        assert.match(prompt.fullPrompt, /suite: test\.js/i);
        return prompt.fullPrompt;
    });

    await runCase("memory", "InMemoryMemoryAdapter saves and loads snapshots directly", async () => {
        const memory = new InMemoryMemoryAdapter();
        await memory.save({
            sessionId: "memory-direct",
            snapshot: {
                summary: "Stored summary",
                notes: ["note-1"],
            },
        });

        const loaded = await memory.load({ sessionId: "memory-direct" });
        assert.equal(loaded.summary, "Stored summary");
        assert.deepEqual(loaded.notes, ["note-1"]);
        return loaded;
    });

    await runCase("memory", "agent memory persists summary across runs", async () => {
        const fake = createFakeOpenAI({
            chatOutputs: [
                protocol([
                    "[[[status:thinking]]]",
                    "Remembering.",
                    "[[[status:input_safety:{\"safe\":true}]]]",
                    "[[[status:writing]]]",
                    "First answer.",
                    "[[[status:output_safety:{\"safe\":true}]]]",
                    "[[[status:done]]]",
                ]),
            ],
        });
        const memory = new InMemoryMemoryAdapter();
        const generalAI = new GeneralAI({
            openai: fake,
            memoryAdapter: memory,
        });

        await generalAI.agent.generate({
            endpoint: "chat_completions",
            model: TEST_MODEL,
            messages: [{ role: "user", content: "Remember this exchange." }],
            memory: {
                enabled: true,
                sessionId: "memory-session",
            },
            compatibility: {
                chatRoleMode: "classic",
            },
        });

        const secondPrompt = await generalAI.agent.renderPrompts({
            endpoint: "chat_completions",
            model: TEST_MODEL,
            messages: [{ role: "user", content: "Use previous memory." }],
            memory: {
                enabled: true,
                sessionId: "memory-session",
            },
            compatibility: {
                chatRoleMode: "classic",
            },
        });

        assert.match(secondPrompt.fullPrompt, /Latest cleaned output:/);
        assert.match(secondPrompt.fullPrompt, /First answer\./);
        return secondPrompt.fullPrompt;
    });

    await runCase("tools", "createOpenAIWebSearchTool wraps responses.create with web_search", async () => {
        const fake = createFakeOpenAI({
            responseOutputs: ["Synthetic search answer."],
        });
        const tool = createOpenAIWebSearchTool({
            openai: fake,
            model: TEST_MODEL,
        });
        const result = await tool.execute({ query: "what do dogs eat" });

        assert.equal(fake.responseRequestBodies.length, 1);
        assert.equal(fake.responseRequestBodies[0].tools[0].type, "web_search");
        assert.equal(result.answer, "Synthetic search answer.");
        return fake.responseRequestBodies[0];
    });

    await runCase("native", "native responses and chat calls preserve exact fake outputs", async () => {
        const fake = createFakeOpenAI({
            responseOutputs: ["Native responses text."],
            chatOutputs: ["Native chat text."],
        });
        const generalAI = new GeneralAI({ openai: fake });

        const nativeResponse = await generalAI.native.responses.create({
            model: TEST_MODEL,
            input: "Hello",
        });
        const nativeChat = await generalAI.native.chat.completions.create({
            model: TEST_MODEL,
            messages: [{ role: "user", content: "Hello" }],
        });

        assert.equal(nativeResponse.output_text, "Native responses text.");
        assert.equal(nativeChat.choices[0].message.content, "Native chat text.");
        return {
            responses: nativeResponse.output_text,
            chat: nativeChat.choices[0].message.content,
        };
    });

    await runCase("agent", "responses endpoint executes a protocol tool loop and aggregates usage", async () => {
        const fake = createFakeOpenAI({
            responseOutputs: [
                protocol([
                    "[[[status:thinking]]]",
                    "Need a tool.",
                    "[[[status:input_safety:{\"safe\":true}]]]",
                    "[[[status:call_tool:\"echo\":{\"text\":\"hello\"}]]]",
                ]),
                protocol([
                    "[[[status:thinking]]]",
                    "Tool result received.",
                    "[[[status:input_safety:{\"safe\":true}]]]",
                    "[[[status:writing]]]",
                    "Echo complete.",
                    "[[[status:output_safety:{\"safe\":true}]]]",
                    "[[[status:done]]]",
                ]),
            ],
        });
        const generalAI = new GeneralAI({ openai: fake });
        const echo = defineTool({
            name: "echo",
            description: "Echo text.",
            async execute(args) {
                return args;
            },
        });

        const result = await generalAI.agent.generate({
            endpoint: "responses",
            model: TEST_MODEL,
            messages: [{ role: "user", content: "Say hello." }],
            tools: { registry: [echo] },
        });

        assert.match(result.cleaned, /Echo complete/);
        assert.equal(result.meta.toolCallCount, 1);
        assert.equal(result.usage.totalTokens, 30);
        return {
            cleaned: result.cleaned,
            usage: result.usage,
            events: result.events.map((event) => event.kind),
        };
    });

    await runCase("agent", "chat endpoint supports classic mode, request passthrough, and reserved stripping", async () => {
        const fake = createFakeOpenAI({
            chatOutputs: [
                protocol([
                    "[[[status:thinking]]]",
                    "Ready.",
                    "[[[status:input_safety:{\"safe\":true}]]]",
                    "[[[status:writing]]]",
                    "Hello from chat mode.",
                    "[[[status:output_safety:{\"safe\":true}]]]",
                    "[[[status:done]]]",
                ]),
            ],
        });
        const generalAI = new GeneralAI({ openai: fake });

        const result = await generalAI.agent.generate({
            endpoint: "chat_completions",
            model: TEST_MODEL,
            messages: [{ role: "user", content: "Hi" }],
            request: {
                chat_completions: {
                    temperature: 0,
                    response_format: { type: "json_object" },
                },
            },
            compatibility: {
                chatRoleMode: "classic",
            },
        });

        assert.match(result.cleaned, /Hello from chat mode/);
        assert.equal(fake.chatRequestBodies[0].temperature, 0);
        assert.ok(result.meta.strippedRequestKeys.includes("response_format"));
        assert.equal(fake.chatRequestBodies[0].messages[0].role, "system");
        return {
            cleaned: result.cleaned,
            stripped: result.meta.strippedRequestKeys,
            firstRoles: fake.chatRequestBodies[0].messages.map((message) => message.role),
        };
    });

    await runCase("agent", "classic mode downgrades continuation instructions after assistant turns", async () => {
        const fake = createFakeOpenAI({
            chatOutputs: [
                protocol([
                    "[[[status:thinking]]]",
                    "Need a tool.",
                    "[[[status:input_safety:{\"safe\":true}]]]",
                    "[[[status:call_tool:\"echo\":{\"text\":\"hello\"}]]]",
                ]),
                protocol([
                    "[[[status:writing]]]",
                    "Hello after tool.",
                    "[[[status:done]]]",
                ]),
            ],
        });
        const generalAI = new GeneralAI({ openai: fake });
        const echo = defineTool({
            name: "echo",
            description: "Echo text",
            async execute(args) {
                return args;
            },
        });

        const result = await generalAI.agent.generate({
            endpoint: "chat_completions",
            model: TEST_MODEL,
            messages: [{ role: "user", content: "Hi" }],
            tools: { registry: [echo] },
            compatibility: {
                chatRoleMode: "classic",
            },
        });

        assert.match(result.cleaned, /Hello after tool/);
        assert.deepEqual(
            fake.chatRequestBodies[1].messages.map((message) => message.role),
            ["system", "user", "assistant", "user"],
        );
        return fake.chatRequestBodies[1].messages;
    });

    await runCase("agent", "subagent instructions are injected into delegated runs", async () => {
        const fake = createFakeOpenAI({
            chatOutputs: [
                '[[[status:call_subagent:"math_helper":{"expression":"17 * 23"}]]]',
                protocol([
                    "[[[status:writing]]]",
                    "391",
                    "[[[status:done]]]",
                ]),
                protocol([
                    "[[[status:writing]]]",
                    "17 ile 23'ün çarpımı 391'dir.",
                    "[[[status:done]]]",
                ]),
            ],
        });
        const generalAI = new GeneralAI({ openai: fake });

        const result = await generalAI.agent.generate({
            endpoint: "chat_completions",
            model: TEST_MODEL,
            messages: [{ role: "user", content: "What is 17 multiplied by 23?" }],
            compatibility: {
                chatRoleMode: "classic",
            },
            safety: {
                enabled: false,
                mode: "off",
            },
            thinking: {
                enabled: false,
                strategy: "none",
            },
            subagents: {
                registry: [
                    {
                        name: "math_helper",
                        description: "Math helper.",
                        instructions: "Solve the delegated arithmetic task and do not call any subagents.",
                    },
                ],
            },
        });

        assert.match(result.cleaned, /391/);
        assert.equal(result.meta.subagentCallCount, 1);
        assert.match(fake.chatRequestBodies[1].messages[1].content, /Solve the delegated arithmetic task/i);
        return {
            cleaned: result.cleaned,
            subagentPrompt: fake.chatRequestBodies[1].messages[1].content,
        };
    });

    await runCase("agent", "retry logic recovers from malformed protocol output", async () => {
        const fake = createFakeOpenAI({
            chatOutputs: [
                '[[[status:input_safety:{"safe":true,}]]]',
                protocol([
                    "[[[status:thinking]]]",
                    "Recovered.",
                    "[[[status:writing]]]",
                    "Recovered answer.",
                    "[[[status:done]]]",
                ]),
            ],
        });
        const generalAI = new GeneralAI({ openai: fake });

        const result = await generalAI.agent.generate({
            endpoint: "chat_completions",
            model: TEST_MODEL,
            messages: [{ role: "user", content: "Hi" }],
            compatibility: {
                chatRoleMode: "classic",
            },
        });

        assert.match(result.cleaned, /Recovered answer/);
        assert.equal(result.meta.protocolErrorCount, 1);
        assert.equal(fake.chatRequestBodies.length, 2);
        return {
            cleaned: result.cleaned,
            protocolErrorCount: result.meta.protocolErrorCount,
            warnings: result.meta.warnings,
        };
    });

    await runCase("agent", "subagent runs inherit only allowed tools", async () => {
        const fake = createFakeOpenAI({
            chatOutputs: [
                '[[[status:call_subagent:"math_helper":{"expression":"17 * 23"}]]]',
                protocol([
                    "[[[status:writing]]]",
                    "391",
                    "[[[status:done]]]",
                ]),
                protocol([
                    "[[[status:writing]]]",
                    "391",
                    "[[[status:done]]]",
                ]),
            ],
        });
        const generalAI = new GeneralAI({ openai: fake });

        await generalAI.agent.generate({
            endpoint: "chat_completions",
            model: TEST_MODEL,
            messages: [{ role: "user", content: "What is 17 multiplied by 23?" }],
            compatibility: {
                chatRoleMode: "classic",
            },
            safety: {
                enabled: false,
                mode: "off",
            },
            thinking: {
                enabled: false,
                strategy: "none",
            },
            tools: {
                registry: [
                    defineTool({
                        name: "root_only",
                        description: "Should not appear in subagents.",
                        access: {
                            subagents: false,
                        },
                        async execute() {
                            return {};
                        },
                    }),
                    defineTool({
                        name: "shared_tool",
                        description: "May appear in subagents.",
                        access: {
                            subagents: true,
                        },
                        async execute() {
                            return {};
                        },
                    }),
                    defineTool({
                        name: "math_only",
                        description: "Only for math_helper.",
                        access: {
                            subagents: ["math_helper"],
                        },
                        async execute() {
                            return {};
                        },
                    }),
                ],
            },
            subagents: {
                registry: [
                    {
                        name: "math_helper",
                        description: "Math helper.",
                        instructions: "Solve the delegated arithmetic task.",
                    },
                ],
            },
        });

        const subagentPrompt = fake.chatRequestBodies[1].messages[0].content;
        assert.match(subagentPrompt, /shared_tool/);
        assert.match(subagentPrompt, /math_only/);
        assert.doesNotMatch(subagentPrompt, /root_only/);
        return subagentPrompt;
    });

    await runCase("stream", "agent.stream yields writing deltas on responses", async () => {
        const fake = createFakeOpenAI({
            responseOutputs: [
                protocol([
                    "[[[status:thinking]]]",
                    "Streaming.",
                    "[[[status:input_safety:{\"safe\":true}]]]",
                    "[[[status:writing]]]",
                    "Hello stream.",
                    "[[[status:output_safety:{\"safe\":true}]]]",
                    "[[[status:done]]]",
                ]),
            ],
        });
        const generalAI = new GeneralAI({ openai: fake });

        const events = [];
        for await (const event of generalAI.agent.stream({
            endpoint: "responses",
            model: TEST_MODEL,
            messages: [{ role: "user", content: "Hi" }],
        })) {
            events.push(event);
        }

        assert.ok(events.some((event) => event.type === "writing_delta"));
        assert.ok(events.some((event) => event.type === "run_completed"));
        return events.map((event) => event.type);
    });

    await runCase("stream", "agent.stream yields deltas on chat_completions", async () => {
        const fake = createFakeOpenAI({
            chatOutputs: [
                protocol([
                    "[[[status:thinking]]]",
                    "Streaming chat.",
                    "[[[status:writing]]]",
                    "Hello chat stream.",
                    "[[[status:done]]]",
                ]),
            ],
        });
        const generalAI = new GeneralAI({ openai: fake });

        const events = [];
        for await (const event of generalAI.agent.stream({
            endpoint: "chat_completions",
            model: TEST_MODEL,
            messages: [{ role: "user", content: "Hi" }],
            compatibility: {
                chatRoleMode: "classic",
            },
        })) {
            events.push(event);
        }

        assert.ok(events.some((event) => event.type === "writing_delta"));
        assert.ok(events.some((event) => event.type === "run_completed"));
        return events.map((event) => event.type);
    });
}

async function runLiveSuite() {
    divider("LIVE PROVIDER SMOKE TESTS");

    await runCase("live", "native chat completion returns text", async () => {
        const openai = createLiveClient();
        const generalAI = new GeneralAI({ openai });

        const nativeResult = await generalAI.native.chat.completions.create({
            model: LIVE_MODEL,
            messages: [
                {
                    role: "user",
                    content: "What is the capital of France? Answer in one short sentence.",
                },
            ],
        });

        const text = nativeResult.choices[0]?.message?.content ?? "";
        assert.ok(text.length > 0);
        return text;
    });

    await runCase("live", "agent chat generate works in classic compatibility mode", async () => {
        const openai = createLiveClient();
        const generalAI = new GeneralAI({ openai });

        const result = await generalAI.agent.generate({
            endpoint: "chat_completions",
            model: LIVE_MODEL,
            messages: [
                {
                    role: "user",
                    content: "Say hello briefly in Turkish.",
                },
            ],
            request: {
                chat_completions: {
                    temperature: 0,
                },
            },
            compatibility: {
                chatRoleMode: "classic",
            },
        });

        assert.ok(result.cleaned.trim().length > 0);
        assert.ok(result.events.length > 0);
        return {
            cleaned: result.cleaned,
            events: result.events.map((event) => event.kind),
        };
    });

    await runCase("live", "agent subagent delegation works on chat_completions", async () => {
        const openai = createLiveClient();
        const generalAI = new GeneralAI({ openai });
        const mathHelperSubagent = defineSubagent({
            name: "math_helper",
            description: "A precise arithmetic specialist for short delegated math tasks.",
            instructions: [
                "You are a math-focused subagent.",
                "Solve the delegated arithmetic task carefully.",
                "Return only the final numeric result unless the task explicitly asks for more.",
            ].join(" "),
        });

        const result = await generalAI.agent.generate({
            endpoint: "chat_completions",
            model: LIVE_MODEL,
            messages: [
                {
                    role: "system",
                    content: [
                        "Delegate the arithmetic work to the available subagent named math_helper.",
                        "Do not solve the multiplication yourself before the subagent returns.",
                        "After the subagent result arrives, answer briefly in Turkish.",
                    ].join(" "),
                },
                {
                    role: "user",
                    content: "What is 17 multiplied by 23? Keep the final answer short.",
                },
            ],
            thinking: {
                enabled: false,
                strategy: "none",
            },
            safety: {
                enabled: false,
                mode: "off",
            },
            subagents: {
                registry: [mathHelperSubagent],
            },
            limits: {
                maxSubagentCalls: 4,
            },
            request: {
                chat_completions: {
                    temperature: 0,
                },
            },
            compatibility: {
                chatRoleMode: "classic",
            },
        });

        assert.ok(result.meta.subagentCallCount >= 1);
        assert.ok(/391/.test(result.cleaned) || result.events.some((event) => event.kind === "call_subagent"));
        return {
            cleaned: result.cleaned,
            subagentCallCount: result.meta.subagentCallCount,
            events: result.events.map((event) => event.kind),
        };
    });

    await runCase("live", "agent stream produces writing deltas on chat_completions", async () => {
        const openai = createLiveClient();
        const generalAI = new GeneralAI({ openai });

        const events = [];
        for await (const event of generalAI.agent.stream({
            endpoint: "chat_completions",
            model: LIVE_MODEL,
            messages: [
                {
                    role: "user",
                    content: "Say hello very briefly in Turkish.",
                },
            ],
            request: {
                chat_completions: {
                    temperature: 0,
                },
            },
            compatibility: {
                chatRoleMode: "classic",
            },
        })) {
            events.push(event);
        }

        assert.ok(events.some((event) => event.type === "run_completed"));
        return events.map((event) => event.type);
    });
}

await runDeterministicSuite();
await runLiveSuite();
printSummary();
