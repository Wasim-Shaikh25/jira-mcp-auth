/**
 * Minimal Atlassian Document Format helpers for Jira REST API v3.
 */

/** @param {string} text */
export function plainTextToAdf(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const content = lines.map((line) => ({
    type: "paragraph",
    content: line ? [{ type: "text", text: line }] : [],
  }));
  return { type: "doc", version: 1, content };
}

/**
 * @param {unknown} node
 * @returns {string}
 */
export function adfToPlainText(node) {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "object" && node !== null && "text" in node && typeof node.text === "string") {
    return node.text;
  }
  if (Array.isArray(node)) {
    return node.map(adfToPlainText).join("");
  }
  if (typeof node === "object" && node !== null && "content" in node) {
    const c = /** @type {{ content?: unknown; type?: string }} */ (node).content;
    if (Array.isArray(c)) {
      const sep = /** @type {{ type?: string }} */ (node).type === "paragraph" ? "\n" : "";
      return c.map(adfToPlainText).join(sep);
    }
  }
  return "";
}
