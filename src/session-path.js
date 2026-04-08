import path from "node:path";

export function sanitizeSessionLabel(label) {
  return String(label || "default")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 96);
}

export function resolveJiraCookiePath(projectRoot, baseUrl, mcpServerKey) {
  let name = "session";
  const key = typeof mcpServerKey === "string" && mcpServerKey.trim();
  if (key) {
    name = `session-${sanitizeSessionLabel(mcpServerKey)}`;
  } else {
    try {
      const host = new URL(baseUrl).hostname;
      name = `session-${sanitizeSessionLabel(host)}`;
    } catch {
      name = "session";
    }
  }
  return path.join(projectRoot, "cookies", `${name}.json`);
}

/**
 * Cookie file for Confluence REST from the Jira MCP package (separate from Jira SSO cookies).
 * Name mirrors confluence-mcp-oauth (`session-<label>.json`) but uses `cf-` prefix to avoid clashes.
 */
export function resolveConfluenceCookiePath(projectRoot, baseUrl, mcpServerKey) {
  let label = "default";
  if (typeof mcpServerKey === "string" && mcpServerKey.trim()) {
    label = mcpServerKey;
  } else {
    try {
      label = new URL(baseUrl).hostname;
    } catch {
      label = "default";
    }
  }
  return path.join(projectRoot, "cookies", `cf-${sanitizeSessionLabel(label)}.json`);
}
