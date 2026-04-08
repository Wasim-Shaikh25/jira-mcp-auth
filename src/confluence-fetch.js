/**
 * Confluence attachments from the Jira MCP package: same auth rules as confluence-mcp-oauth
 * (per-instance cookie file under cookies/cf-*.json, PAT, prefer SSO when cookie file exists).
 */
import fs from "fs";
import path from "node:path";
import fetch from "node-fetch";
import { CONFIG } from "./config.js";
import { withCookieFileLockSync } from "./cookie-lock.js";

const jsonHeaders = {
  Accept: "application/json",
  "Content-Type": "application/json",
  "X-Atlassian-Token": "no-check",
};

function readCookieFileSync(filePath) {
  if (!filePath) return null;
  return withCookieFileLockSync(filePath, () => {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    const cookies = JSON.parse(raw);
    if (!Array.isArray(cookies)) return null;
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  });
}

function confluenceCookieFile() {
  const specific = CONFIG.getConfluenceAttachmentCookiePath();
  if (specific) {
    const c = readCookieFileSync(specific);
    if (c) return c;
    const legacy = path.join(CONFIG.PROJECT_ROOT, "cookies", "session.json");
    if (legacy !== specific && fs.existsSync(legacy)) {
      return readCookieFileSync(legacy);
    }
    return null;
  }
  return readCookieFileSync(CONFIG.COOKIE_FILE);
}

function confluenceBase() {
  const b = process.env.CONFLUENCE_BASE_URL?.replace(/\/$/, "").trim();
  if (!b) {
    throw new Error(
      "CONFLUENCE_BASE_URL is not set. Add it to mcp.json env for add_attachment_from_confluence."
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
  const cookie = confluenceCookieFile();
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

  if (CONFIG.preferSsoCookies && cookieHeaders) {
    const res = await fetch(url, merge(cookieHeaders));
    if (res.ok) return res;
    if (shouldRetryWithCookie(res.status)) {
      const text = await res.text();
      const cf = CONFIG.getConfluenceAttachmentCookiePath() || CONFIG.COOKIE_FILE;
      throw new Error(
        `Confluence HTTP ${res.status}: ${text.slice(0, 400)} Confluence SSO expired or not captured. Run confluence_login in the Confluence MCP, or set CONFLUENCE_PAT + PREFER_SSO_COOKIES=0, or delete ${cf}.`
      );
    }
    return res;
  }

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
    "Confluence not authenticated. Set CONFLUENCE_PAT (or CONFLUENCE_API_TOKEN), or save SSO cookies for Confluence."
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

export async function listConfluenceAttachments(pageId, limit = 100, start = 0) {
  const id = encodeURIComponent(pageId);
  const lim = Math.min(Math.max(1, limit), 100);
  const st = Math.max(0, start);
  const expand = encodeURIComponent("metadata,version");
  return requestJson(
    `/rest/api/content/${id}/child/attachment?limit=${lim}&start=${st}&expand=${expand}`
  );
}

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
