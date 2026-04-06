/**
 * SSO login helper — same code path as the jira_login MCP tool.
 * Run: npm run login  (uses .env in project root for non-secret overrides)
 */
import { loginWithSSO } from "../src/auth.js";

await loginWithSSO();
