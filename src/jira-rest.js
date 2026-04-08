/**
 * Pure helpers for Jira REST path/version behavior (testable without loading config).
 */

/**
 * @param {string} restApiPrefix e.g. /rest/api/2 or /rest/api/3
 */
export function isRestApiV2Prefix(restApiPrefix) {
  const p = String(restApiPrefix || "").replace(/\/$/, "");
  return /\/api\/2(?:\/|$)/.test(p) || p.endsWith("/2");
}

/**
 * @param {string | undefined} jiraDescriptionFormatEnv JIRA_DESCRIPTION_FORMAT
 * @param {string} restApiPrefix
 * @returns {'adf' | 'plain' | null} null = invalid explicit value (caller may log and fall back)
 */
export function descriptionFormatFromEnv(jiraDescriptionFormatEnv, restApiPrefix) {
  const raw = String(jiraDescriptionFormatEnv ?? "auto").toLowerCase().trim();
  if (raw === "adf") return "adf";
  if (raw === "plain" || raw === "string" || raw === "wiki") return "plain";
  if (raw !== "auto") return null;
  return isRestApiV2Prefix(restApiPrefix) ? "plain" : "adf";
}

/**
 * Relative path + query for list projects (v2: GET all projects; v3: search).
 * @param {string} restApiPrefix
 * @param {number} maxResults capped 1..100
 */
export function listProjectsPathAndQuery(restApiPrefix, maxResults) {
  const mr = Math.min(Math.max(1, maxResults), 100);
  const prefix = String(restApiPrefix || "").replace(/\/$/, "");
  if (isRestApiV2Prefix(prefix)) {
    return { pathAndQuery: `${prefix}/project`, mode: "v2-array" };
  }
  return { pathAndQuery: `${prefix}/project/search?maxResults=${mr}`, mode: "v3-search" };
}
