// What the editor needs from the rendered document's `<head>` (the bridge
// patches the title and the changed `<meta>` tags), and the cleanup of the
// Container's output.

export interface PageHead {
  title?: string;
  /** Attributes of each `<meta>` tag, in document order. */
  meta: Array<Record<string, string>>;
}

const HEAD = /<head\b[^>]*>([\s\S]*?)<\/head>/i;
const TITLE = /<title\b[^>]*>([\s\S]*?)<\/title>/i;
const META = /<meta\b([^>]*)>/gi;
const ATTRIBUTE =
  /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

export function extractHead(html: string): PageHead {
  const head = HEAD.exec(html)?.[1] ?? '';
  const title = TITLE.exec(head)?.[1];
  const meta = [...head.matchAll(META)].map(([, attributes]) =>
    Object.fromEntries(
      [...attributes!.matchAll(ATTRIBUTE)].map(([, name, a, b, c]) => [
        name,
        decodeEntities(a ?? b ?? c ?? ''),
      ]),
    ),
  );
  return {
    ...(title === undefined ? {} : { title: decodeEntities(title.trim()) }),
    meta,
  };
}

function decodeEntities(text: string): string {
  return text
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

// The container doesn't know the build's bundled scripts, so it writes
// dev-server references to component scripts (src="<abs path>.astro?astro&
// type=script..."). They'd 404 and leak local paths; the page has already
// loaded the real bundled scripts.
const SOURCE_SCRIPT_TAG =
  /<script\b[^>]*\bsrc="[^"]*\?astro&(?:amp;)?type=script[^"]*"[^>]*><\/script>/g;

/** Removes the dev-only `<script src="...astro?astro&type=script...">` tags. */
export function stripSourceScripts(html: string): string {
  return html.replace(SOURCE_SCRIPT_TAG, '');
}
