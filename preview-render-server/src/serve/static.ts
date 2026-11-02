import { createReadStream, type Stats, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';

// Static files of the built client folder. Astro's own static handler exists only
// in standalone mode, so in middleware mode the front server serves them first
// (PHASE-2-DESIGN 5.7, step 4).
const TYPES = new Map<string, string>([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.xml', 'application/xml'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.avif', 'image/avif'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.webmanifest', 'application/manifest+json'],
]);

// Answers GET and HEAD for a file under `clientDir` and returns true. Returns
// false, without writing anything, when there is no such file, so the caller
// can pass the request on.
export function serveStatic(
  clientDir: string,
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const found = findFile(clientDir, req.url ?? '/');
  if (found === undefined) return false;
  const type =
    TYPES.get(path.extname(found.file)) ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'content-length': found.size });
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  createReadStream(found.file)
    .on('error', () => res.destroy())
    .pipe(res);
  return true;
}

// The path is decoded and resolved against the client folder, then checked to
// stay inside it. A traversal such as `/..%2fsecret` lands outside and is refused.
function findFile(
  clientDir: string,
  url: string,
): { file: string; size: number } | undefined {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname);
  } catch {
    return undefined;
  }
  const root = path.resolve(clientDir);
  let file = path.resolve(root, `.${pathname}`);
  if (file !== root && !file.startsWith(root + path.sep)) return undefined;
  let stats = statOf(file);
  if (stats?.isDirectory()) {
    file = path.join(file, 'index.html');
    stats = statOf(file);
  }
  return stats?.isFile() ? { file, size: stats.size } : undefined;
}

function statOf(file: string): Stats | undefined {
  try {
    return statSync(file, { throwIfNoEntry: false });
  } catch {
    // A path the OS rejects (for example one with a NUL byte) is simply not a file.
    return undefined;
  }
}
