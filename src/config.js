import fs from "fs";
import os from "node:os";
import path from "path";
import { fileURLToPath } from "url";
import { descriptionFormatFromEnv, isRestApiV2Prefix } from "./jira-rest.js";
import { findMcpServerEnvForEntryScript } from "./mcp-server-discovery.js";
import {
  resolveConfluenceCookiePath,
  resolveJiraCookiePath,
  resolveJiraBoardsCachePath,
} from "./session-path.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const ENTRY_SCRIPT = path.join(PROJECT_ROOT, "src", "index.js");

/** PATs must come only from Cursor MCP config (mcp.json), not from a project .env file. */
const mcpServerEntry = findMcpServerEnvForEntryScript(ENTRY_SCRIPT);

function loadEnvFile() {
  const envPath = path.join(PROJECT_ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

/**
 * Merge from discovered mcp.json block. Does not overwrite keys Cursor already injected.
 */
function applyJiraMcpEnvFromUserConfig() {
  const env = mcpServerEntry?.env;
  if (!env || typeof env !== "object") return;
  for (const [key, val] of Object.entries(env)) {
    if (typeof val === "string" && process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

loadEnvFile();
applyJiraMcpEnvFromUserConfig();

const baseRaw = process.env.JIRA_BASE_URL?.replace(/\/$/, "").trim();
if (!baseRaw) {
  throw new Error(
    "JIRA_BASE_URL is not set. Add it under your Cursor MCP server env in %USERPROFILE%\\.cursor\\mcp.json (the entry whose args point to this project's src/index.js), then restart Cursor."
  );
}

const loginDefault = `${baseRaw}/login.jsp`;

const restApiPrefix = (process.env.JIRA_REST_API_PREFIX || "/rest/api/3").replace(/\/$/, "");

const jiraCookieFile = resolveJiraCookiePath(PROJECT_ROOT, baseRaw, process.env.JIRA_MCP_SERVER_KEY);

export function isJiraRestApiV2() {
  return isRestApiV2Prefix(restApiPrefix);
}

export function resolveJiraDescriptionFormat() {
  const fmt = descriptionFormatFromEnv(process.env.JIRA_DESCRIPTION_FORMAT, restApiPrefix);
  if (fmt !== null) return fmt;
  console.error(
    `JIRA_DESCRIPTION_FORMAT="${process.env.JIRA_DESCRIPTION_FORMAT}" is invalid; use auto|adf|plain. Falling back to auto.`
  );
  return isRestApiV2Prefix(restApiPrefix) ? "plain" : "adf";
}

export const CONFIG = {
  JIRA_BASE_URL: baseRaw,
  restApiPrefix,
  descriptionFormat: resolveJiraDescriptionFormat(),
  isJiraRestApiV2,
  LOGIN_URL: process.env.JIRA_LOGIN_URL || loginDefault,
  COOKIE_FILE: jiraCookieFile,
  BOARDS_CACHE_FILE: resolveJiraBoardsCachePath(
    PROJECT_ROOT,
    baseRaw,
    process.env.JIRA_MCP_SERVER_KEY
  ),
  LOGIN_WAIT_MS: Math.max(
    30_000,
    (parseInt(process.env.JIRA_LOGIN_WAIT_SECONDS || "90", 10) || 90) * 1000
  ),
  LOGIN_POLL_MS: Math.max(500, parseInt(process.env.JIRA_LOGIN_POLL_MS || "2000", 10) || 2000),
  PROJECT_ROOT,
  mcpServerKey: mcpServerEntry?.key ?? null,
  /** Cookie file for Confluence REST when using add_attachment_from_confluence (separate from Jira cookies). */
  getConfluenceAttachmentCookiePath() {
    const b = process.env.CONFLUENCE_BASE_URL?.replace(/\/$/, "").trim();
    if (!b) return null;
    return resolveConfluenceCookiePath(PROJECT_ROOT, b, process.env.CONFLUENCE_MCP_SERVER_KEY);
  },
  maxAttachmentBytes: (() => {
    const raw = parseInt(process.env.JIRA_MAX_ATTACHMENT_BYTES || "10485760", 10);
    const n = Number.isFinite(raw) ? raw : 10_485_760;
    return Math.min(50 * 1024 * 1024, Math.max(256 * 1024, n));
  })(),
};
