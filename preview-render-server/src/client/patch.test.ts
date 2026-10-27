// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { createPatcher } from './patch.ts';
import type { Patcher } from './patch.ts';

const win = { document, DOMParser: window.DOMParser } as unknown as Window & typeof globalThis;

const page = (head: string, body: string) => `<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`;
const region = (name: string, inner: string) => `<div data-preview-region="${name}">${inner}</div>`;
const live = (name: string) => document.querySelector(`[data-preview-region="${name}"]`)!;

let patcher: Patcher;
function load(head: string, body: string) {
  document.head.innerHTML = head;
  document.body.innerHTML = body;
  patcher = createPatcher(win);
}

describe('regions', () => {
  beforeEach(() => {
    load('<title>Old</title>', `<header>nav</header>${region('a', '<h1 id="t">Title</h1><p id="keep">Same</p>')}${region('b', '<p>B</p>')}`);
  });

  it('leaves a region alone when its HTML is the same', () => {
    const before = live('a').firstElementChild;
    const { changed } = patcher.patch(page('<title>Old</title>', `<header>nav</header>${region('a', '<h1 id="t">Title</h1><p id="keep">Same</p>')}${region('b', '<p>B</p>')}`));
    expect(changed).toEqual([]);
    expect(live('a').firstElementChild).toBe(before);
  });

  it('morphs a changed region: it keeps the wrapper and the nodes that did not change', () => {
    const wrapper = live('a');
    const keep = document.getElementById('keep');
    const title = document.getElementById('t');
    const { changed } = patcher.patch(
      page('<title>Old</title>', `<header>nav</header>${region('a', '<h1 id="t">New title</h1><p id="keep">Same</p>')}${region('b', '<p>B</p>')}`),
    );
    expect(changed).toEqual(['region:a']);
    expect(live('a')).toBe(wrapper);
    expect(document.getElementById('keep')).toBe(keep);
    expect(document.getElementById('t')).toBe(title);
    expect(title!.textContent).toBe('New title');
    expect(live('b').innerHTML).toBe('<p>B</p>');
  });

  it('a region the live page lacks arrives with the body morph', () => {
    const { changed } = patcher.patch(page('<title>Old</title>', `<header>nav</header>${region('zzz', '<p>x</p>')}`));
    expect(changed).toEqual(['body']);
    expect(live('zzz').innerHTML).toBe('<p>x</p>');
  });
});

describe('head', () => {
  beforeEach(() => {
    load('<title>Old</title><meta name="description" content="old"><meta property="og:title" content="Old"><meta name="other" content="stays">', region('a', '<p>x</p>'));
  });

  it('updates the title and the changed meta tags, adds new ones, keeps the others', () => {
    const { changed } = patcher.patch(
      page('<title>New</title><meta name="description" content="new"><meta property="og:title" content="Old"><meta name="added" content="yes">', region('a', '<p>x</p>')),
    );
    expect(changed).toEqual(['head']);
    expect(document.title).toBe('New');
    expect(document.querySelector('meta[name="description"]')!.getAttribute('content')).toBe('new');
    expect(document.querySelector('meta[name="added"]')!.getAttribute('content')).toBe('yes');
    expect(document.querySelector('meta[name="other"]')!.getAttribute('content')).toBe('stays');
    expect(document.querySelectorAll('meta[property="og:title"]')).toHaveLength(1);
  });

  it('does nothing when the head is the same', () => {
    expect(patcher.patch(page('<title>Old</title><meta name="description" content="old">', region('a', '<p>x</p>'))).changed).toEqual([]);
  });
});

describe('outside the regions', () => {
  beforeEach(() => {
    load(
      '<title>t</title>',
      `<header><a href="/">Home</a></header>${region('a', '<p>x</p>')}<footer>foot</footer><script type="module" src="/_astro/page.js"></script><link rel="stylesheet" href="/_astro/x.css">`,
    );
  });

  it('morphs the whole body when something outside the regions changed, and keeps scripts and links', () => {
    const header = document.querySelector('header')!;
    const { changed } = patcher.patch(page('<title>t</title>', `<header><a href="/">Start</a></header>${region('a', '<p>x</p>')}<footer>foot</footer>`));
    expect(changed).toEqual(['body']);
    expect(document.querySelector('header')).toBe(header);
    expect(header.textContent).toBe('Start');
    expect(document.querySelector('script[src="/_astro/page.js"]')).not.toBeNull();
    expect(document.querySelector('link[href="/_astro/x.css"]')).not.toBeNull();
  });

  it('does not morph the body when only a region changed', () => {
    const { changed } = patcher.patch(
      page('<title>t</title>', `<header><a href="/">Home</a></header>${region('a', '<p>changed</p>')}<footer>foot</footer>`),
    );
    expect(changed).toEqual(['region:a']);
  });
});

