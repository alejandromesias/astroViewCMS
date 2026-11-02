// The HTTP helpers of the end-to-end files: the server's address and build folder,
// the sample site's JSON files, and the render and post calls. Shared by
// preview-server.e2e.test.ts and budgets.e2e.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { inject } from 'vitest';

export const BASE = inject('baseUrl');
export const SITE = path.resolve(import.meta.dirname, '../../../sample-site');
export const CLIENT = path.join(inject('buildDir'), 'sample-site', 'client');
export const readJson = (file: string) =>
  JSON.parse(fs.readFileSync(path.join(SITE, file), 'utf8'));

export interface Rendered {
  html: string;
  head: { title?: string; meta: Array<Record<string, string>> };
  documents: string[];
  limits: string[];
  renderMs: number;
}

export async function post(
  route: string,
  body: unknown,
  search = '',
  init: RequestInit = {},
) {
  const response = await fetch(`${BASE}/__preview/${route}${search}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  });
  const text = await response.text();
  // biome-ignore lint/suspicious/noExplicitAny: parsed JSON; the tests read its fields by name
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    // Plain-text answers (400, 404, 500).
  }
  return {
    status: response.status,
    text,
    json,
    timing: response.headers.get('server-timing'),
  };
}

export const render = (
  path_: string,
  documents: Record<string, unknown> = {},
  media?: unknown,
) =>
  post(
    'render',
    { documents, ...(media === undefined ? {} : { media }) },
    `?path=${encodeURIComponent(path_)}`,
  );
