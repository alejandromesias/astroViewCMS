// Document keys (SYSTEM-DESIGN.md D10): `collection/id`, split at the FIRST
// slash because ids may contain slashes; `data:<path>` for JSON data modules.

export const DATA_PREFIX = 'data:';

export function entryKey(collection: string, id: string): string {
  return `${collection}/${id}`;
}

export function dataKey(projectPath: string): string {
  return `${DATA_PREFIX}${projectPath}`;
}

export function splitKey(key: string): { collection: string; id: string } | undefined {
  if (key.startsWith(DATA_PREFIX)) return undefined;
  const slash = key.indexOf('/');
  if (slash <= 0) return undefined;
  return { collection: key.slice(0, slash), id: key.slice(slash + 1) };
}
