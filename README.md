# Jira MCP OAuth gateway (browser SSO)

Published **Model Context Protocol (MCP)** server for **Jira Data Center**. It calls the Jira REST API using a **Personal Access Token (PAT)** when configured, and **falls back to browser SSO session cookies** on `401`/`403`, or uses cookies only when no PAT is set. Optional helpers can pull attachments from **Confluence** when `CONFLUENCE_*` URLs and tokens are set.

## What this MCP provides

Tools include JQL search, read/create/edit/delete issues, projects, assignees, statuses, SSO login (`jira_login`), and optional attachment uploads from Confluence or a public URL. Authentication order: **PAT first** (from MCP env), then **saved cookies** from `jira_login` if needed.

## Prerequisites

- **Node.js 18+**
- One-time: **Chromium for Playwright** (for SSO login tools)

```bash
npm install
npm run install-browser
```

## Install and run with npx

After [publishing to npm](https://docs.npmjs.com/cli/v10/commands/npm-publish), anyone can run the server without cloning:

```bash
npx @jira-mcp-oauth/jira-mcp-oauth
```

Or install a specific version:

```bash
npx @jira-mcp-oauth/jira-mcp-oauth@0.1.0
```

The CLI entry starts the MCP server on **stdio** (same as `npm start`). **Cursor** (or another MCP host) should spawn this process; you normally do **not** run it manually in a terminal unless testing.

Set **environment variables** in the host (see below). The process exits immediately if required configuration is missing (for example `JIRA_BASE_URL`).

### Local tarball (release verification)

```bash
npm pack
# Produces a .tgz file, e.g. jira-mcp-oauth-jira-mcp-oauth-0.1.0.tgz
set JIRA_BASE_URL=https://jira.example.com
npx ./jira-mcp-oauth-jira-mcp-oauth-0.1.0.tgz
```

On Unix:

```bash
export JIRA_BASE_URL=https://jira.example.com
npx ./jira-mcp-oauth-jira-mcp-oauth-0.1.0.tgz
```

## Required environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `JIRA_BASE_URL` | **Yes** | Jira instance root URL (include `/jira` only if your site uses that context path). |

## Optional environment variables

| Variable | Purpose |
|----------|---------|
| `JIRA_PAT` or `JIRA_API_TOKEN` | Data Center **PAT**; sent as `Authorization: Bearer …`. **Recommended:** set only in the MCP host config (e.g. Cursor `mcp.json`), not in a project `.env` — this package intentionally does not load these from `.env`. |
| `JIRA_REST_API_PREFIX` | REST prefix (default `/rest/api/3`; use `/rest/api/2` if your server only exposes v2). |
| `JIRA_LOGIN_URL` | Override login page URL (default `{JIRA_BASE_URL}/login.jsp`). |
| `JIRA_LOGIN_WAIT_SECONDS` | SSO browser wait timeout in seconds (default `90`). |
| `JIRA_MAX_ATTACHMENT_BYTES` | Max attachment size in bytes (default 10 MiB). |
| `CONFLUENCE_BASE_URL` | For Confluence-backed attachment helper. |
| `CONFLUENCE_PAT` or `CONFLUENCE_API_TOKEN` | Confluence PAT (same “host config only” rule as Jira PAT). |

PATs are **secrets**: keep them in **`%USERPROFILE%\.cursor\mcp.json`** (or your client’s secure env), not in the repo. Do not commit `.env` or `cookies/`.

## Cursor MCP configuration (`mcp.json`)

Point **`command`** at the published binary via **`npx`**, or at a local clone. Example using **npx** (after publish):

```json
{
  "mcpServers": {
    "jira-sso": {
      "command": "npx",
      "args": ["-y", "@jira-mcp-oauth/jira-mcp-oauth"],
      "env": {
        "JIRA_BASE_URL": "https://jira.company.com",
        "JIRA_LOGIN_WAIT_SECONDS": "90"
      }
    }
  }
}
```

Example using a **local checkout** (full path to `src/index.js`):

```json
{
  "mcpServers": {
    "jira-sso": {
      "command": "node",
      "args": ["C:/path/to/jira-mcp-oauth/src/index.js"],
      "env": {
        "JIRA_BASE_URL": "https://jira.company.com"
      }
    }
  }
}
```

Fully **quit and restart Cursor** after any change.

## Development

```bash
npm start
```

## First-time login (SSO)

- In the IDE: run MCP tool **`jira_login`**.
- From the repo: `npm run login` (reads the same `JIRA_*` settings applied when the MCP config is merged for local runs).

Session cookies are stored under **`cookies/session.json`** (gitignored, not published).

## Security notes

- Never commit tokens, `.env` files with secrets, or `cookies/`.
- Cookies grant the same access as your browser user; protect the machine and project directory.

## Troubleshooting

- **`JIRA_BASE_URL is not set`:** Add it under `mcpServers.<name>.env` and restart the host.
- **401 / HTML instead of JSON:** PAT invalid or session expired — fix `JIRA_PAT` or run **`jira_login`** again.

## Repository

Package metadata (`repository`, `homepage`, `bugs`) points at **`https://github.com/jira-mcp-oauth/jira-mcp-oauth`**. If your GitHub URL differs, update those fields in `package.json` before publishing.
