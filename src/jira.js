import fs from "fs";
import fetch from "node-fetch";
import { CONFIG } from "./config.js";
import { adfToPlainText, plainTextToAdf } from "./adf.js";
import { fetchConfluenceAttachmentByFilename } from "./confluence-fetch.js";

function loadCookieHeader() {
  if (!fs.existsSync(CONFIG.COOKIE_FILE)) return null;
  const raw = fs.readFileSync(CONFIG.COOKIE_FILE, "utf8");
  const cookies = JSON.parse(raw);
  if (!Array.isArray(cookies)) {
    throw new Error(
      "Invalid cookie file; delete cookies/session.json and run jira_login again."
    );
  }
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

const jsonHeaders = {
  Accept: "application/json",
  "Content-Type": "application/json",
  "X-Atlassian-Token": "no-check",
};

function authHeadersForCookie() {
  const cookie = loadCookieHeader();
  if (!cookie) return null;
  return { Cookie: cookie };
}

function authHeadersForPat() {
  const pat = CONFIG.getPatToken();
  if (!pat) return null;
  return { Authorization: `Bearer ${pat}` };
}

function shouldRetryWithCookie(status) {
  return status === 401 || status === 403;
}

/**
 * PAT first (if set), then SSO session cookies on 401/403.
 * If only cookies exist, uses cookies only.
 */
async function fetchWithAuth(url, init = {}) {
  const patHeaders = authHeadersForPat();
  const cookieHeaders = authHeadersForCookie();

  const merge = (extra) => ({
    ...init,
    headers: {
      ...init.headers,
      ...extra,
    },
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
    "Not authenticated. Set JIRA_PAT (or JIRA_API_TOKEN), or run jira_login once to save cookies."
  );
}

async function parseResponse(res) {
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Jira HTTP ${res.status}: ${text.slice(0, 800)}`);
  }
  if (!text || !text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON from Jira; got: ${text.slice(0, 200)}`);
  }
}

/** @param {string} pathAndQuery */
export async function requestJson(pathAndQuery) {
  const url = `${CONFIG.JIRA_BASE_URL}${pathAndQuery}`;
  const res = await fetchWithAuth(url, {
    headers: { ...jsonHeaders },
  });
  return parseResponse(res);
}

