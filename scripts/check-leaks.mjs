import { readFileSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const GENERIC = [
  { id: "absolute-home-path", regex: /\/(?:Users|home)\/[A-Za-z0-9._-]+\// },
  { id: "email-address", regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { id: "credential-shape", regex: /\b(?:sk|pk|ghp|gho|xox[abps])[-_][A-Za-z0-9_-]{20,}\b/ },
  { id: "private-ip", regex: /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/ },
  // Host-like only, and no bare ".local": mDNS names are rare in source, while ".local" collides
  // with ordinary filenames such as this tool's own .leakpatterns.local.
  { id: "internal-tld", regex: /(?<![\w.-])[a-z0-9][a-z0-9-]+\.(?:internal|corp|intranet)\b/i },
];

const FORBIDDEN_FILES = [/(^|\/)\.env(\.|$)/, /(^|\/)auth\.json$/, /\.pem$/, /\.p12$/, /_rsa$/];

const SELF = new Set([".leakpatterns.local", ".leakpatterns.example", "scripts/check-leaks.mjs"]);
/** A line containing this marker is skipped. Used for deliberate fixtures and documentation examples. */
const SUPPRESS = "leak-guard-allow";
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage"]);
const BINARY = /\.(png|jpe?g|gif|webp|mp4|zip|gz|ico|woff2?)$/i;

const args = process.argv.slice(2);
const dirIndex = args.indexOf("--dir");
const root = dirIndex === -1 ? process.cwd() : args[dirIndex + 1];
const strict = args.includes("--strict");

function loadLocalPatterns() {
  let contents;
  try {
    contents = readFileSync(join(root, ".leakpatterns.local"), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error(`check-leaks: could not read .leakpatterns.local (${error.code}); local patterns are NOT applied.`);
    }
    return undefined;
  }
  return contents
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((term) => ({ id: "local-pattern:<redacted>", regex: new RegExp(term, "i") }));
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...(await walk(join(dir, entry.name))));
    } else if (entry.isFile()) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

const local = loadLocalPatterns();
if (strict && !local) {
  console.error("check-leaks: strict mode requires .leakpatterns.local to be present; refusing to publish.");
  process.exit(1);
}

const patterns = [...GENERIC, ...(local ?? [])];
const findings = [];

for (const file of await walk(root)) {
  const rel = relative(root, file).split("\\").join("/");
  if (SELF.has(rel)) continue;

  if (FORBIDDEN_FILES.some((r) => r.test(rel))) {
    findings.push(`${rel}: forbidden-file`);
    continue;
  }
  if (BINARY.test(rel) || statSync(file).size > 2_000_000) continue;

  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    // Intentional fixtures (the guard's own tests, plan documents showing example findings)
    // carry this marker. Suppression is per line, so nothing else in the file is excused.
    if (line.includes(SUPPRESS)) return;
    for (const pattern of patterns) {
      if (pattern.regex.test(line)) findings.push(`${rel}:${index + 1}: ${pattern.id}`);
    }
  });
}

if (findings.length > 0) {
  console.error("check-leaks found problems:");
  for (const finding of findings) console.error(`  ${finding}`);
  process.exit(1);
}

console.log(`check-leaks: clean (${patterns.length} patterns${local ? ", local set loaded" : ", generic only"})`);
