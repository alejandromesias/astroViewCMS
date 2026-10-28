// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

describe('animations', () => {
  const finished: Element[] = [];
  const calls: unknown[] = [];
  const original = Object.getOwnPropertyDescriptor(Element.prototype, 'getAnimations');

  function stubAnimations() {
    finished.length = 0;
    calls.length = 0;
    Object.defineProperty(Element.prototype, 'getAnimations', {
      configurable: true,
      writable: true,
      value(this: Element, options?: unknown) {
        calls.push(options);
        return [{ finish: () => finished.push(this) }];
      },
    });
  }
  afterEach(() => {
    if (original) Object.defineProperty(Element.prototype, 'getAnimations', original);
    else delete (Element.prototype as { getAnimations?: unknown }).getAnimations;
  });

  it('finishes the animations of a morphed region, including its subtree', () => {
    stubAnimations();
    load('', region('a', '<p>x</p>'));
    patcher.patch(page('', region('a', '<p>y</p>')));
    expect(finished).toEqual([live('a')]);
    expect(calls).toEqual([{ subtree: true }]);
  });

  it('finishes the animations of a morphed body', () => {
    stubAnimations();
    load('', `<header>a</header>${region('a', '<p>x</p>')}`);
    patcher.patch(page('', `<header>b</header>${region('a', '<p>x</p>')}`));
    expect(finished).toEqual([document.body]);
  });

  it('does not touch animations when nothing was morphed', () => {
    stubAnimations();
    load('', region('a', '<p>x</p>'));
    patcher.patch(page('', region('a', '<p>x</p>')));
    expect(finished).toEqual([]);
  });

  it('copes with a browser that has no getAnimations', () => {
    delete (Element.prototype as { getAnimations?: unknown }).getAnimations;
    load('', region('a', '<p>x</p>'));
    expect(patcher.patch(page('', region('a', '<p>y</p>'))).changed).toEqual(['region:a']);
  });
});

describe('regions: duplicates and keepers', () => {
  it('when the live page repeats a region name, only the first one is morphed by the region step', () => {
    load('', region('a', '<p>one</p>') + region('a', '<p>two</p>'));
    const { changed } = patcher.patch(page('', region('a', '<p>new</p>')));
    expect(changed[0]).toBe('region:a');
    expect(changed.filter((entry) => entry === 'region:a')).toHaveLength(1);
    expect(document.querySelector('[data-preview-region="a"]')!.innerHTML).toBe('<p>new</p>');
  });

  it('keeps live styles, scripts and links that the render lacks, but removes other nodes', () => {
    load('', `${region('a', '<p>x</p>')}<style id="s">p{}</style><link id="l" rel="stylesheet" href="/x.css"><script id="sc" src="/p.js"></script><aside id="gone">bye</aside>`);
    patcher.patch(page('', `${region('a', '<p>x</p>')}`));
    expect(document.getElementById('s')).not.toBeNull();
    expect(document.getElementById('l')).not.toBeNull();
    expect(document.getElementById('sc')).not.toBeNull();
    expect(document.getElementById('gone')).toBeNull();
  });

  it('a style or link that only the render has does not count as a change outside the regions', () => {
    load('', region('a', '<p>x</p>'));
    const html = page('', `${region('a', '<p>x</p>')}<style>p{}</style><link rel="stylesheet" href="/new.css">`);
    expect(patcher.patch(html).changed).toEqual([]);
  });

  it('a text-only change outside the regions morphs the body', () => {
    load('', `text${region('a', '<p>x</p>')}`);
    expect(patcher.patch(page('', `other${region('a', '<p>x</p>')}`)).changed).toEqual(['body']);
    expect(document.body.textContent).toBe('otherx');
  });
});

describe('inline scripts: edge cases', () => {
  it('does not run an external script the live page lacks, and does not add it', () => {
    load('', region('a', '<p>x</p>'));
    const { changed } = patcher.patch(page('', `${region('a', '<p>x</p>')}<script src="/new.js"></script>`));
    expect(changed).toEqual([]);
    expect(document.querySelector('script')).toBeNull();
  });

  it('runs an identical new script only once per render', () => {
    load('', region('a', '<p>x</p>'));
    const twice = '<script>window.dup = 1</script><script>window.dup = 1</script>';
    const { changed } = patcher.patch(page('', region('a', '<p>x</p>') + twice));
    expect(changed).toEqual(['script']);
    expect(document.querySelectorAll('script')).toHaveLength(1);
  });

  it('recognises a script the page already has even when an src script sits beside it', () => {
    load('', `${region('a', '<p>x</p>')}<script src="/a.js"></script><script>window.have = 1</script>`);
    const { changed } = patcher.patch(page('', `${region('a', '<p>x</p>')}<script>window.have = 1</script>`));
    expect(changed).toEqual([]);
  });
});

