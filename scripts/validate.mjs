#!/usr/bin/env node
/**
 * Local validation without hitting Jira:
 * 1. Syntax-check every .js under src/
 * 2. If JIRA_BASE_URL is set, load config and print REST/description settings (no network).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, name.name);
    if (name.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const srcFiles = walk(path.join(root, "src")).filter((f) => f.endsWith(".js"));
let failed = false;
for (const f of srcFiles) {
  const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
  if (r.status !== 0) {
    console.error(r.stderr || `Failed: ${f}`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log(`OK: syntax check (${srcFiles.length} files under src/)`);

if (!process.env.JIRA_BASE_URL?.trim()) {
  console.log(
    "Skip config load (set JIRA_BASE_URL to validate config module without calling Jira)."
  );
  process.exit(0);
}

const { CONFIG, isJiraRestApiV2 } = await import("../src/config.js");
console.log("OK: config loaded");
console.log(
  JSON.stringify(
    {
      JIRA_BASE_URL: CONFIG.JIRA_BASE_URL,
      restApiPrefix: CONFIG.restApiPrefix,
      descriptionFormat: CONFIG.descriptionFormat,
      isJiraRestApiV2: isJiraRestApiV2(),
    },
    null,
    2
  )
);
