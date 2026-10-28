// GET /__dev/documents?key=: see dev/documents.ts. Injected only when the
// build runs with PREVIEW_DEV=1. All logic is in dev/documents.ts.
import fs from 'node:fs';
import path from 'node:path';
import { siteRoot } from 'virtual:preview-site';
import type { APIRoute } from 'astro';
import { deps } from '../render/runtime.ts';
import { handleDocument } from './documents.ts';

export const prerender = false;

export const ALL: APIRoute = ({ request }) =>
  handleDocument(request, {
    documents: deps.builtDocuments,
    readFile: (file) => {
      // `file` comes from documents.json; the check is belt and braces.
      const full = path.resolve(siteRoot, file);
      const relative = path.relative(siteRoot, full);
      // `isAbsolute` catches a path on another drive (Windows).
      if (relative.startsWith('..') || path.isAbsolute(relative))
        return undefined;
      return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : undefined;
    },
  });
