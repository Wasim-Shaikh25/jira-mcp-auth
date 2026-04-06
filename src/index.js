#!/usr/bin/env node
import process from "node:process";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loginWithSSO } from "./auth.js";
import {
  executeJql,
  getTicket,
  readTicket,
  getOnlyTicketNameAndDescription,
  createTicket,
  editTicket,
  deleteTicket,
  listProjects,
  assignTicket,
  queryAssignable,
  getAllStatuses,
  addAttachmentFromConfluence,
  addAttachmentFromPublicUrl,
} from "./jira.js";

const server = new Server(
  { name: "jira-oauth-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "jira_login",
      description:
        "SSO login in a browser; saves cookies for REST calls when PAT is not set or as fallback after PAT fails (401/403). Optional if JIRA_PAT is configured.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "execute_jql",
      description: "Run a JQL search and return issues (summary fields).",
      inputSchema: {
        type: "object",
        properties: {
          jql: { type: "string", description: "JQL query string" },
          maxResults: {
            type: "number",
            description: "Maximum number of results (default 10, max 100).",
          },
        },
        required: ["jql"],
      },
    },
    {
      name: "get_ticket",
      description: "Get full issue JSON from Jira REST API (v3).",
      inputSchema: {
        type: "object",
        properties: {
          issueIdOrKey: {
            type: "string",
            description: "The issue ID or key of the ticket",
          },
        },
        required: ["issueIdOrKey"],
      },
    },
    {
      name: "read_ticket",
      description:
        "Read a ticket as a compact object (summary, plain-text description, status, assignee, etc.).",
      inputSchema: {
        type: "object",
        properties: {
          issueIdOrKey: {
            type: "string",
            description: "The issue ID or key of the ticket",
          },
        },
        required: ["issueIdOrKey"],
      },
    },
    {
      name: "get_task",
      description:
        "Same as get_ticket — returns full issue JSON (alias for task-type issues).",
      inputSchema: {
        type: "object",
        properties: {
          issueIdOrKey: {
            type: "string",
            description: "The issue ID or key of the ticket",
          },
        },
        required: ["issueIdOrKey"],
      },
    },
    {
      name: "read_task",
      description:
        "Same as read_ticket — compact issue view (alias for task-type issues).",
      inputSchema: {
        type: "object",
        properties: {
          issueIdOrKey: {
            type: "string",
            description: "The issue ID or key of the ticket",
          },
        },
        required: ["issueIdOrKey"],
      },
    },
    {
      name: "get_only_ticket_name_and_description",
      description: "Return only summary and plain-text description for an issue.",
      inputSchema: {
        type: "object",
        properties: {
          issueIdOrKey: {
            type: "string",
            description: "The issue ID or key of the ticket",
          },
        },
        required: ["issueIdOrKey"],
      },
    },
    {
      name: "create_ticket",
      description: "Create an issue (description is plain text; stored as ADF).",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string", description: "Project key" },
          summary: { type: "string", description: "Ticket summary" },
          description: { type: "string", description: "Ticket description" },
          issuetype: {
            type: "string",
            description: "Issue type name (Bug, Story, Task, etc.)",
          },
          parent: {
            type: "string",
            description: "Parent issue key (for subtasks)",
          },
        },
        required: ["project", "summary", "description", "issuetype"],
      },
    },
    {
      name: "edit_ticket",
      description: "Update issue fields (summary, description, labels, parent).",
      inputSchema: {
        type: "object",
        properties: {
          issueIdOrKey: { type: "string", description: "Issue ID or key to edit" },
          summary: { type: "string", description: "New summary" },
          description: { type: "string", description: "New description (plain text)" },
          labels: {
            type: "array",
            items: { type: "string" },
            description: "Labels to set",
          },
          parent: { type: "string", description: "New parent issue key" },
        },
        required: ["issueIdOrKey"],
      },
    },
    {
      name: "delete_ticket",
      description: "Delete an issue (requires permission).",
      inputSchema: {
        type: "object",
        properties: {
          issueIdOrKey: { type: "string", description: "Issue ID or key to delete" },
        },
        required: ["issueIdOrKey"],
      },
    },
    {
      name: "list_projects",
      description: "List Jira projects (project search API).",
      inputSchema: {
        type: "object",
        properties: {
          maxResults: {
            type: "number",
            description: "Maximum number of projects (default 50, max 100).",
          },
        },
      },
    },
    {
      name: "assign_ticket",
      description: "Assign an issue by Atlassian account ID.",
      inputSchema: {
        type: "object",
        properties: {
          accountId: { type: "string", description: "Assignee's account ID" },
          issueIdOrKey: { type: "string", description: "Issue ID or key to assign" },
        },
        required: ["accountId", "issueIdOrKey"],
      },
    },
    {
      name: "query_assignable",
      description: "List users assignable for a project.",
      inputSchema: {
        type: "object",
        properties: {
          project_key: {
            type: "string",
            description: "Project key to query assignable users for",
          },
        },
        required: ["project_key"],
      },
    },
    {
      name: "get_all_statuses",
      description: "Return all issue statuses from Jira.",
      inputSchema: {
        type: "object",
        properties: {
          maxResults: {
            type: "number",
            description: "Ignored; kept for parity with official tool shape.",
          },
        },
      },
    },
    {
      name: "add_attachment_from_confluence",
      description:
        "Download an attachment from Confluence (CONFLUENCE_BASE_URL + CONFLUENCE_PAT or SSO cookies) and upload it to a Jira issue.",
      inputSchema: {
        type: "object",
        properties: {
          issueIdOrKey: {
            type: "string",
            description: "Issue ID or key to add attachment to",
          },
          pageId: { type: "string", description: "Confluence page ID" },
          attachmentName: {
            type: "string",
            description: "Name of the attachment in Confluence",
          },
        },
        required: ["issueIdOrKey", "pageId", "attachmentName"],
      },
    },
    {
      name: "add_attachment_from_public_url",
      description: "Download a file from a public URL and attach it to a Jira issue.",
      inputSchema: {
        type: "object",
        properties: {
          issueIdOrKey: {
            type: "string",
            description: "Issue ID or key to add attachment to",
          },
          imageUrl: {
            type: "string",
            description: "Public URL of the file to attach",
          },
        },
        required: ["issueIdOrKey", "imageUrl"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = request.params.arguments ?? {};

  if (name === "jira_login") {
    await loginWithSSO();
    return {
      content: [
        {
          type: "text",
          text: "SSO session saved. You can use search, read, and (if permitted) create/update/delete tools.",
        },
      ],
    };
  }

  if (name === "execute_jql") {
    const jql = String(args.jql);
    const maxResults = typeof args.maxResults === "number" ? args.maxResults : 10;
    const data = await executeJql(jql, maxResults);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }

  if (name === "get_ticket" || name === "get_task") {
    const issueIdOrKey = String(args.issueIdOrKey);
    const data = await getTicket(issueIdOrKey);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }

  if (name === "read_ticket" || name === "read_task") {
    const issueIdOrKey = String(args.issueIdOrKey);
    const data = await readTicket(issueIdOrKey);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }

  if (name === "get_only_ticket_name_and_description") {
    const issueIdOrKey = String(args.issueIdOrKey);
    const data = await getOnlyTicketNameAndDescription(issueIdOrKey);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }

  if (name === "create_ticket") {
    const data = await createTicket({
      project: String(args.project),
      summary: String(args.summary),
      description: String(args.description),
      issuetype: String(args.issuetype),
      parent: args.parent != null ? String(args.parent) : undefined,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }

  if (name === "edit_ticket") {
    const data = await editTicket({
      issueIdOrKey: String(args.issueIdOrKey),
      summary: args.summary != null ? String(args.summary) : undefined,
      description: args.description != null ? String(args.description) : undefined,
      labels: Array.isArray(args.labels) ? args.labels.map(String) : undefined,
      parent: args.parent != null ? String(args.parent) : undefined,
    });
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }

  if (name === "delete_ticket") {
    const data = await deleteTicket(String(args.issueIdOrKey));
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }

  if (name === "list_projects") {
    const maxResults = typeof args.maxResults === "number" ? args.maxResults : 50;
    const data = await listProjects(maxResults);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }

  if (name === "assign_ticket") {
    const data = await assignTicket(String(args.issueIdOrKey), String(args.accountId));
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }

  if (name === "query_assignable") {
    const data = await queryAssignable(String(args.project_key));
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }

  if (name === "get_all_statuses") {
    const data = await getAllStatuses(
      typeof args.maxResults === "number" ? args.maxResults : 50
    );
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }

  if (name === "add_attachment_from_confluence") {
    const data = await addAttachmentFromConfluence(
      String(args.issueIdOrKey),
      String(args.pageId),
      String(args.attachmentName)
    );
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }

  if (name === "add_attachment_from_public_url") {
    const data = await addAttachmentFromPublicUrl(
      String(args.issueIdOrKey),
      String(args.imageUrl)
    );
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);

process.on("SIGINT", async () => {
  await transport.close();
  process.exit(0);
});
