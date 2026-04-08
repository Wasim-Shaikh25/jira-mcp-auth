# Jira MCP OAuth gateway

A **[Model Context Protocol](https://modelcontextprotocol.io/) (MCP)** server that connects **AI assistants** (for example **Cursor** Composer or Agent) to **your Jira site**. Configure **`JIRA_BASE_URL`** for **Atlassian Jira Cloud** or **Jira Data Center / Server**—this project is **not limited to one company or hosting model**. You can search issues, read and edit tickets, manage assignments, and more, using either a **Personal Access Token (PAT)** or API token, or a **browser SSO session** when corporate login is required.

---

## See also (sibling projects)

| Project | Purpose |
|---------|---------|
| **Confluence MCP** | [confluence-mcp-oauth](https://github.com/Wasim-Shaikh25/confluence-mcp-oauth) — Confluence REST + optional SSO (`@svasimahmed283/confluence-sso-mcp` on npm). Same PAT/cookie design as this server. |
| **GitHub Enterprise launcher** | [mcp-github-enterprise-launcher](https://github.com/Wasim-Shaikh25/mcp-github-enterprise-launcher) — npm stdio wrapper around a `github-mcp-server` binary (optional `vendor/` bundle). |
| **SonarQube launcher** | [mcp-sonarqube-launcher](https://github.com/Wasim-Shaikh25/mcp-sonarqube-launcher) — npm stdio wrapper around a SonarQube MCP `.jar` (optional `vendor/` bundle). |

---

## What this project is

| | |
|---|---|
| **Role** | Runs as a small **Node.js** process that speaks MCP over **standard input/output (stdio)**. Your editor starts it; you do not usually run it by hand except when debugging. |
| **Target product** | **Jira** (Cloud or Data Center) via REST. Paths default to **`/rest/api/3`**; use **`/rest/api/2`** if your server only exposes v2 (common on Data Center). |
| **Auth model** | **Bearer PAT** (if you set one) for every REST call, then **automatic retry with SSO cookies** on `401`/`403`. If you never set a PAT, **cookies only**—after you complete **`jira_login`** once. |
| **SSO login** | Uses **Playwright** + **Chromium** to open a real browser, let you sign in (SAML, OIDC, etc.), and saves session cookies for later API calls. |

The design matches the idea behind **`confluence-mcp-oauth`**: treat Jira as a normal REST API when possible, and use a **real browser session** when the API rejects the request or when you have no PAT.

---

## Why use it

- **Works behind SSO**: Many organizations do not expose simple API-password flows. A PAT (where supported) plus cookie fallback fits **Data Center** and many **federated** setups.
- **One place for secrets**: PATs are intended to live in the **MCP host** configuration (for example Cursor’s **`mcp.json`**), not in a project **`.env`**, so you are less likely to commit tokens into a repo.
- **Familiar Jira operations**: JQL search, full issue JSON, compact “read” views, create/update/delete, projects, assignees, statuses, and optional attachments from **Confluence** or a **public URL**.

---

## How it fits in your workflow

1. You add this server to **Cursor** (or another MCP client) via **`mcp.json`**.
2. You set at least **`JIRA_BASE_URL`** (and optionally **`JIRA_PAT`**) in that config’s **`env`** block.
3. Cursor starts the server when needed; the assistant **calls MCP tools** by name (for example “run **`execute_jql`** with …”).
4. If you rely on SSO, you run **`jira_login`** once (tool or `npm run login`); cookies are stored under **`cookies/session.json`** on disk (ignored by git and not published to npm).

```text
┌─────────────┐    stdio (JSON-RPC)    ┌──────────────────┐    HTTPS     ┌─────────────┐
│ Cursor /    │ ◄────────────────────► │  This MCP server  │ ───────────► │ Jira REST   │
│ MCP client  │                        │  (Node + fetch)   │   Bearer /   │ (and opt.   │
└─────────────┘                        └──────────────────┘   Cookies      │ Confluence) │
                                                                            └─────────────┘
```

---

## MCP tools (reference)

Tools are exposed to the assistant under the names below. Exact parameters are defined in the server’s tool schemas (your client may show them in the UI).

### Authentication

| Tool | Purpose |
|------|---------|
| **`jira_login`** | Opens a browser, completes SSO, saves **`cookies/session.json`**. Use when you have no PAT, or after PAT fails and you need a fresh browser session. |

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
| **`add_attachment_from_confluence`** | Pull a named attachment from a **Confluence page** (needs **`CONFLUENCE_BASE_URL`** and Confluence PAT or cookies) and attach it to a Jira issue. |
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
npx @jira-mcp-oauth/jira-mcp-oauth
```

Pin a version if you want reproducibility:

```bash
npx @jira-mcp-oauth/jira-mcp-oauth@0.1.0
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

Put **non-secret** URLs and timeouts in **`env`**. Put **PATs only** here as well (not in the repo’s **`.env`** for those keys—by design).

**Using `npx` (after publish):**

```json
{
  "mcpServers": {
    "jira-sso": {
      "command": "npx",
      "args": ["-y", "@jira-mcp-oauth/jira-mcp-oauth"],
      "env": {
        "JIRA_BASE_URL": "https://jira.company.com",
        "JIRA_LOGIN_WAIT_SECONDS": "90",
        "JIRA_PAT": "your-pat-or-api-token"
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

### First-time SSO (no PAT or cookie fallback)

1. Ensure **`JIRA_BASE_URL`** is correct (include **`/jira`** in the path only if your instance uses that context path).
2. In chat, run the **`jira_login`** tool **or** from the repo run **`npm run login`** (uses the same merged config as the MCP server).
3. Complete login in the opened browser; wait until the tool finishes (up to **`JIRA_LOGIN_WAIT_SECONDS`**, default 90).
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
| **`JIRA_PAT`** or **`JIRA_API_TOKEN`** | **PAT** or API token your site provides; sent as **`Authorization: Bearer`**. Read from the **MCP host env** (for example **`mcp.json`**), **not** from the project **`.env`** (ignored for these keys on purpose). |
| **`JIRA_REST_API_PREFIX`** | REST base path (default **`/rest/api/3`**). Use **`/rest/api/2`** if your server only exposes v2. |
| **`JIRA_DESCRIPTION_FORMAT`** | **`auto`** (default: plain string for v2, ADF for v3), **`adf`**, or **`plain`** — overrides description encoding if your site differs. |
| **`JIRA_LOGIN_URL`** | Login page URL (default **`{JIRA_BASE_URL}/login.jsp`**). |
| **`JIRA_LOGIN_WAIT_SECONDS`** | Browser SSO wait, in seconds (default **90**). |
| **`JIRA_MAX_ATTACHMENT_BYTES`** | Max upload size in bytes (default 10 MiB). |
| **`JIRA_MCP_SERVER_KEY`** | If several MCP entries share the same path to **`src/index.js`**, set this to **that entry’s id** (e.g. `jira-local`) so merge/PAT discovery matches the right block. |
| **`JIRA_DEFAULT_PROJECT`** | Default **project key** when **`create_ticket`** is called without **project** / **boardName** / **boardId** and board-based resolution is ambiguous or unavailable. |
| **`PREFER_SSO_COOKIES`** | Default **on**: if an SSO cookie file exists, **only cookies** are sent (not PAT). Set **`0`** / **`false`** for PAT-first. Delete the cookie file or set this to **`0`** to force PAT. |
| **`JIRA_LOGIN_POLL_MS`** | During **`jira_login`**, how often to probe **`/rest/api/.../myself`** so login can **finish early** (default **2000** ms). |

### Optional (Confluence attachment helper)

| Variable | Meaning |
|----------|---------|
| **`CONFLUENCE_BASE_URL`** | Confluence root URL for **`add_attachment_from_confluence`**. |
| **`CONFLUENCE_PAT`** or **`CONFLUENCE_API_TOKEN`** | Confluence PAT; same “host config only” rule as Jira PATs. |
| **`CONFLUENCE_MCP_SERVER_KEY`** | Optional; used to name the **Confluence cookie file** for **`add_attachment_from_confluence`** (`cookies/cf-<key>.json`) so it aligns with your Confluence MCP server id. |

**Cookie files:** Jira SSO uses **`cookies/session-<JIRA_MCP_SERVER_KEY or hostname>.json`**. Confluence attachments from this package use **`cookies/cf-<CONFLUENCE_MCP_SERVER_KEY or hostname>.json`** (separate from Jira). Use PAT + `PREFER_SSO_COOKIES=0` if you rely on tokens only.

### Where to set them

- **Cursor:** `%USERPROFILE%\.cursor\mcp.json` (Windows) or **`~/.cursor/mcp.json`** (macOS/Linux) → **`mcpServers.<name>.env`**. Restart the IDE after edits.
- **Local `npm run login`:** Env is merged from the discovered **`mcp.json`** block (same path as this **`src/index.js`**, or legacy **`jira-sso`**) for keys that are unset—set **`JIRA_MCP_SERVER_KEY`** when multiple entries share that path.

### Configuration reference (files & precedence)

| Topic | Detail |
|--------|--------|
| **Secrets** | **`JIRA_*_TOKEN`** / **`CONFLUENCE_*_TOKEN`** are **not** read from the project **`.env`** (by design). Put them only in **`mcp.json`** `env` or another secret store your host injects. |
| **PAT at runtime** | **`JIRA_PAT`** / **`JIRA_API_TOKEN`** — **process env first**, then the discovered **`mcp.json`** block. |
| **CLI login merge** | Fills **only undefined** env keys from the discovered block (never overwrites Cursor). |
| **Cookie files** | One file per instance: **`cookies/session-<id-or-host>.json`** for Jira; **`cookies/cf-<id-or-host>.json`** for Confluence attachment helper. |
| **Cookies** | SSO sessions are saved to **`cookies/session.json`** under this package root (gitignored). **`jira_login`** and **`confluence_login`** (in the Confluence package) each use their own repo’s **`cookies/`** directory. |
| **`add_attachment_from_confluence`** | Needs **`CONFLUENCE_BASE_URL`** and optional **`CONFLUENCE_PAT`** in the **same** `jira-sso` **`mcp.json`** `env`. Uses **`cookies/session.json` in this (Jira) repo** for Confluence cookie fallback—if Confluence is a different SSO realm, prefer a **Confluence PAT** or run login from the Confluence MCP package and align cookie usage. |

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

## Authentication order (summary)

1. If **`JIRA_PAT`** (or **`JIRA_API_TOKEN`**) is set in the MCP env, every request tries **Bearer** auth first.
2. If the server returns **401** or **403** and **`cookies/session.json`** exists (from **`jira_login`**), the same request is **retried once** with **cookies**.
3. If there is **no PAT**, only **cookies** are used (you must have run **`jira_login`**).
4. If neither PAT nor cookies work, tools fail with a clear error until you fix the token or log in again.

---

## Validation

| Step | Command / action |
|------|------------------|
| **Unit tests (features)** | **`npm test`** — runs **`node --test`** on **`tests/jira-features.test.js`** (REST v2/v3 paths, description plain vs ADF, `listProjects` URL shape, board helpers). |
| **Syntax + config (no Jira calls)** | **`npm run validate`** — syntax-checks **`src/`**; with **`JIRA_BASE_URL`** set, prints resolved REST prefix and description format. |
| **MCP wiring** | Cursor **Settings → MCP**: server shows **connected**. Restart Cursor after **`mcp.json`** changes. |
| **Interactive tools** | In **Agent**, call **`execute_jql`** with a narrow query, or **`list_projects`**, after **`jira_login`** or with a PAT. |
| **Inspector (optional)** | Install/run the official MCP Inspector (see [modelcontextprotocol/inspector](https://github.com/modelcontextprotocol/inspector)) and point it at **`node path/to/jira-mcp-oauth/src/index.js`** with the same **`env`** as Cursor. |

---

## Local tarball sanity check

```bash
npm pack
# Creates e.g. jira-mcp-oauth-jira-mcp-oauth-0.1.0.tgz
```

**Windows (cmd):**

```bat
set JIRA_BASE_URL=https://jira.example.com
npx .\jira-mcp-oauth-jira-mcp-oauth-0.1.0.tgz
```

**macOS / Linux:**

```bash
export JIRA_BASE_URL=https://jira.example.com
npx ./jira-mcp-oauth-jira-mcp-oauth-0.1.0.tgz
```

The first **`npx`** run may take a moment while dependencies install. If your **`mcp.json`** already defines **`JIRA_BASE_URL`**, the process may stay running on stdio (normal for MCP).

---

## Security

- Treat **PATs and cookies** like passwords. Do not commit **`cookies/`**, **`.env`** files that hold secrets, or paste tokens into the repo.
- **`JIRA_PAT`**, **`JIRA_API_TOKEN`**, **`CONFLUENCE_PAT`**, and **`CONFLUENCE_API_TOKEN`** are **not** loaded from the project **`.env`**; keep them in the **MCP host** configuration.
- A saved cookie file grants **roughly the same access as your browser user**; lock down the machine and project directory.

---

## Troubleshooting

| Symptom | What to do |
|---------|------------|
| **`JIRA_BASE_URL is not set`** | Add **`JIRA_BASE_URL`** under **`mcpServers.<name>.env`** and restart Cursor. |
| **401 / HTML instead of JSON** | PAT invalid or expired, or wrong API version — try **`JIRA_REST_API_PREFIX`**, refresh **`JIRA_PAT`**, or run **`jira_login`** again. |
| **SSO in the browser but REST still 401** | Set **`JIRA_PAT`** and **`PREFER_SSO_COOKIES=0`** in **`mcp.json`**, or delete the per-server file under **`cookies/`** (see **`JIRA_MCP_SERVER_KEY`** in README env table). Stale cookies can block PAT until removed. **`jira_login`** output lists the cookie path and PAT workaround. |
| **`jira_login` times out in chat** | Increase **`JIRA_LOGIN_WAIT_SECONDS`** or run **`npm run login`** in a terminal (same config). |
| **Browser closes immediately** | Session detection requires **JSON** from **`/myself`**, not **200 HTML** after redirects. **`Execution context was destroyed`** during navigation is caught and **retried** in the poll loop. If SSO still fails, use **PAT** + **`PREFER_SSO_COOKIES=0`**. |
| **Auth scheme** | This server uses **`Authorization: Bearer`** for PAT/API tokens (common on **Data Center**). **Jira Cloud** API tokens are often used with email + API token as **Basic** auth in some clients; if your Cloud site only accepts Basic, Bearer may fail—check Atlassian docs for your site. |
| **`ENOENT` on `cookies/*.lock`** | Ensure the **`cookies/`** directory exists under the installed package (some `npx` extracts can omit it). Create **`cookies`** next to **`src/`** or use a **local `node …/src/index.js`** install. |
| **Half-installed `@modelcontextprotocol/sdk` under `_npx`** | Clear **`%LocalAppData%\npm-cache\_npx`** for that hash, or run from a **git clone** with **`npm install`** so **`node_modules`** is complete. |

---

## Repository and npm metadata

Package **`repository`**, **`homepage`**, and **`bugs`** in **`package.json`** point to **`https://github.com/Wasim-Shaikh25/jira-mcp-auth`**. Update those fields if you fork to another org.

---

## License

See **`package.json`** for the declared license. Add a **`LICENSE`** file in the repo if you publish publicly.
