import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { CONFIG } from "./config.js";
import { withCookieFileLockSync } from "./cookie-lock.js";
import { buildLoginToolResultText, logSsoFallbackToStderr } from "./sso-login-messages.js";

/**
 * `page.evaluate` throws if navigation happens mid-call (SSO / IdP redirects).
 * Return false and let the next poll retry instead of failing the whole login.
 * @param {import('playwright').Page} page
 * @param {() => Promise<boolean>} runEvaluate
 */
async function probeSessionWithNavigationGuard(page, runEvaluate) {
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
    return await runEvaluate();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (
      /Execution context was destroyed|most likely because of a navigation/i.test(msg) ||
      /Target page, context or browser has been closed/i.test(msg)
    ) {
      return false;
    }
    throw e;
  }
}

/**
 * Entry URL for login. Using the SSO portal host only (without visiting Jira)
 * does not set cookies for the Jira origin, so REST calls get 401.
 */
function resolveLoginEntryUrl() {
  const base = CONFIG.JIRA_BASE_URL;
  let login = CONFIG.LOGIN_URL;
  try {
    const baseHost = new URL(base).hostname;
    const loginHost = new URL(login).hostname;
    if (loginHost !== baseHost) {
      const fallback = `${base}/login.jsp`;
      console.error(
        `[jira-mcp] JIRA_LOGIN_URL host (${loginHost}) differs from JIRA_BASE_URL host (${baseHost}).`
      );
      console.error(
        `[jira-mcp] Using Jira login entry instead so SSO round-trips through Jira: ${fallback}`
      );
      login = fallback;
    }
  } catch {
    // keep CONFIG.LOGIN_URL
  }
  return login;
}

/**
 * Probe REST from the page (same origin cookies) to detect login without waiting full LOGIN_WAIT_MS.
 * Must not use `response.ok` alone: redirects can yield 200 HTML for unauthenticated users.
 */
async function jiraSessionLooksReady(page) {
  const base = CONFIG.JIRA_BASE_URL.replace(/\/$/, "");
  const prefix = CONFIG.restApiPrefix;
  return probeSessionWithNavigationGuard(page, () =>
    page.evaluate(
      async ({ b, p }) => {
        try {
          const r = await fetch(`${b}${p}/myself`, { credentials: "include" });
          if (!r.ok) return false;
          const ct = (r.headers.get("content-type") || "").toLowerCase();
          if (!ct.includes("json")) return false;
          const text = await r.text();
          if (text.trim().startsWith("<")) return false;
          const data = JSON.parse(text);
          if (!data || typeof data !== "object") return false;
          return Boolean(
            data.accountId ||
              data.key ||
              data.name ||
              data.emailAddress ||
              data.displayName
          );
        } catch {
          return false;
        }
      },
      { b: base, p: prefix }
    )
  );
}

/**
 * Opens a browser so the user can complete SSO; stores Playwright cookie export for REST calls.
 * Polls the REST API and saves as soon as the session works (does not always wait the full timeout).
 * @returns {{ cookiePath: string; cookieCount: number; sessionProbeOk: boolean }}
 */
export async function loginWithSSO() {
  fs.mkdirSync(path.dirname(CONFIG.COOKIE_FILE), { recursive: true });

  const browser = await chromium.launch({ headless: false });
  let ready = false;
  let cookies = [];
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    const entryUrl = resolveLoginEntryUrl();

    console.error("[jira-mcp] Opening browser for SSO login...");
    console.error(`[jira-mcp] Entry: ${entryUrl}`);
    await page.goto(entryUrl, {
      waitUntil: "domcontentloaded",
      timeout: 180_000,
    });

    console.error(
      "[jira-mcp] Complete SSO in this window. Waiting until Jira REST accepts the session (or timeout)..."
    );
    const deadline = Date.now() + CONFIG.LOGIN_WAIT_MS;
    await new Promise((r) => setTimeout(r, Math.min(1500, CONFIG.LOGIN_POLL_MS)));

    while (Date.now() < deadline) {
      if (await jiraSessionLooksReady(page)) {
        ready = true;
        console.error("[jira-mcp] Session detected (REST /myself OK). Saving cookies...");
        break;
      }
      await new Promise((r) => setTimeout(r, CONFIG.LOGIN_POLL_MS));
    }

    if (!ready) {
      console.error(
        `[jira-mcp] REST did not confirm login within ${CONFIG.LOGIN_WAIT_MS / 1000}s — loading base URL once more to capture cookies anyway.`
      );
    }

    console.error(`[jira-mcp] Loading ${CONFIG.JIRA_BASE_URL} to capture Jira cookies...`);
    try {
      await page.goto(CONFIG.JIRA_BASE_URL, {
        waitUntil: "domcontentloaded",
        timeout: 120_000,
      });
    } catch (e) {
      console.error("[jira-mcp] Warning: final Jira load failed:", e?.message ?? e);
    }

    cookies = await context.cookies();
    withCookieFileLockSync(CONFIG.COOKIE_FILE, () => {
      fs.writeFileSync(CONFIG.COOKIE_FILE, JSON.stringify(cookies, null, 2), "utf8");
    });

    if (!Array.isArray(cookies) || cookies.length === 0) {
      console.error(
        "[jira-mcp] WARNING: No cookies captured — SSO may not have completed on this origin (redirects, pop-up blockers, or IdP blocking automation)."
      );
      logSsoFallbackToStderr({
        patEnvKey: "JIRA_PAT (or JIRA_API_TOKEN)",
        cookieFile: CONFIG.COOKIE_FILE,
        logPrefix: "[jira-mcp]",
      });
    } else {
      console.error("[jira-mcp] Login complete. Session stored at", CONFIG.COOKIE_FILE);
    }

    return {
      cookiePath: CONFIG.COOKIE_FILE,
      cookieCount: cookies.length,
      sessionProbeOk: ready,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[jira-mcp] Browser login error:", msg);
    logSsoFallbackToStderr({
      patEnvKey: "JIRA_PAT (or JIRA_API_TOKEN)",
      cookieFile: CONFIG.COOKIE_FILE,
      logPrefix: "[jira-mcp]",
    });
    throw e;
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Text for MCP tool response after jira_login.
 */
export function loginToolResultText(result) {
  return buildLoginToolResultText({
    patEnvKey: "JIRA_PAT (or JIRA_API_TOKEN)",
    cookieFile: result.cookiePath,
    cookieCount: result.cookieCount,
    sessionProbeOk: result.sessionProbeOk,
  });
}
