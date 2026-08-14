import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = (await readdir(dir)).filter((name) => name.endsWith(".test.ts")).sort();
for (const file of files) {
  await import(pathToFileURL(path.join(dir, file)).href);
}
console.log(`\n${files.length} test files passed`);
