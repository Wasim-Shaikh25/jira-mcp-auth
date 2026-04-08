/**
 * Pure helpers for Jira Software (Agile) board → project resolution.
 * @param {unknown} boardsResponse
 */
export function getBoardValues(boardsResponse) {
  const v = boardsResponse?.values ?? boardsResponse?.data;
  return Array.isArray(v) ? v : [];
}

/**
 * @param {Array<{ name?: string; id?: number | string; location?: { projectKey?: string } }>} boards
 */
export function uniqueProjectKeysFromBoards(boards) {
  const keys = new Set();
  for (const b of boards) {
    const pk = b?.location?.projectKey;
    if (pk && typeof pk === "string") keys.add(pk);
  }
  return [...keys];
}

/**
 * @param {unknown[]} boards
 * @param {string} boardName
 */
export function filterBoardsByName(boards, boardName) {
  const want = String(boardName).trim().toLowerCase();
  if (!want) return [];
  return boards.filter((b) => {
    const n = (b?.name && String(b.name)) || "";
    const nl = n.toLowerCase();
    return nl === want || nl.includes(want);
  });
}