describe('hydrated components (D6)', () => {
  const island = (props: string, inner: string, attrs = 'ssr ') =>
    `<astro-island uid="u1" component-url="/_astro/P.js" renderer-url="/_astro/c.js" ${attrs}props="${props}">${inner}</astro-island>`;

  it('an existing island is opaque: its attributes update, its children stay', () => {
    // The live island has hydrated: `ssr` is gone and React rendered its own children.
    load('', region('a', island('{&quot;n&quot;:[0,1]}', '<button id="hydrated">live</button>', '')));
    const button = document.getElementById('hydrated');
    const { changed } = patcher.patch(page('', region('a', island('{&quot;n&quot;:[0,2]}', '<button>server</button>'))));
    expect(changed).toEqual(['region:a']);
    const element = document.querySelector('astro-island')!;
    expect(element.getAttribute('props')).toBe('{"n":[0,2]}');
    // The island removes it again once it has rendered the new props.
    expect(element.hasAttribute('ssr')).toBe(true);
    expect(document.getElementById('hydrated')).toBe(button);
    expect(element.textContent).toBe('live');
  });

  it('an island whose props did not change is left exactly as it is', () => {
    load('', region('a', island('{&quot;n&quot;:[0,1]}', '<button id="hydrated">live</button>', '')));
    const element = document.querySelector('astro-island')!;
    const { changed } = patcher.patch(page('', region('a', island('{&quot;n&quot;:[0,1]}', '<button>server</button>'))));
    expect(changed).toEqual(['region:a']);
    expect(element.hasAttribute('ssr')).toBe(false);
    expect(element.textContent).toBe('live');
  });

  it('puts ssr back before it sets the new props, so the renderer acts on the change', () => {
    load('', region('a', island('{&quot;n&quot;:[0,1]}', '<i>live</i>', '')));
    const element = document.querySelector('astro-island')!;
    const order: string[] = [];
    const set = element.setAttribute.bind(element);
    element.setAttribute = (name: string, value: string) => (order.push(name), set(name, value));
    patcher.patch(page('', region('a', island('{&quot;n&quot;:[0,2]}', '<i>server</i>'))));
    expect(order.filter((name) => name === 'ssr' || name === 'props')).toEqual(['ssr', 'props']);
  });

  it('a new island is inserted', () => {
    load('', region('a', '<p>x</p>'));
    patcher.patch(page('', region('a', `<p>x</p>${island('{}', '<i>new</i>')}`)));
    expect(document.querySelector('astro-island')).not.toBeNull();
  });
});

describe('inline scripts (D6)', () => {
  const script = (text: string) => `<script>${text}</script>`;
  const scripts = () => Array.from(document.querySelectorAll('script'), (s) => s.textContent);

  it('runs, once, an inline script the live page does not have', () => {
    load('', region('a', '<p>x</p>') + script('window.known = 1'));
    const html = page('', region('a', '<p>y</p>') + script('window.known = 1') + script('window.fresh = 1'));
    expect(patcher.patch(html).changed).toContain('script');
    expect(scripts()).toEqual(['window.known = 1', 'window.fresh = 1']);
    // The same render again adds nothing.
    patcher.patch(html);
    expect(scripts()).toEqual(['window.known = 1', 'window.fresh = 1']);
  });

  it('copies the script attributes and appends it to the body', () => {
    load('', region('a', '<p>x</p>'));
    patcher.patch(page('', region('a', '<p>x</p>') + '<script type="module">export {}</script>'));
    const fresh = document.querySelector('script')!;
    expect(fresh.getAttribute('type')).toBe('module');
    expect(fresh.parentElement).toBe(document.body);
  });

  it('never morphs a script in: scripts inside a changed region are not duplicated', () => {
    load('', region('a', '<p>x</p>'));
    patcher.patch(page('', region('a', '<p>y</p>' + script('window.inRegion = 1'))));
    expect(scripts()).toEqual(['window.inRegion = 1']);
    expect(document.querySelectorAll('script')).toHaveLength(1);
  });

  it('after reset (a navigation) a script runs again', () => {
    load('', region('a', '<p>x</p>'));
    const html = page('', region('a', '<p>x</p>') + script('window.once = 1'));
    patcher.patch(html);
    document.querySelector('script')!.remove();
    patcher.patch(html);
    expect(scripts()).toEqual([]); // remembered: it ran on this page
    patcher.reset();
    patcher.patch(html);
    expect(scripts()).toEqual(['window.once = 1']);
  });
});
