# Changelog

All notable changes to this project are documented here.

## 0.2.2

### Changed

- **Keep-alive is more aggressive and self-healing.** The background session
  keep-alive now pings **immediately on start** (was a ~3s delay) and defaults to a
  **120s** interval (was 240s). The loop is self-scheduling: after a **successful**
  ping it waits the full interval, but after a **failed** ping it retries quickly
  (default 15s, `JIRA_KEEPALIVE_RETRY_SECONDS`) instead of waiting a full interval,
  so a transient blip cannot let the SSO session quietly age out while the server
  runs. New env var `JIRA_KEEPALIVE_RETRY_SECONDS` (default 15).
  - Unchanged limitation: SSO cookies still cannot be renewed headlessly. When the
    IdP's absolute session lifetime is reached, run `jira_login` again.

## 0.2.1

### Fixed

- **`execute_jql` on Jira Cloud.** Atlassian removed the classic
  `/rest/api/2|3/search` JQL endpoint (it now returns HTTP 410 Gone). `execute_jql`
  now falls back to the enhanced **`/rest/api/3/search/jql`** endpoint automatically
  when the classic one is gone, normalizing the response to the usual `issues[]`
  shape and passing through the new `nextPageToken` / `isLast` pagination fields.
  Data Center sites that still expose the classic endpoint are unaffected.
  - Note: the enhanced API rejects unbounded queries — include a restriction
    (e.g. `project = X` or `assignee = currentUser()`), not just `ORDER BY`.

## 0.2.0

### Breaking changes

- **Removed token/PAT authentication.** Auth is now **SSO cookies only**. The
  environment variables `JIRA_PAT`, `JIRA_API_TOKEN`, `CONFLUENCE_PAT`,
  `CONFLUENCE_API_TOKEN`, and `PREFER_SSO_COOKIES` are no longer read and have no
  effect. Complete `jira_login` once to authenticate; the saved session cookies are
  used for every REST call (including the Confluence attachment helper).
  - Migration: remove those keys from your `mcp.json` env, run the `jira_login`
    tool, and complete SSO in the browser window.

### Added

- **Background session keep-alive.** While the server runs, a loop pings
  `/myself` on an interval to keep the Jira SSO session warm and warns on stderr if
  the cookie goes stale. Configure with `JIRA_KEEPALIVE_SECONDS` (default 240; `0`
  disables). Note: SSO cookies cannot be renewed headlessly — when the session
  truly expires, run `jira_login` again.
- **Stale-cookie cleanup.** After `JIRA_STALE_COOKIE_FAILS` consecutive auth
  failures (default 3; `0` disables) the keep-alive hard-deletes the stale cookie
  file so the next run starts clean. Never triggers on network errors.
- **Team board discovery at login.** `jira_login` now fetches your Agile board(s)
  and their project keys and caches them to `cookies/boards-<host>.json`.
  `create_ticket` defaults to your board's project when you don't pass one (auto-
  selected only when a single project is cached; otherwise it asks you to
  disambiguate with `project` / `boardName` / `boardId`). Also used as a fallback
  when the live Agile API is temporarily unavailable.

### Changed

- Error messages and docs updated to reflect SSO-cookie-only auth.