/** @param {string} method @param {string} pathAndQuery @param {unknown} [body] */
export async function requestJsonWithBody(method, pathAndQuery, body) {
  const url = `${CONFIG.JIRA_BASE_URL}${pathAndQuery}`;
  const res = await fetchWithAuth(url, {
    method,
    headers: { ...jsonHeaders },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  return parseResponse(res);
}

/** @param {string} pathAndQuery */
export async function requestDelete(pathAndQuery) {
  const url = `${CONFIG.JIRA_BASE_URL}${pathAndQuery}`;
  const res = await fetchWithAuth(url, {
    method: "DELETE",
    headers: { ...jsonHeaders },
  });
  if (res.status === 204) return { deleted: true };
  return parseResponse(res);
}

const ISSUE_FIELDS_FULL = [
  "summary",
  "description",
  "status",
  "assignee",
  "reporter",
  "issuetype",
  "priority",
  "labels",
  "parent",
  "subtasks",
  "created",
  "updated",
  "project",
].join(",");

/**
 * @param {string} jql
 * @param {number} maxResults
 */
export async function executeJql(jql, maxResults = 10) {
  const mr = Math.min(Math.max(1, maxResults), 100);
  return requestJsonWithBody("POST", `${CONFIG.restApiPrefix}/search`, {
    jql,
    maxResults: mr,
    fields: ["summary", "status", "assignee", "issuetype", "priority", "created", "updated"],
  });
}

/**
 * @param {string} issueIdOrKey
 */
export async function getTicket(issueIdOrKey) {
  const key = encodeURIComponent(issueIdOrKey);
  return requestJson(
    `${CONFIG.restApiPrefix}/issue/${key}?expand=renderedFields,names&fields=${encodeURIComponent(ISSUE_FIELDS_FULL)}`
  );
}

/**
 * @param {string} issueIdOrKey
 */
export async function readTicket(issueIdOrKey) {
  const issue = await getTicket(issueIdOrKey);
  const f = issue?.fields ?? {};
  const desc = f.description;
  const descText =
    typeof desc === "string" ? desc : adfToPlainText(/** @type {unknown} */ (desc));
  return {
    key: issue?.key,
    id: issue?.id,
    self: issue?.self,
    summary: f.summary,
    description: descText,
    status: f.status?.name,
    assignee: f.assignee?.displayName ?? f.assignee?.emailAddress,
    issuetype: f.issuetype?.name,
    priority: f.priority?.name,
    labels: f.labels,
    parent: f.parent?.key,
    created: f.created,
    updated: f.updated,
    renderedDescription: issue?.renderedFields?.description ?? null,
  };
}

/**
 * @param {string} issueIdOrKey
 */
export async function getOnlyTicketNameAndDescription(issueIdOrKey) {
  const key = encodeURIComponent(issueIdOrKey);
  const issue = await requestJson(
    `${CONFIG.restApiPrefix}/issue/${key}?fields=summary,description`
  );
  const f = issue?.fields ?? {};
  const desc = f.description;
  const descText =
    typeof desc === "string" ? desc : adfToPlainText(/** @type {unknown} */ (desc));
  return { summary: f.summary, description: descText };
}

/**
 * @param {{ project: string; summary: string; description: string; issuetype: string; parent?: string }} p
 */
export async function createTicket(p) {
  const fields = {
    project: { key: p.project },
    summary: p.summary,
    description: plainTextToAdf(p.description),
    issuetype: { name: p.issuetype },
  };
  if (p.parent) {
    fields.parent = { key: p.parent };
  }
  return requestJsonWithBody("POST", `${CONFIG.restApiPrefix}/issue`, { fields });
}

/**
 * @param {{ issueIdOrKey: string; summary?: string; description?: string; labels?: string[]; parent?: string }} p
 */
export async function editTicket(p) {
  const key = encodeURIComponent(p.issueIdOrKey);
  const fields = {};
  if (p.summary != null) fields.summary = p.summary;
  if (p.description != null) fields.description = plainTextToAdf(p.description);
  if (p.labels != null) fields.labels = p.labels;
  if (p.parent != null) fields.parent = { key: p.parent };
  if (Object.keys(fields).length === 0) {
    throw new Error("edit_ticket: provide at least one of summary, description, labels, parent.");
  }
  return requestJsonWithBody("PUT", `${CONFIG.restApiPrefix}/issue/${key}`, { fields });
}

/**
 * @param {string} issueIdOrKey
 */
export async function deleteTicket(issueIdOrKey) {
  const key = encodeURIComponent(issueIdOrKey);
  return requestDelete(`${CONFIG.restApiPrefix}/issue/${key}`);
}

/**
 * @param {number} maxResults
 */
export async function listProjects(maxResults = 50) {
  const mr = Math.min(Math.max(1, maxResults), 100);
  return requestJson(`${CONFIG.restApiPrefix}/project/search?maxResults=${mr}`);
}

/**
 * @param {string} issueIdOrKey
 * @param {string} accountId
 */
export async function assignTicket(issueIdOrKey, accountId) {
  const key = encodeURIComponent(issueIdOrKey);
  return requestJsonWithBody("PUT", `${CONFIG.restApiPrefix}/issue/${key}/assignee`, {
    accountId,
  });
}

/**
 * @param {string} projectKey
 */
export async function queryAssignable(projectKey) {
  const pk = encodeURIComponent(projectKey);
  return requestJson(`${CONFIG.restApiPrefix}/user/assignable/search?project=${pk}&maxResults=100`);
}

/**
 * @param {number} maxResults
 */
export async function getAllStatuses(maxResults = 50) {
  void maxResults;
  return requestJson(`${CONFIG.restApiPrefix}/status`);
}

/**
 * @param {string} issueIdOrKey
 * @param {string} filename
 * @param {Buffer} buffer
 * @param {string} contentType
 */
export async function addAttachment(issueIdOrKey, filename, buffer, contentType) {
  if (buffer.length > CONFIG.maxAttachmentBytes) {
    throw new Error(`File too large (${buffer.length} bytes). Max is ${CONFIG.maxAttachmentBytes}.`);
  }
  const key = encodeURIComponent(issueIdOrKey);
  const url = `${CONFIG.JIRA_BASE_URL}${CONFIG.restApiPrefix}/issue/${key}/attachments`;

  const patHeaders = authHeadersForPat();
  const cookieHeaders = authHeadersForCookie();
  const baseHeaders = { "X-Atlassian-Token": "no-check", Accept: "application/json" };

  const form = new FormData();
  const blob = new Blob([buffer], { type: contentType || "application/octet-stream" });
  form.append("file", blob, filename);

  async function post(extra) {
    return fetch(url, {
      method: "POST",
      headers: { ...baseHeaders, ...extra },
      body: form,
    });
  }

  let res;
  if (patHeaders) {
    res = await post(patHeaders);
    if (!res.ok && cookieHeaders && shouldRetryWithCookie(res.status)) {
      const form2 = new FormData();
      const blob2 = new Blob([buffer], { type: contentType || "application/octet-stream" });
      form2.append("file", blob2, filename);
      res = await fetch(url, {
        method: "POST",
        headers: { ...baseHeaders, ...cookieHeaders },
        body: form2,
      });
    }
  } else if (cookieHeaders) {
    res = await post(cookieHeaders);
  } else {
    throw new Error("Not authenticated for attachment upload.");
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Jira HTTP ${res.status}: ${text.slice(0, 800)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

/**
 * @param {string} issueIdOrKey
 * @param {string} pageId
 * @param {string} attachmentName
 */
export async function addAttachmentFromConfluence(issueIdOrKey, pageId, attachmentName) {
  const { buffer, contentType } = await fetchConfluenceAttachmentByFilename(pageId, attachmentName);
  return addAttachment(issueIdOrKey, attachmentName, buffer, contentType);
}

/**
 * @param {string} issueIdOrKey
 * @param {string} imageUrl
 */
export async function addAttachmentFromPublicUrl(issueIdOrKey, imageUrl) {
  const res = await fetch(imageUrl, { headers: { Accept: "*/*" } });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Failed to fetch URL HTTP ${res.status}: ${t.slice(0, 400)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > CONFIG.maxAttachmentBytes) {
    throw new Error(`Downloaded file too large (${buf.length} bytes).`);
  }
  const contentType = res.headers.get("content-type") || "application/octet-stream";
  let filename = "attachment";
  try {
    const u = new URL(imageUrl);
    const last = u.pathname.split("/").filter(Boolean).pop();
    if (last) filename = last.split("?")[0] || filename;
  } catch {
    // ignore
  }
  return addAttachment(issueIdOrKey, filename, buf, contentType);
}
