import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PROMPT_SECTION_ORDER, PROMPT_SECTION_TITLES, } from "./defaults.js";
const PROMPT_FILES = {
    identity: "identity.txt",
    endpoint_responses: "endpoint-responses.txt",
    endpoint_chat_completions: "endpoint-chat-completions.txt",
    protocol: "protocol.txt",
    safety: "safety.txt",
    personality: "personality.txt",
    thinking: "thinking.txt",
    tools_subagents: "tools-subagents.txt",
    memory: "memory.txt",
    task: "task.txt",
};
const bundledPromptDir = fileURLToPath(new URL("./prompts/", import.meta.url));
let bundledPromptCache;
async function fileExists(path) {
    try {
        await access(path);
        return true;
    }
    catch {
        return false;
    }
}
async function readPromptFile(path) {
    return await readFile(path, "utf8");
}
async function loadBundledPromptTemplates() {
    bundledPromptCache ??= (async () => {
        const entries = await Promise.all(PROMPT_SECTION_ORDER.map(async (key) => {
            const file = resolve(bundledPromptDir, PROMPT_FILES[key]);
            return [key, await readPromptFile(file)];
        }));
        return Object.fromEntries(entries);
    })();
    return await bundledPromptCache;
}
async function loadPromptPackTemplates(promptPack) {
    if (!promptPack?.rootDir) {
        return promptPack?.sections ?? {};
    }
    const entries = await Promise.all(PROMPT_SECTION_ORDER.map(async (key) => {
        const filePath = resolve(promptPack.rootDir, PROMPT_FILES[key]);
        if (!(await fileExists(filePath))) {
            return [key, undefined];
        }
        return [key, await readPromptFile(filePath)];
    }));
    return {
        ...Object.fromEntries(entries),
        ...promptPack.sections,
    };
}
function applyPlaceholders(template, context) {
    return template
        .replace(/\{data:([a-zA-Z0-9_.-]+)\}/g, (_match, key) => {
        const value = context.data[key];
        return value === undefined || value === null ? "" : String(value);
    })
        .replace(/\{block:([a-zA-Z0-9_.-]+)\}/g, (_match, key) => {
        return context.blocks[key] ?? "";
    })
        .trim();
}
export async function renderPromptSections(options) {
    const bundled = await loadBundledPromptTemplates();
    const fromPack = await loadPromptPackTemplates(options.promptPack);
    const mergedTemplates = {
        ...bundled,
        ...fromPack,
        ...options.constructorOverrides?.sections,
        ...options.runtimeOverrides?.sections,
    };
    const context = {
        data: {
            ...options.constructorOverrides?.data,
            ...options.runtimeOverrides?.data,
            ...options.context.data,
        },
        blocks: {
            ...options.constructorOverrides?.blocks,
            ...options.runtimeOverrides?.blocks,
            ...options.context.blocks,
        },
    };
    const sections = [];
    for (const key of PROMPT_SECTION_ORDER) {
        const template = mergedTemplates[key];
        if (!template) {
            continue;
        }
        const text = applyPlaceholders(template, context);
        if (!text) {
            continue;
        }
        sections.push({
            key,
            title: PROMPT_SECTION_TITLES[key],
            text,
        });
    }
    let fullPrompt = sections
        .map((section) => `## ${section.title}\n${section.text}`)
        .join("\n\n");
    const raw = {
        ...options.constructorOverrides?.raw,
        ...options.runtimeOverrides?.raw,
    };
    if (raw.replace) {
        fullPrompt = applyPlaceholders(raw.replace, context);
    }
    if (raw.prepend) {
        fullPrompt = `${applyPlaceholders(raw.prepend, context)}\n\n${fullPrompt}`.trim();
    }
    if (raw.append) {
        fullPrompt = `${fullPrompt}\n\n${applyPlaceholders(raw.append, context)}`.trim();
    }
    return {
        sections,
        fullPrompt,
    };
}
//# sourceMappingURL=prompts.js.map