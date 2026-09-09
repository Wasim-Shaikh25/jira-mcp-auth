# Changelog

All notable changes to this project are documented here.

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
