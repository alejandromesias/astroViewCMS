import type { ImageMetadata } from 'astro';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { islands } from 'virtual:preview-islands';
import Broken from '../test/fixtures/Broken.astro';
import Greeting from '../test/fixtures/Greeting.astro';
import { BASE, callRoute, jsonRequest } from '../test/helpers.ts';
import { ALL, POST, resolveImages, stripSourceScripts } from './preview-route.ts';

const photo: ImageMetadata = { src: '/_astro/photo.abc.png', width: 800, height: 600, format: 'png' };

beforeAll(() => {
  islands.greeting = { component: Greeting, contentDir: 'src/content/pages' };
  islands.broken = { component: Broken, contentDir: '' };
});

describe('resolveImages', () => {
  const known = { 'src/content/assets/images/photo.png': photo };

  it('swaps a path relative to the content folder for its ImageMetadata', () => {
    expect(resolveImages('../assets/images/photo.png', 'src/content/pages', known)).toBe(photo);
  });

  it('walks nested arrays and objects', () => {
    const props = { blocks: [{ type: 'hero', retrato: '../assets/images/photo.png', title: 'Hola' }] };
    expect(resolveImages(props, 'src/content/pages', known)).toEqual({
      blocks: [{ type: 'hero', retrato: photo, title: 'Hola' }],
    });
  });

  it.each([
    ['an unknown image path', '../assets/images/missing.png'],
    ['an uploaded draft image URL', '/__preview-media/0123456789abcdef.png'],
    ['a string that is not an image', 'Terapia compasiva'],
  ])('leaves %s unchanged', (_, value) => {
    expect(resolveImages(value, 'src/content/pages', known)).toBe(value);
  });

  it('keeps numbers, booleans and null', () => {
    expect(resolveImages({ n: 1, b: true, z: null }, '', known)).toEqual({ n: 1, b: true, z: null });
  });
});

describe('stripSourceScripts', () => {
  it('removes dev-only component script references', () => {
    const html = '<p>x</p><script type="module" src="C:/site/src/Hero.astro?astro&type=script&index=0&lang.ts"></script>';
    expect(stripSourceScripts(html)).toBe('<p>x</p>');
  });

  it('also matches the HTML-escaped form', () => {
    expect(stripSourceScripts('<script src="/x.astro?astro&amp;type=script&amp;index=0"></script>')).toBe('');
  });

  it('keeps ordinary scripts', () => {
    const html = '<script type="module" src="/_astro/page.js"></script><script>inline()</script>';
    expect(stripSourceScripts(html)).toBe(html);
  });
});

describe('POST /__preview/<island>', () => {
  it('renders the island with the posted props', async () => {
    const response = await callRoute(POST, { island: 'greeting' }, jsonRequest('/__preview/greeting', { name: 'Ana', items: ['uno', 'dos'] }));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('server-timing')).toMatch(/^render;dur=\d+(\.\d)?$/);
    const html = await response.text();
    expect(html).toContain('Hola, Ana');
    expect(html).toMatch(/<li[^>]*>uno<\/li><li[^>]*>dos<\/li>/);
  });

  it('strips the component script reference from the fragment', async () => {
    const html = await (await callRoute(POST, { island: 'greeting' }, jsonRequest('/__preview/greeting', { name: 'Ana' }))).text();
    expect(html).not.toContain('<script');
  });

  it('escapes text', async () => {
    const html = await (
      await callRoute(POST, { island: 'greeting' }, jsonRequest('/__preview/greeting', { name: '<img src=x onerror=alert(1)>' }))
    ).text();
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('renders an uploaded draft image as a plain URL', async () => {
    const url = '/__preview-media/0123456789abcdef.png';
    const html = await (await callRoute(POST, { island: 'greeting' }, jsonRequest('/__preview/greeting', { name: 'Ana', photo: url }))).text();
    expect(html).toContain(`src="${url}"`);
  });

  it('answers 404 for an unknown island', async () => {
    const response = await callRoute(POST, { island: 'nope' }, jsonRequest('/__preview/nope', {}));
    expect(response.status).toBe(404);
  });

  it('answers 400 when the body is not JSON', async () => {
    const response = await callRoute(POST, { island: 'greeting' }, jsonRequest('/__preview/greeting', '{not json'));
    expect(response.status).toBe(400);
  });

  it('refuses non-JSON and cross-site requests', async () => {
    const text = new Request(`${BASE}/__preview/greeting`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
    expect((await callRoute(POST, { island: 'greeting' }, text)).status).toBe(404);
    const crossSite = jsonRequest('/__preview/greeting', {}, { 'sec-fetch-site': 'cross-site' });
    expect((await callRoute(POST, { island: 'greeting' }, crossSite)).status).toBe(403);
  });

  it('answers 500 with the error message when the render throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await callRoute(POST, { island: 'broken' }, jsonRequest('/__preview/broken', {}));
    expect(response.status).toBe(500);
    expect(await response.text()).toContain('broken on purpose');
    expect(consoleError).toHaveBeenCalledOnce();
  });
});

describe('other methods', () => {
  it('answer 405 with an Allow header', async () => {
    const response = await callRoute(ALL, {}, new Request(`${BASE}/__preview/greeting`, { method: 'PUT' }));
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });

  it('refuse GET: saved props are no longer served here', async () => {
    const response = await callRoute(ALL, {}, new Request(`${BASE}/__preview/greeting`));
    expect(response.status).toBe(405);
  });
});
