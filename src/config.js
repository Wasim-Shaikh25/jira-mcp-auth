import fs from "fs";
import os from "node:os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

/** PATs must come only from Cursor MCP config (mcp.json), not from a project .env file. */
const PAT_ENV_KEYS = new Set([
  "JIRA_PAT",
  "JIRA_API_TOKEN",
  "CONFLUENCE_PAT",
  "CONFLUENCE_API_TOKEN",
]);

const MCP_SERVER_KEY = "jira-sso";

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
    if (PAT_ENV_KEYS.has(key)) continue;
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

/**
 * Single source of truth for Jira URLs/timeouts: %USERPROFILE%\.cursor\mcp.json
 * under mcpServers["jira-sso"].env — same values Cursor injects when it starts the MCP server.
 * Applied after .env so `npm run login` matches MCP without duplicating URLs in .env.
 */
function applyJiraMcpEnvFromUserConfig() {
  const mcpPath = path.join(os.homedir(), ".cursor", "mcp.json");
  if (!fs.existsSync(mcpPath)) return;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
  } catch {
    return;
  }
  const env = data?.mcpServers?.[MCP_SERVER_KEY]?.env;
  if (!env || typeof env !== "object") return;
  for (const [key, val] of Object.entries(env)) {
    if (typeof val === "string") process.env[key] = val;
  }
}

/**
 * Personal Access Token: read only from %USERPROFILE%\.cursor\mcp.json →
 * mcpServers["jira-sso"].env (never from .env or generic process.env).
 */
function readPatFromMcpConfigOnly() {
  const mcpPath = path.join(os.homedir(), ".cursor", "mcp.json");
  if (!fs.existsSync(mcpPath)) return "";
  let data;
  try {
    data = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
  } catch {
    return "";
  }
  const env = data?.mcpServers?.[MCP_SERVER_KEY]?.env;
  if (!env || typeof env !== "object") return "";
  const p =
    (typeof env.JIRA_PAT === "string" && env.JIRA_PAT.trim()) ||
    (typeof env.JIRA_API_TOKEN === "string" && env.JIRA_API_TOKEN.trim()) ||
    "";
  return p;
}

/**
 * Optional Confluence PAT for add_attachment_from_confluence — same mcp.json block only.
 */
function readConfluencePatFromMcpConfigOnly() {
  const mcpPath = path.join(os.homedir(), ".cursor", "mcp.json");
  if (!fs.existsSync(mcpPath)) return "";
  let data;
  try {
    data = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
  } catch {
    return "";
  }
  const env = data?.mcpServers?.[MCP_SERVER_KEY]?.env;
  if (!env || typeof env !== "object") return "";
  const p =
    (typeof env.CONFLUENCE_PAT === "string" && env.CONFLUENCE_PAT.trim()) ||
    (typeof env.CONFLUENCE_API_TOKEN === "string" && env.CONFLUENCE_API_TOKEN.trim()) ||
    "";
  return p;
}

loadEnvFile();
applyJiraMcpEnvFromUserConfig();

const baseRaw = process.env.JIRA_BASE_URL?.replace(/\/$/, "").trim();
if (!baseRaw) {
  throw new Error(
    `JIRA_BASE_URL is not set. Add it under mcpServers.${MCP_SERVER_KEY}.env in your Cursor MCP config (%USERPROFILE%\\.cursor\\mcp.json).`
  );
}

const loginDefault = `${baseRaw}/login.jsp`;

/** Jira Cloud uses /rest/api/3; many Data Center installs only expose /rest/api/2. */
const restApiPrefix = (process.env.JIRA_REST_API_PREFIX || "/rest/api/3").replace(/\/$/, "");

export const CONFIG = {
  MCP_SERVER_KEY,
  JIRA_BASE_URL: baseRaw,
  /** e.g. /rest/api/2 or /rest/api/3 — set JIRA_REST_API_PREFIX in MCP env if search returns 404 HTML. */
  restApiPrefix,
  LOGIN_URL: process.env.JIRA_LOGIN_URL || loginDefault,
  COOKIE_FILE: path.join(PROJECT_ROOT, "cookies", "session.json"),
  LOGIN_WAIT_MS: Math.max(
    30_000,
    (parseInt(process.env.JIRA_LOGIN_WAIT_SECONDS || "90", 10) || 90) * 1000
  ),
  PROJECT_ROOT,
  /** Returns Jira PAT if set in mcp.json only (Bearer for Jira Data Center REST). */
  getPatToken: readPatFromMcpConfigOnly,
  hasPat: () => Boolean(readPatFromMcpConfigOnly()),
  getConfluencePatToken: readConfluencePatFromMcpConfigOnly,
  maxAttachmentBytes: (() => {
    const raw = parseInt(process.env.JIRA_MAX_ATTACHMENT_BYTES || "10485760", 10);
    const n = Number.isFinite(raw) ? raw : 10_485_760;
    return Math.min(50 * 1024 * 1024, Math.max(256 * 1024, n));
  })(),
};
