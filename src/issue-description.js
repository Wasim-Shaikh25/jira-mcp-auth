import { plainTextToAdf } from "./adf.js";

/**
 * @param {string} text
 * @param {'adf' | 'plain'} format
 */
export function issueDescriptionPayload(text, format) {
  if (format === "plain") {
    return String(text ?? "");
  }
  return plainTextToAdf(text);
}
