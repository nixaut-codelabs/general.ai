import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const rootDir = resolve(dirname(currentFile), "..");
const sourceDir = resolve(rootDir, "prompts");
const targetDir = resolve(rootDir, "dist", "prompts");

await mkdir(targetDir, { recursive: true });
await cp(sourceDir, targetDir, { recursive: true });
