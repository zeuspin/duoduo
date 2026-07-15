import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const ignored = new Set(["node_modules", "out", ".vite"]);
const textExtensions = new Set([".ts", ".tsx", ".js", ".cjs", ".mjs", ".json", ".md", ".html", ".css", ".yml", ".yaml"]);
const patterns = [
  /sk-[A-Za-z0-9_-]{16,}/g,
  /Bearer\s+[A-Za-z0-9._-]{20,}/g,
  /(?:api[_-]?key|token|secret)[ \t]*[=:][ \t]*["'][A-Za-z0-9][^"'\r\n]{15,}["']/gi,
];
const findings = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (textExtensions.has(extname(entry.name))) {
      const content = await readFile(path, "utf8");
      for (const pattern of patterns) if (pattern.test(content)) findings.push(relative(root, path));
    }
  }
}

await walk(root);
if (findings.length) { console.error(`Potential secrets found in: ${[...new Set(findings)].join(", ")}`); process.exit(1); }
console.log("Secret scan passed: no credential-like values found.");
