/**
 * Fetch Confluence attachments: same auth order as confluence-mcp-oauth
 * (PAT first if set, else cookies; retry with cookies on 401/403 after PAT).
 * Env: CONFLUENCE_BASE_URL + CONFLUENCE_PAT from mcpServers.jira-sso.env (or shared cookies/session.json).
 */
import fs from "fs";
import fetch from "node-fetch";
import { CONFIG } from "./config.js";

const jsonHeaders = {
  Accept: "application/json",
  "Content-Type": "application/json",
  "X-Atlassian-Token": "no-check",
};

function loadCookieHeader(cookieFile) {
  if (!fs.existsSync(cookieFile)) return null;
  const raw = fs.readFileSync(cookieFile, "utf8");
  const cookies = JSON.parse(raw);
  if (!Array.isArray(cookies)) return null;
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

function confluenceBase() {
  const b = process.env.CONFLUENCE_BASE_URL?.replace(/\/$/, "").trim();
  if (!b) {
    throw new Error(
      "CONFLUENCE_BASE_URL is not set. Add it to mcpServers.jira-sso.env for add_attachment_from_confluence."
    );
  }
  return b;
}

function authHeadersForPat() {
  const pat = CONFIG.getConfluencePatToken();
  if (!pat) return null;
  return { Authorization: `Bearer ${pat}` };
}

function authHeadersForCookie() {
  const cookie = loadCookieHeader(CONFIG.COOKIE_FILE);
  if (!cookie) return null;
  return { Cookie: cookie };
}

function shouldRetryWithCookie(status) {
  return status === 401 || status === 403;
}

async function fetchWithAuth(url, init = {}) {
  const patHeaders = authHeadersForPat();
  const cookieHeaders = authHeadersForCookie();
  const merge = (extra) => ({
    ...init,
    headers: { ...init.headers, ...extra },
  });

  if (patHeaders) {
    const res = await fetch(url, merge(patHeaders));
    if (res.ok || !cookieHeaders || !shouldRetryWithCookie(res.status)) {
      return res;
    }
    return fetch(url, merge(cookieHeaders));
  }
  if (cookieHeaders) {
    return fetch(url, merge(cookieHeaders));
  }
  throw new Error(
    "Confluence not authenticated. Set CONFLUENCE_PAT (or CONFLUENCE_API_TOKEN), or run jira_login once to save cookies."
  );
}

async function parseJson(res) {
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Confluence HTTP ${res.status}: ${text.slice(0, 800)}`);
  }
  if (!text?.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON from Confluence; got: ${text.slice(0, 200)}`);
  }
}

async function requestJson(pathAndQuery) {
  const url = `${confluenceBase()}${pathAndQuery}`;
  const res = await fetchWithAuth(url, { headers: { ...jsonHeaders } });
  return parseJson(res);
}

/** @param {string} downloadPath */
async function requestBinary(downloadPath) {
  const url = /^https?:\/\//i.test(downloadPath)
    ? downloadPath
    : `${confluenceBase()}${downloadPath.startsWith("/") ? downloadPath : `/${downloadPath}`}`;
  const res = await fetchWithAuth(url, { headers: { Accept: "*/*" } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Confluence HTTP ${res.status}: ${text.slice(0, 800)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > CONFIG.maxAttachmentBytes) {
    throw new Error(`Attachment too large (${buf.length} bytes).`);
  }
  const contentType = res.headers.get("content-type") || "application/octet-stream";
  return { buffer: buf, contentType };
}

/**
 * @param {string} pageId
 * @param {number} limit
 * @param {number} start
 */
export async function listConfluenceAttachments(pageId, limit = 100, start = 0) {
  const id = encodeURIComponent(pageId);
  const lim = Math.min(Math.max(1, limit), 100);
  const st = Math.max(0, start);
  const expand = encodeURIComponent("metadata,version");
  return requestJson(
    `/rest/api/content/${id}/child/attachment?limit=${lim}&start=${st}&expand=${expand}`
  );
}

/**
 * @param {string} pageId
 * @param {string} filename
 */
export async function fetchConfluenceAttachmentByFilename(pageId, filename) {
  const data = await listConfluenceAttachments(pageId, 100, 0);
  const results = data?.results ?? [];
  const want = filename.trim().toLowerCase();
  const hit = results.find(
    (r) => (r.title || "").toLowerCase() === want || (r.title || "") === filename
  );
  if (!hit) {
    const names = results.map((r) => r.title).filter(Boolean);
    throw new Error(
      `Confluence attachment not found: "${filename}". Known on page: ${names.slice(0, 20).join(", ") || "(none)"}`
    );
  }
  let link = hit._links?.download;
  if (!link && hit.title) {
    const enc = encodeURIComponent(hit.title);
    link = `/download/attachments/${encodeURIComponent(pageId)}/${enc}`;
  }
  if (!link) {
    throw new Error("Attachment has no download link in API response.");
  }
  const rel = link.startsWith("http") ? new URL(link).pathname + new URL(link).search : link;
  return requestBinary(rel);
}