describe('island attributes', () => {
  const island = (attrs: string, inner = '<i>live</i>') => `<astro-island uid="u1" ${attrs}>${inner}</astro-island>`;
  const el = () => document.querySelector('astro-island')!;
  const patchIsland = (attrs: string) => patcher.patch(page('', region('a', island(attrs, '<i>server</i>'))));

  it('updates a changed plain attribute, adds a new one and removes one the render lacks', () => {
    load('', region('a', island('component-url="/a.js" old="1"')));
    patchIsland('component-url="/b.js" fresh="2"');
    expect(el().getAttribute('component-url')).toBe('/b.js');
    expect(el().getAttribute('fresh')).toBe('2');
    expect(el().hasAttribute('old')).toBe(false);
    expect(el().getAttribute('uid')).toBe('u1');
    expect(el().textContent).toBe('live');
  });

  it('only writes the attributes that differ', () => {
    load('', region('a', island('component-url="/a.js"')));
    const written: string[] = [];
    const set = el().setAttribute.bind(el());
    el().setAttribute = (name: string, value: string) => (written.push(name), set(name, value));
    patchIsland('component-url="/a.js" fresh="1"');
    expect(written).toEqual(['fresh']);
  });

  it('leaves ssr alone when the live island has it and the render does not, and does not copy ssr over', () => {
    load('', region('a', island('ssr props="{}"')));
    patchIsland('props="{}"');
    expect(el().hasAttribute('ssr')).toBe(true);
    load('', region('a', island('props="{}"')));
    patchIsland('ssr props="{}"');
    expect(el().hasAttribute('ssr')).toBe(false);
  });

  it('removes props, after putting ssr back, when the render has none', () => {
    load('', region('a', island('props="{}"')));
    patchIsland('component-url="/a.js"');
    expect(el().hasAttribute('props')).toBe(false);
    expect(el().getAttribute('ssr')).toBe('');
  });

  it('does nothing about props when neither side has them', () => {
    load('', region('a', island('component-url="/a.js"')));
    patchIsland('component-url="/a.js"');
    expect(el().hasAttribute('ssr')).toBe(false);
    expect(el().hasAttribute('props')).toBe(false);
  });

  it('only treats astro-island as opaque: other elements are morphed', () => {
    load('', region('a', '<section class="x"><b>old</b></section>'));
    patcher.patch(page('', region('a', '<section class="y"><b>new</b></section>')));
    expect(document.querySelector('section')!.className).toBe('y');
    expect(document.querySelector('b')!.textContent).toBe('new');
  });
});

describe('head: meta keys', () => {
  const head = (extra: string) => `<title>t</title>${extra}`;

  it('matches http-equiv, property and charset metas', () => {
    load(head('<meta charset="utf-8"><meta http-equiv="refresh" content="1"><meta property="og:url" content="a">'), region('a', '<p>x</p>'));
    const { changed } = patcher.patch(
      page(head('<meta charset="latin1"><meta http-equiv="refresh" content="2"><meta property="og:url" content="b">'), region('a', '<p>x</p>')),
    );
    expect(changed).toEqual(['head']);
    expect(document.querySelectorAll('meta')).toHaveLength(3);
    expect(document.querySelector('meta[http-equiv]')!.getAttribute('content')).toBe('2');
    expect(document.querySelector('meta[property]')!.getAttribute('content')).toBe('b');
    expect(document.querySelector('meta[charset]')!.getAttribute('charset')).toBe('latin1');
  });

  it('does not mix up the attribute kinds that share a value', () => {
    load(head('<meta name="x" content="a">'), region('a', '<p>x</p>'));
    patcher.patch(page(head('<meta property="x" content="b">'), region('a', '<p>x</p>')));
    expect(document.querySelectorAll('meta')).toHaveLength(2);
    expect(document.querySelector('meta[name="x"]')!.getAttribute('content')).toBe('a');
  });

  it('ignores metas that have no identifying attribute, on both sides', () => {
    load(head('<meta content="live-anon">'), region('a', '<p>x</p>'));
    const { changed } = patcher.patch(page(head('<meta content="new-anon">'), region('a', '<p>x</p>')));
    expect(changed).toEqual([]);
    expect(document.querySelectorAll('meta')).toHaveLength(1);
    expect(document.querySelector('meta')!.getAttribute('content')).toBe('live-anon');
  });

  it('reports a head change when only a new meta is added', () => {
    load(head(''), region('a', '<p>x</p>'));
    const { changed } = patcher.patch(page(head('<meta name="n" content="1">'), region('a', '<p>x</p>')));
    expect(changed).toEqual(['head']);
    expect(document.querySelector('meta[name="n"]')).not.toBeNull();
  });

  it('reports a head change when only an attribute of a meta changed', () => {
    load(head('<meta name="n" content="1">'), region('a', '<p>x</p>'));
    expect(patcher.patch(page(head('<meta name="n" content="2">'), region('a', '<p>x</p>'))).changed).toEqual(['head']);
  });

  it('reports a head change when only the title changed', () => {
    load(head(''), region('a', '<p>x</p>'));
    expect(patcher.patch(page('<title>other</title>', region('a', '<p>x</p>'))).changed).toEqual(['head']);
    expect(document.title).toBe('other');
  });

  it('when the live head repeats a meta key, only the first is updated', () => {
    load(head('<meta name="n" content="1"><meta name="n" content="1">'), region('a', '<p>x</p>'));
    patcher.patch(page(head('<meta name="n" content="2">'), region('a', '<p>x</p>')));
    const metas = document.querySelectorAll('meta[name="n"]');
    expect([metas[0].getAttribute('content'), metas[1].getAttribute('content')]).toEqual(['2', '1']);
  });
});
