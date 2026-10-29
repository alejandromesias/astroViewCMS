// The bridge's patch step (SYSTEM-DESIGN.md section 3 and D6): applies the
// HTML of a render to the live page without reloading it. Regions that
// changed are morphed, the head's title and meta tags are updated, and if
// anything outside the regions changed the whole body is morphed. A morph
// (idiomorph) keeps the nodes that did not change, so a block that is
// unchanged keeps its state.
import { Idiomorph } from 'idiomorph';

const REGION_ATTR = 'data-preview-region';
const ISLAND = 'ASTRO-ISLAND';
// Elements the render does not contain but the live page needs: the build's
// bundled scripts, styles and stylesheets.
const KEEP = new Set(['SCRIPT', 'STYLE', 'LINK']);
// Astro's island removes `ssr` after hydrating. Island attributes are synced
// except these two, which syncIslandAttributes handles itself.
const ISLAND_SPECIAL_ATTRIBUTES = new Set(['ssr', 'props']);

interface PatchSummary {
  /** What changed: `region:<name>`, `head`, `body`, `script`. */
  changed: string[];
}

export interface Patcher {
  patch(html: string): PatchSummary;
  /** Forget the scripts this patcher ran (a new page replaced the document). */
  reset(): void;
}

export function createPatcher(win: Window & typeof globalThis): Patcher {
  const doc = win.document;
  // Inline scripts the bridge itself ran, by content, so each runs once.
  const ran = new Set<string>();

  const liveScripts = () =>
    new Set(
      Array.from(
        doc.querySelectorAll('script:not([src])'),
        (script) => script.textContent ?? '',
      ),
    );

  /** Morph options (D6): an existing island is opaque, only its attributes
   *  are synced; the build's scripts and styles are never removed. */
  const callbacks = {
    beforeNodeMorphed: (oldNode: Node, newNode: Node) => {
      if (
        (oldNode as Element).tagName === ISLAND &&
        (newNode as Element).tagName === ISLAND
      ) {
        syncIslandAttributes(oldNode as Element, newNode as Element);
        return false;
      }
      return true;
    },
    beforeNodeRemoved: (node: Node) => !KEEP.has((node as Element).tagName),
  };
  const morph = (target: Element, content: string) =>
    Idiomorph.morph(target, content, { morphStyle: 'innerHTML', callbacks });

  /** Page in its final state, without the animations a swap would replay. */
  const finishAnimations = (element: Element) => {
    for (const animation of element.getAnimations?.({ subtree: true }) ?? [])
      animation.finish();
  };

  return {
    reset: () => ran.clear(),

    patch(html) {
      const next = new win.DOMParser().parseFromString(html, 'text/html');
      const changed: string[] = [];

      // Scripts: the render holds the island bootstrap scripts, once per page
      // before the first hydrated block. Those the live page lacks run once.
      const known = new Set([...liveScripts(), ...ran]);
      const fresh: HTMLScriptElement[] = [];
      for (const script of Array.from(next.querySelectorAll('script'))) {
        const text = script.textContent ?? '';
        if (!script.hasAttribute('src') && !known.has(text)) {
          known.add(text);
          fresh.push(script);
        }
        script.remove(); // never morphed in: the browser would not run it
      }

      // Regions that changed.
      const live = new Map<string, Element>();
      for (const element of Array.from(
        doc.querySelectorAll(`[${REGION_ATTR}]`),
      )) {
        const name = element.getAttribute(REGION_ATTR)!;
        if (!live.has(name)) live.set(name, element);
      }
      for (const region of Array.from(
        next.querySelectorAll(`[${REGION_ATTR}]`),
      )) {
        const name = region.getAttribute(REGION_ATTR)!;
        const target = live.get(name);
        if (!target || target.innerHTML === region.innerHTML) continue;
        void morph(target, region.innerHTML);
        finishAnimations(target);
        changed.push(`region:${name}`);
      }

      if (patchHead(doc, next)) changed.push('head');

      // Anything outside the regions: morph the whole body.
      if (bodyOutsideRegions(doc.body) !== bodyOutsideRegions(next.body)) {
        void morph(doc.body, next.body.innerHTML);
        finishAnimations(doc.body);
        changed.push('body');
      }

      for (const script of fresh) {
        const copy = doc.createElement('script');
        for (const { name, value } of Array.from(script.attributes))
          copy.setAttribute(name, value);
        copy.textContent = script.textContent;
        doc.body.append(copy);
        ran.add(script.textContent ?? '');
        changed.push('script');
      }
      return { changed };
    },
  };
}

/** Updates an island that is already on the page (D6). Its children belong to
 *  the framework and stay. A changed `props` must re-render the component: the
 *  island does that by itself when `props` changes, but the React renderer
 *  only acts on an island that still has `ssr` (Astro removes it after
 *  hydrating), so `ssr` goes back first and `props` second. React then
 *  renders the new props into its existing root, keeping the component's state. */
function syncIslandAttributes(live: Element, next: Element): void {
  for (const { name, value } of Array.from(next.attributes)) {
    if (
      !ISLAND_SPECIAL_ATTRIBUTES.has(name) &&
      live.getAttribute(name) !== value
    )
      live.setAttribute(name, value);
  }
  for (const { name } of Array.from(live.attributes)) {
    if (!ISLAND_SPECIAL_ATTRIBUTES.has(name) && !next.hasAttribute(name))
      live.removeAttribute(name);
  }
  const props = next.getAttribute('props');
  if (props !== live.getAttribute('props')) {
    live.setAttribute('ssr', '');
    if (props === null) live.removeAttribute('props');
    else live.setAttribute('props', props);
  }
}

/** The body's markup with regions emptied and the build's scripts, styles and
 *  links left out, to tell whether anything outside the regions changed. */
function bodyOutsideRegions(body: HTMLElement): string {
  const copy = body.cloneNode(true) as HTMLElement;
  for (const region of Array.from(copy.querySelectorAll(`[${REGION_ATTR}]`)))
    region.innerHTML = '';
  for (const element of Array.from(
    copy.querySelectorAll('script, style, link'),
  ))
    element.remove();
  return copy.innerHTML;
}

/** The attribute that identifies a `<meta>` tag. */
function metaKey(meta: Element): string | undefined {
  for (const attribute of ['name', 'property', 'http-equiv']) {
    const value = meta.getAttribute(attribute);
    if (value !== null) return `${attribute}=${value}`;
  }
  return meta.hasAttribute('charset') ? 'charset' : undefined;
}

/** Title and meta tags. Tags the render lacks stay (other scripts add some). */
function patchHead(doc: Document, next: Document): boolean {
  let changed = false;
  if (next.title !== doc.title) {
    doc.title = next.title;
    changed = true;
  }
  const live = new Map<string, Element>();
  for (const meta of Array.from(doc.head.querySelectorAll('meta'))) {
    const key = metaKey(meta);
    if (key && !live.has(key)) live.set(key, meta);
  }
  for (const meta of Array.from(next.head.querySelectorAll('meta'))) {
    const key = metaKey(meta);
    if (!key) continue;
    const target = live.get(key);
    if (!target) {
      doc.head.append(doc.importNode(meta, true));
      changed = true;
    } else if (target.outerHTML !== meta.outerHTML) {
      for (const { name, value } of Array.from(meta.attributes))
        target.setAttribute(name, value);
      changed = true;
    }
  }
  return changed;
}
