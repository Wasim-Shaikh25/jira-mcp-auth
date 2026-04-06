# Jira MCP OAuth gateway

A **[Model Context Protocol](https://modelcontextprotocol.io/) (MCP)** server that connects **AI assistants** (for example **Cursor** Composer or Agent) to **Jira Data Center**. You can search issues, read and edit tickets, manage assignments, and more—using either a **Personal Access Token (PAT)** or a **browser SSO session** when your organization uses corporate login instead of a simple API token alone.

---

## What this project is

| | |
|---|---|
| **Role** | Runs as a small **Node.js** process that speaks MCP over **standard input/output (stdio)**. Your editor starts it; you do not usually run it by hand except when debugging. |
| **Target product** | **Jira Data Center** (on-prem style) with REST APIs. Paths default to **`/rest/api/3`**; you can switch to **`/rest/api/2`** if your server only exposes v2. |
| **Auth model** | **Bearer PAT** (if you set one) for every REST call, then **automatic retry with SSO cookies** on `401`/`403`. If you never set a PAT, **cookies only**—after you complete **`jira_login`** once. |
| **SSO login** | Uses **Playwright** + **Chromium** to open a real browser, let you sign in (SAML, OIDC, etc.), and saves session cookies for later API calls. |

The design matches the idea behind **`confluence-mcp-oauth`**: treat Jira as a normal REST API when possible, and use a **real browser session** when the API rejects the request or when you have no PAT.

---

## Why use it

- **Works behind SSO**: Many enterprises do not expose “password + API token” flows for Jira the way Atlassian Cloud does. A PAT plus cookie fallback fits **Data Center** deployments.
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
| **`create_ticket`** | Create an issue (**project**, **summary**, **description**, **issuetype**; optional **parent** for subtasks). |
| **`edit_ticket`** | Update fields such as summary, description, labels, parent. |
| **`delete_ticket`** | Delete an issue (requires permission in Jira). |

### Projects, people, workflow

| Tool | Purpose |
|------|---------|
| **`list_projects`** | List projects (search API). |
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
        "JIRA_PAT": "your-data-center-pat"
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
| **`JIRA_PAT`** or **`JIRA_API_TOKEN`** | Data Center **PAT**; sent as **`Authorization: Bearer`**. Read from the **MCP host env** (for example **`mcp.json`**), **not** from the project **`.env`** (ignored for these keys on purpose). |
| **`JIRA_REST_API_PREFIX`** | REST base path (default **`/rest/api/3`**). Use **`/rest/api/2`** if your server only exposes v2. |
| **`JIRA_LOGIN_URL`** | Login page URL (default **`{JIRA_BASE_URL}/login.jsp`**). |
| **`JIRA_LOGIN_WAIT_SECONDS`** | Browser SSO wait, in seconds (default **90**). |
| **`JIRA_MAX_ATTACHMENT_BYTES`** | Max upload size in bytes (default 10 MiB). |

### Optional (Confluence attachment helper)

| Variable | Meaning |
|----------|---------|
| **`CONFLUENCE_BASE_URL`** | Confluence root URL for **`add_attachment_from_confluence`**. |
| **`CONFLUENCE_PAT`** or **`CONFLUENCE_API_TOKEN`** | Confluence PAT; same “host config only” rule as Jira PATs. |

### Where to set them

- **Cursor:** `%USERPROFILE%\.cursor\mcp.json` → **`mcpServers.<name>.env`**.
- **Local `npm run login`:** The same keys are merged from that **`mcp.json`** block so CLI login matches the MCP server.

---

## Authentication order (summary)

1. If **`JIRA_PAT`** (or **`JIRA_API_TOKEN`**) is set in the MCP env, every request tries **Bearer** auth first.
2. If the server returns **401** or **403** and **`cookies/session.json`** exists (from **`jira_login`**), the same request is **retried once** with **cookies**.
3. If there is **no PAT**, only **cookies** are used (you must have run **`jira_login`**).
4. If neither PAT nor cookies work, tools fail with a clear error until you fix the token or log in again.

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
| **`jira_login` times out in chat** | Increase **`JIRA_LOGIN_WAIT_SECONDS`** or run **`npm run login`** in a terminal (same config). |
| **Jira Cloud vs Data Center** | This server is aimed at **Data Center** PAT + REST patterns. **Jira Cloud** often uses **Basic** auth with email + API token; if your site expects that instead of **Bearer**, behavior may differ. |

---

## Repository and npm metadata

Package **`repository`**, **`homepage`**, and **`bugs`** in **`package.json`** default to **`https://github.com/jira-mcp-oauth/jira-mcp-oauth`**. If your GitHub URL differs, update those fields before publishing.

---

## License

See **`package.json`** for the declared license. Add a **`LICENSE`** file in the repo if you publish publicly.
