// The staging URLs of a draft after a save (WORKPLAN 2.7b). An image uploaded for the draft is held under its staging URL
// until the save moves it into the site; the saved document then holds the path. This module pairs the two and replaces
// the URLs in the draft's text. The module names no DOM type.

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Pairs each staging URL of the draft with the saved value at the same place. `isStaged` tells a staging URL from other text. */
function pairInto(
  draft: unknown,
  saved: unknown,
  isStaged: (url: string) => boolean,
  pairs: Map<string, string>,
): void {
  if (typeof draft === 'string') {
    if (isStaged(draft) && typeof saved === 'string') pairs.set(draft, saved);
  } else if (Array.isArray(draft)) {
    const draftList: unknown[] = draft;
    const savedList: unknown[] = Array.isArray(saved) ? saved : [];
    for (const [index, item] of draftList.entries())
      pairInto(item, savedList[index], isStaged, pairs);
  } else {
    const draftRecord = recordOf(draft);
    if (draftRecord === undefined) return;
    const savedRecord = recordOf(saved) ?? {};
    for (const [key, item] of Object.entries(draftRecord))
      pairInto(
        item,
        Object.hasOwn(savedRecord, key) ? savedRecord[key] : undefined,
        isStaged,
        pairs,
      );
  }
}

/** The staging URL of each image of the draft that the save moved, with the path the saved document holds for it. */
export function stagingPaths(
  draft: unknown,
  saved: unknown,
  isStaged: (url: string) => boolean,
): ReadonlyMap<string, string> {
  const pairs = new Map<string, string>();
  pairInto(draft, saved, isStaged, pairs);
  return pairs;
}

/** Replaces each staging URL in the text (a textarea's JSON or Markdown body) with its saved path. */
export function replaceStagingUrls(
  text: string,
  paths: ReadonlyMap<string, string>,
): string {
  let replaced = text;
  for (const [url, path] of paths) replaced = replaced.split(url).join(path);
  return replaced;
}
