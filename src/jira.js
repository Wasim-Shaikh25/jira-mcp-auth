import fs from "fs";
import path from "node:path";
import fetch from "node-fetch";
import { CONFIG } from "./config.js";
import { withCookieFileLockSync } from "./cookie-lock.js";
import { adfToPlainText } from "./adf.js";
import { issueDescriptionPayload } from "./issue-description.js";
import { listProjectsPathAndQuery } from "./jira-rest.js";
import {
  filterBoardsByName,
  getBoardValues,
  uniqueProjectKeysFromBoards,
} from "./jira-boards.js";
import { fetchConfluenceAttachmentByFilename } from "./confluence-fetch.js";

function readCookieFileSync(filePath) {
  return withCookieFileLockSync(filePath, () => {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    const cookies = JSON.parse(raw);
    if (!Array.isArray(cookies)) {
      throw new Error(`Invalid cookie file; delete ${filePath} and run jira_login again.`);
    }
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  });
}

function loadCookieHeader() {
  const primary = readCookieFileSync(CONFIG.COOKIE_FILE);
  if (primary) return primary;
  const legacy = path.join(CONFIG.PROJECT_ROOT, "cookies", "session.json");
  if (legacy !== CONFIG.COOKIE_FILE && fs.existsSync(legacy)) {
    return readCookieFileSync(legacy);
  }
  return null;
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
 * Default: SSO cookies on disk → use only cookies (no PAT). Set PREFER_SSO_COOKIES=0 for PAT-first.
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

  if (CONFIG.preferSsoCookies && cookieHeaders) {
    const res = await fetch(url, merge(cookieHeaders));
    if (res.ok) return res;
    if (shouldRetryWithCookie(res.status)) {
      const text = await res.text();
      throw new Error(
        `Jira HTTP ${res.status}: ${text.slice(0, 400)} SSO session expired, rejected, or never captured (browser automation/IdP). Run jira_login again, or set JIRA_PAT + PREFER_SSO_COOKIES=0 in mcp.json, or delete ${CONFIG.COOKIE_FILE} to use PAT.`
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
    "Not authenticated. Set JIRA_PAT (or JIRA_API_TOKEN), or run jira_login once to save cookies."
  );
}

function hintForJiraStatus(status) {
  if (status === 401) {
    return " Unauthorized: run jira_login, or set JIRA_PAT and PREFER_SSO_COOKIES=0 (stale cookies/session-*.json can block PAT until deleted).";
  }
  if (status === 403) {
    return " Forbidden: authenticated but missing permission for this operation.";
  }
  if (status === 400) {
    return " Bad request: check project key, issue type, and description format (v2 needs plain string; v3 uses ADF — see JIRA_DESCRIPTION_FORMAT).";
  }
  return "";
}

async function parseResponse(res) {
  const text = await res.text();
  if (!res.ok) {
    const hint = hintForJiraStatus(res.status);
    throw new Error(`Jira HTTP ${res.status}: ${text.slice(0, 800)}${hint}`);
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

/** Jira Software Agile REST (`/rest/agile/1.0/...`), same auth as core REST. */
export async function requestAgileJson(pathAndQuery) {
  const url = `${CONFIG.JIRA_BASE_URL}${pathAndQuery}`;
  const res = await fetchWithAuth(url, {
    headers: { ...jsonHeaders },
  });
  return parseResponse(res);
}

/**
 * Resolve project key for create: explicit project → JIRA_DEFAULT_PROJECT → boardId → boardName → single board project → error with list.
 * @param {{ project?: string; boardName?: string; boardId?: string | number }} p
 */
export async function resolveProjectKeyForCreate(p) {
  const explicit = p.project && String(p.project).trim();
  if (explicit) {
    console.error(`[jira-mcp] create_ticket: using explicit project key "${explicit}".`);
    return explicit;
  }

  const envDefault = process.env.JIRA_DEFAULT_PROJECT?.trim();
  if (envDefault) {
    console.error(`[jira-mcp] create_ticket: using JIRA_DEFAULT_PROJECT="${envDefault}".`);
    return envDefault;
  }

  let boardsPayload;
  try {
    boardsPayload = await requestAgileJson(`/rest/agile/1.0/board?maxResults=50`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `create_ticket: could not load boards (Jira Software Agile API). ${msg}\n` +
        `Pass **project** (project key), **boardName**, or **boardId**, or set **JIRA_DEFAULT_PROJECT** in MCP env. If this site has no Software boards, **project** is required.`
    );
  }

  const boards = getBoardValues(boardsPayload);
  if (boards.length === 0) {
    throw new Error(
      `create_ticket: no boards returned and no **project** provided. Pass **project**, **boardName**, or **boardId**, or set **JIRA_DEFAULT_PROJECT**.`
    );
  }

  if (p.boardId != null && String(p.boardId).trim() !== "") {
    const id = String(p.boardId).trim();
    let board = boards.find((b) => String(b.id) === id) ?? null;
    if (!board) {
      try {
        board = await requestAgileJson(`/rest/agile/1.0/board/${encodeURIComponent(id)}`);
      } catch {
        board = null;
      }
    }
    const key = board?.location?.projectKey;
    if (key) {
      console.error(
        `[jira-mcp] create_ticket: resolved project "${key}" from board id ${id} (${board.name ?? "?"}).`
      );
      return key;
    }
    throw new Error(
      `create_ticket: could not resolve project from boardId "${id}". Pass **project** or use **list_boards**.`
    );
  }

  if (p.boardName != null && String(p.boardName).trim() !== "") {
    const matches = filterBoardsByName(boards, String(p.boardName));
    if (matches.length === 1) {
      const key = matches[0].location?.projectKey;
      if (key) {
        console.error(
          `[jira-mcp] create_ticket: resolved project "${key}" from board name "${matches[0].name}".`
        );
        return key;
      }
    }
    if (matches.length > 1) {
      const lines = matches
        .map((m) => `- "${m.name}" (board id=${m.id}, project=${m.location?.projectKey ?? "?"})`)
        .join("\n");
      throw new Error(
        `create_ticket: multiple boards match boardName "${p.boardName}". Pass a more specific **boardName**, **boardId**, or **project**.\n${lines}`
      );
    }
    throw new Error(
      `create_ticket: no board matched boardName "${p.boardName}". Use **list_boards**, or pass **project** (project key).`
    );
  }

  const unique = uniqueProjectKeysFromBoards(boards);
  if (unique.length === 1) {
    console.error(
      `[jira-mcp] create_ticket: auto-selected project "${unique[0]}" (only one project among accessible boards).`
    );
    return unique[0];
  }
  if (unique.length === 0) {
    throw new Error(
      `create_ticket: boards list had no project keys. Pass **project** explicitly or set **JIRA_DEFAULT_PROJECT**.`
    );
  }

  const lines = boards
    .filter((b) => b.location?.projectKey)
    .slice(0, 30)
    .map((b) => `- Board "${b.name}" (id=${b.id}) → project **${b.location.projectKey}**`)
    .join("\n");
  throw new Error(
    `create_ticket: multiple projects on your boards — choose one.\n` +
      `Pass **project** (project key), **boardName**, or **boardId**, or set env **JIRA_DEFAULT_PROJECT**.\n` +
      `Tip: run **list_boards**.\n` +
      (lines ? `Boards:\n${lines}\n` : "")
  );
}

/**
 * List Jira Software boards (Agile API). Use to pick boardName / boardId for create_ticket.
 * @param {number} [maxResults]
 */
export async function listBoards(maxResults = 50) {
  const mr = Math.min(Math.max(1, maxResults), 50);
  return requestAgileJson(`/rest/agile/1.0/board?maxResults=${mr}`);
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
 * @param {{ project?: string; boardName?: string; boardId?: string | number; summary: string; description: string; issuetype: string; parent?: string }} p
 */
export async function createTicket(p) {
  const projectKey = await resolveProjectKeyForCreate({
    project: p.project,
    boardName: p.boardName,
    boardId: p.boardId,
  });
  console.error(
    `[jira-mcp] create_ticket: POST issue project=${projectKey} issuetype=${p.issuetype} summary=${JSON.stringify(p.summary).slice(0, 80)}`
  );
  const fields = {
    project: { key: projectKey },
    summary: p.summary,
    description: issueDescriptionPayload(p.description, CONFIG.descriptionFormat),
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
  if (p.description != null) fields.description = issueDescriptionPayload(p.description, CONFIG.descriptionFormat);
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
  const { pathAndQuery, mode } = listProjectsPathAndQuery(CONFIG.restApiPrefix, mr);
  if (mode === "v2-array") {
    const all = await requestJson(pathAndQuery);
    const arr = Array.isArray(all) ? all : [];
    const values = arr.slice(0, mr);
    return {
      startAt: 0,
      maxResults: mr,
      total: arr.length,
      isLast: arr.length <= mr,
      values,
    };
  }
  return requestJson(pathAndQuery);
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
    const hint = hintForJiraStatus(res.status);
    throw new Error(`Jira HTTP ${res.status}: ${text.slice(0, 800)}${hint}`);
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
