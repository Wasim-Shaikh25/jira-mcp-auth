# Jira MCP OAuth gateway

A **[Model Context Protocol](https://modelcontextprotocol.io/) (MCP)** server that connects **AI assistants** (for example **Cursor** Composer or Agent) to **your Jira site**. Configure **`JIRA_BASE_URL`** for **Atlassian Jira Cloud** or **Jira Data Center / Server**—this project is **not limited to one company or hosting model**. You can search issues, read and edit tickets, manage assignments, and more, authenticating with a **browser SSO session** (cookies). Auth is **SSO-cookie only** — there is no token/PAT mode. A background **session keep-alive** helps the cookie stay warm while the server runs.

---

## See also (sibling projects)

| Project | Purpose |
|---------|---------|
| **Confluence MCP** | [confluence-mcp-oauth](https://github.com/Wasim-Shaikh25/confluence-mcp-oauth) — Confluence REST + SSO ([`confluence-sso-mcp`](https://www.npmjs.com/package/confluence-sso-mcp) on npm). Same cookie design as this server. |
| **GitHub Enterprise launcher** | [mcp-github-enterprise-launcher](https://github.com/Wasim-Shaikh25/mcp-github-enterprise-launcher) — npm stdio wrapper around a `github-mcp-server` binary (optional `vendor/` bundle). |
| **SonarQube launcher** | [mcp-sonarqube-launcher](https://github.com/Wasim-Shaikh25/mcp-sonarqube-launcher) — npm stdio wrapper around a SonarQube MCP `.jar` (optional `vendor/` bundle). |

---

## What this project is

| | |
|---|---|
| **Role** | Runs as a small **Node.js** process that speaks MCP over **standard input/output (stdio)**. Your editor starts it; you do not usually run it by hand except when debugging. |
| **Target product** | **Jira** (Cloud or Data Center) via REST. Paths default to **`/rest/api/3`**; use **`/rest/api/2`** if your server only exposes v2 (common on Data Center). |
| **Auth model** | **SSO cookies only** — complete **`jira_login`** once and every REST call uses those cookies. There is no token/PAT mode. |
| **SSO login** | Uses **Playwright** + **Chromium** to open a real browser, let you sign in (SAML, OIDC, etc.), and saves session cookies for later API calls. |
| **Session keep-alive** | A background loop pings **`/myself`** on an interval (**`JIRA_KEEPALIVE_SECONDS`**, default 240) to keep the session warm and warn early if the cookie goes stale. |

The design matches the idea behind **`confluence-mcp-oauth`**: use a **real browser session** for corporate SSO, and treat Jira as a normal REST API with those cookies.

---

## Why use it

- **Works behind SSO**: Many organizations do not expose simple API-password flows. A real browser SSO session fits **Data Center** and many **federated** setups where only interactive login is allowed.
- **No secrets in config**: There are no tokens to store or accidentally commit — auth is the browser session cookie, saved locally and gitignored.
- **Familiar Jira operations**: JQL search, full issue JSON, compact “read” views, create/update/delete, projects, assignees, statuses, and optional attachments from **Confluence** or a **public URL**.

---

## How it fits in your workflow

1. You add this server to **Cursor** (or another MCP client) via **`mcp.json`**.
2. You set at least **`JIRA_BASE_URL`** in that config’s **`env`** block.
3. Cursor starts the server when needed; the assistant **calls MCP tools** by name (for example “run **`execute_jql`** with …”).
4. If you rely on SSO, you run **`jira_login`** once (tool or `npm run login`); cookies are stored under **`cookies/session.json`** on disk (ignored by git and not published to npm).

```text
┌─────────────┐    stdio (JSON-RPC)    ┌──────────────────┐    HTTPS     ┌─────────────┐
│ Cursor /    │ ◄────────────────────► │  This MCP server  │ ───────────► │ Jira REST   │
│ MCP client  │                        │  (Node + fetch)   │   Cookies    │ (and opt.   │
└─────────────┘                        └──────────────────┘   Cookies      │ Confluence) │
                                                                            └─────────────┘
```

---

## MCP tools (reference)

Tools are exposed to the assistant under the names below. Exact parameters are defined in the server’s tool schemas (your client may show them in the UI).

### Authentication

| Tool | Purpose |
|------|---------|
| **`jira_login`** | Opens a browser, completes SSO, saves the session cookie file. Run once before using other tools, and again if the session expires. |

### Search and read

| Tool | Purpose |
|------|---------|
| **`execute_jql`** | Run **JQL** and return matching issues (with configurable **`maxResults`**). |
| **`get_ticket`** / **`get_task`** | Full issue JSON from the REST API (aliases for task-style issues). |
| **`read_ticket`** / **`read_task`** | Compact issue view (summary, description as plain text, status, assignee, etc.). |
| **`get_only_ticket_name_and_description`** | Only summary and plain-text description. |

### Create, update, delete

| Tool | Purpose |
|------|---------|
| **`create_ticket`** | Create an issue (**summary**, **description**, **issuetype**; optional **project**, **boardName**, **boardId**, **parent**). If **project** is omitted, uses **JIRA_DEFAULT_PROJECT**, resolves from a board, or auto-picks when only one project appears on your boards—otherwise fails with a message listing boards (use **`list_boards`**). |
| **`list_boards`** | List **Jira Software** boards (Agile REST). Helps choose **boardName** / **boardId** for **`create_ticket`**. Not available if your site has no Software boards (use explicit **project**). |
| **`edit_ticket`** | Update fields such as summary, description, labels, parent. |
| **`delete_ticket`** | Delete an issue (requires permission in Jira). |

### Projects, people, workflow

| Tool | Purpose |
|------|---------|
| **`list_projects`** | List projects (v3: search API; v2: `GET /project`). |
| **`assign_ticket`** | Assign an issue by **Atlassian account ID**. |
| **`query_assignable`** | List users assignable for a **project key**. |
| **`get_all_statuses`** | Return issue statuses from Jira. |

### Attachments

| Tool | Purpose |
|------|---------|
| **`add_attachment_from_confluence`** | Pull a named attachment from a **Confluence page** (needs **`CONFLUENCE_BASE_URL`** and Confluence SSO cookies) and attach it to a Jira issue. |
| **`add_attachment_from_public_url`** | Download a file from a **public URL** and attach it to an issue. |

---

## Prerequisites

- **Node.js 18+**
- **Network access** to your Jira (and Confluence, if you use that tool)
- **One-time browser install for Playwright** (Chromium), required only if you use **`jira_login`** or SSO fallback:

```bash
npm install
npm run install-browser
```

---

## How to use it

### Option A — Published package (`npx`)

After the package is on npm, you do **not** need to clone the repo. Cursor (or your host) can start the server with:

```bash
npx -y jira-mcp-oauth
```

Pin a version if you want reproducibility:

```bash
npx -y jira-mcp-oauth@0.1.4
```

The process speaks MCP on **stdio**. In normal use the **IDE starts it**; you only run the command yourself to verify installation or debug.

### Option B — Clone this repository

```bash
git clone <your-repo-url>
cd jira-mcp-oauth
npm install
npm run install-browser
```

Run the server locally:

```bash
npm start
```

Same stdio behavior as `npx`; again, the typical pattern is to let **Cursor** spawn **`node`** with a path to **`src/index.js`** (see below).

### Configure Cursor (`mcp.json`)

Put URLs and timeouts in **`env`**. There are no secrets to configure — auth is the browser SSO session saved by **`jira_login`**.

**Using `npx` (after publish):**

```json
{
  "mcpServers": {
    "jira-sso": {
      "command": "npx",
      "args": ["-y", "jira-mcp-oauth"],
      "env": {
        "JIRA_BASE_URL": "https://jira.company.com",
        "JIRA_LOGIN_WAIT_SECONDS": "90"
      }
    }
  }
}
```

**Using a local checkout (development):**

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

- Replace **`jira-sso`** if you prefer another server id; it is only a label in Cursor.
- **Fully quit and restart Cursor** after any change to **`mcp.json`**.

### First-time SSO

1. Ensure **`JIRA_BASE_URL`** is correct (include **`/jira`** in the path only if your instance uses that context path).
2. In chat, run the **`jira_login`** tool **or** from the repo run **`npm run login`** (uses the same merged config as the MCP server).
3. Complete login in the opened browser; wait until the tool finishes (up to **`JIRA_LOGIN_WAIT_SECONDS`**, default 90).
4. On success, the server also discovers your **Agile board(s)** and their project keys and caches them to **`cookies/boards-<host>.json`**. From then on, **`create_ticket`** defaults to your board's project when you don't pass one (auto-selected only when a single project is cached; otherwise pass **`project`**, **`boardName`**, or **`boardId`**). Re-run **`jira_login`** to refresh the cache.
4. Use **`execute_jql`**, **`read_ticket`**, etc., as needed.

### Using tools from the assistant

You do not type REST URLs yourself. Ask the assistant in natural language, for example:

- “Search Jira for **`project = KEY AND status = Open`** using **`execute_jql`**.”
- “Read issue **`KEY-123`** with **`read_ticket`**.”
- “Create a Bug in project **`KEY`** with summary … using **`create_ticket`**.”

The client maps these to the tool calls above.

---

## Environment variables

### Required

| Variable | Meaning |
|----------|---------|
| **`JIRA_BASE_URL`** | Root URL of your Jira site (example: `https://jira.company.com` or `https://intranet.example.com/jira` if you use a context path). |

### Optional (Jira)

| Variable | Meaning |
|----------|---------|
| **`JIRA_REST_API_PREFIX`** | REST base path (default **`/rest/api/3`**). Use **`/rest/api/2`** if your server only exposes v2. |
| **`JIRA_DESCRIPTION_FORMAT`** | **`auto`** (default: plain string for v2, ADF for v3), **`adf`**, or **`plain`** — overrides description encoding if your site differs. |
| **`JIRA_LOGIN_URL`** | Login page URL (default **`{JIRA_BASE_URL}/login.jsp`**). |
| **`JIRA_LOGIN_WAIT_SECONDS`** | Browser SSO wait, in seconds (default **90**). |
| **`JIRA_MAX_ATTACHMENT_BYTES`** | Max upload size in bytes (default 10 MiB). |
| **`JIRA_MCP_SERVER_KEY`** | If several MCP entries share the same path to **`src/index.js`**, set this to **that entry’s id** (e.g. `jira-local`) so config discovery matches the right block. |
| **`JIRA_DEFAULT_PROJECT`** | Default **project key** when **`create_ticket`** is called without **project** / **boardName** / **boardId** and board-based resolution is ambiguous or unavailable. |
| **`JIRA_KEEPALIVE_SECONDS`** | Background session keep-alive interval in seconds (default **240**). Set **`0`** to disable. Keeps the SSO session warm and warns early if the cookie goes stale. |
| **`JIRA_LOGIN_POLL_MS`** | During **`jira_login`**, how often to probe **`/rest/api/.../myself`** so login can **finish early** (default **2000** ms). |

### Optional (Confluence attachment helper)

| Variable | Meaning |
|----------|---------|
| **`CONFLUENCE_BASE_URL`** | Confluence root URL for **`add_attachment_from_confluence`**. |
| **`CONFLUENCE_MCP_SERVER_KEY`** | Optional; used to name the **Confluence cookie file** for **`add_attachment_from_confluence`** (`cookies/cf-<key>.json`) so it aligns with your Confluence MCP server id. |

**Cookie files:** Jira SSO uses **`cookies/session-<JIRA_MCP_SERVER_KEY or hostname>.json`**. Confluence attachments from this package use **`cookies/cf-<CONFLUENCE_MCP_SERVER_KEY or hostname>.json`** (separate from Jira). Both come from SSO login — there is no token mode.

### Where to set them

- **Cursor:** `%USERPROFILE%\.cursor\mcp.json` (Windows) or **`~/.cursor/mcp.json`** (macOS/Linux) → **`mcpServers.<name>.env`**. Restart the IDE after edits.
- **Local `npm run login`:** Env is merged from the discovered **`mcp.json`** block (same path as this **`src/index.js`**, or legacy **`jira-sso`**) for keys that are unset—set **`JIRA_MCP_SERVER_KEY`** when multiple entries share that path.

### Configuration reference (files & precedence)

| Topic | Detail |
|--------|--------|
| **Auth** | SSO cookies only — no tokens are read from **`.env`** or **`mcp.json`**. Complete **`jira_login`** once. |
| **CLI login merge** | Fills **only undefined** env keys from the discovered block (never overwrites Cursor). |
| **Cookie files** | One file per instance: **`cookies/session-<id-or-host>.json`** for Jira; **`cookies/cf-<id-or-host>.json`** for Confluence attachment helper. |
| **Cookies** | SSO sessions are saved under this package's **`cookies/`** directory (gitignored). **`jira_login`** and **`confluence_login`** (in the Confluence package) each use their own repo's **`cookies/`** directory. |
| **`add_attachment_from_confluence`** | Needs **`CONFLUENCE_BASE_URL`** in the **same** `jira-sso` **`mcp.json`** `env`. Uses the Confluence SSO cookie file in this repo — if Confluence is a different SSO realm, run login from the Confluence MCP package and align cookie usage. |

### Defaults (when omitted)

| Variable | Default |
|----------|---------|
| **`JIRA_REST_API_PREFIX`** | `/rest/api/3` |
| **`JIRA_DESCRIPTION_FORMAT`** | `auto` (plain description for v2 prefix, ADF for v3) |
| **`JIRA_LOGIN_URL`** | `{JIRA_BASE_URL}/login.jsp` |
| **`JIRA_LOGIN_WAIT_SECONDS`** | `90` |
| **`JIRA_MAX_ATTACHMENT_BYTES`** | `10485760` (10 MiB) |
| **`JIRA_DEFAULT_PROJECT`** | (none — set when you want **`create_ticket`** without **project** when board resolution does not apply) |

**Boards and Agile:** **`list_boards`** and board-based **`create_ticket`** resolution use **`/rest/agile/1.0`** (Jira Software). If that API returns **404** or an empty list, your site may not expose Software boards—set **`project`** or **`JIRA_DEFAULT_PROJECT`** instead.

---

## Authentication (summary)

1. Auth is **SSO cookies only**. Run **`jira_login`** once; the session cookie file is used for every REST call.
2. A background keep-alive (**`JIRA_KEEPALIVE_SECONDS`**, default 240) pings **`/myself`** to keep the session warm and warns on stderr if it goes stale.
3. When the session truly expires, tools fail with a clear error — run **`jira_login`** again to refresh it. (SSO cookies cannot be renewed headlessly.)

---

## Validation

| Step | Command / action |
|------|------------------|
| **Unit tests (features)** | **`npm test`** — runs **`node --test`** on **`tests/jira-features.test.js`** (REST v2/v3 paths, description plain vs ADF, `listProjects` URL shape, board helpers). |
| **Syntax + config (no Jira calls)** | **`npm run validate`** — syntax-checks **`src/`**; with **`JIRA_BASE_URL`** set, prints resolved REST prefix and description format. |
| **MCP wiring** | Cursor **Settings → MCP**: server shows **connected**. Restart Cursor after **`mcp.json`** changes. |
| **Interactive tools** | In **Agent**, call **`execute_jql`** with a narrow query, or **`list_projects`**, after completing **`jira_login`**. |
| **Inspector (optional)** | Install/run the official MCP Inspector (see [modelcontextprotocol/inspector](https://github.com/modelcontextprotocol/inspector)) and point it at **`node path/to/jira-mcp-oauth/src/index.js`** with the same **`env`** as Cursor. |

---

## Local tarball sanity check

```bash
npm pack
# Creates e.g. jira-mcp-oauth-0.1.4.tgz
```

**Windows (cmd):**

```bat
set JIRA_BASE_URL=https://jira.example.com
npx .\jira-mcp-oauth-0.1.4.tgz
```

**macOS / Linux:**

```bash
export JIRA_BASE_URL=https://jira.example.com
npx ./jira-mcp-oauth-0.1.4.tgz
```

The first **`npx`** run may take a moment while dependencies install. If your **`mcp.json`** already defines **`JIRA_BASE_URL`**, the process may stay running on stdio (normal for MCP).

---

## Security

- Treat **session cookies** like passwords. Do not commit the **`cookies/`** directory (it is gitignored and excluded from the npm package).
- A saved cookie file grants **roughly the same access as your browser user**; lock down the machine and project directory.

---

## Troubleshooting

| Symptom | What to do |
|---------|------------|
| **`JIRA_BASE_URL is not set`** | Add **`JIRA_BASE_URL`** under **`mcpServers.<name>.env`** and restart Cursor. |
| **401 / HTML instead of JSON** | Session expired or wrong API version — try **`JIRA_REST_API_PREFIX`**, or run **`jira_login`** again to refresh cookies. |
| **SSO in the browser but REST still 401** | Delete the per-server file under **`cookies/`** (see **`JIRA_MCP_SERVER_KEY`** in the env table) and run **`jira_login`** again, completing SSO fully. **`jira_login`** output lists the cookie path. |
| **`jira_login` times out in chat** | Increase **`JIRA_LOGIN_WAIT_SECONDS`** or run **`npm run login`** in a terminal (same config). |
| **Browser closes immediately** | Session detection requires **JSON** from **`/myself`**, not **200 HTML** after redirects. **`Execution context was destroyed`** during navigation is caught and **retried** in the poll loop. If SSO still fails, re-run login and complete it fully. |
| **`ENOENT` on `cookies/*.lock`** | Ensure the **`cookies/`** directory exists under the installed package (some `npx` extracts can omit it). Create **`cookies`** next to **`src/`** or use a **local `node …/src/index.js`** install. |
| **Half-installed `@modelcontextprotocol/sdk` under `_npx`** | Clear **`%LocalAppData%\npm-cache\_npx`** for that hash, or run from a **git clone** with **`npm install`** so **`node_modules`** is complete. |

---

## Repository and npm metadata

Package **`repository`**, **`homepage`**, and **`bugs`** in **`package.json`** point to **`https://github.com/Wasim-Shaikh25/jira-mcp-auth`**. Update those fields if you fork to another org.

The npm package name is **`jira-mcp-oauth`** (unscoped). If you previously published under **`@svasimahmed283/jira-mcp-oauth`**, keep that version for backward compatibility or deprecate it on npm after publishing this name.

---

## License

See **`package.json`** for the declared license. Add a **`LICENSE`** file in the repo if you publish publicly.
