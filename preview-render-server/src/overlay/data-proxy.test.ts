import { describe, expect, it } from 'vitest';
import { createOverlayContext, runWithOverlay } from './context.ts';
import { proxyData } from './data-proxy.ts';

const KEY = 'data:src/config/menu.json';
const built = { main: [{ name: 'Home' }], footer: [{ name: 'Terms' }] };
const withDocs = <T>(documents: Record<string, unknown>, fn: () => T) => {
  const context = createOverlayContext({ documents });
  return { value: runWithOverlay(context, fn), context };
};

describe('proxyData', () => {
  it('reads the built value outside a render and when the overlay has no such document', () => {
    const data = proxyData(KEY, built);
    expect(data.main[0]!.name).toBe('Home');
    expect(withDocs({}, () => data.main[0]!.name).value).toBe('Home');
  });

  it('reads the overlay document when there is one', () => {
    const data = proxyData(KEY, built);
    expect(withDocs({ [KEY]: { main: [{ name: 'Draft' }], footer: [] } }, () => data.main[0]!.name).value).toBe('Draft');
  });

  it('works for spread, Object.keys and JSON, which need more than get', () => {
    const data = proxyData(KEY, built);
    const draft = { main: [], extra: 1 };
    const { value } = withDocs({ [KEY]: draft }, () => ({
      keys: Object.keys(data),
      spread: { ...data },
      json: JSON.stringify(data),
      has: 'extra' in data,
    }));
    expect(value.keys).toEqual(['main', 'extra']);
    expect(value.spread).toEqual(draft);
    expect(value.json).toBe(JSON.stringify(draft));
    expect(value.has).toBe(true);
  });

  it('a named export reads its own key of the overlay document', () => {
    const nav = proxyData('data:src/config/config.json', { label: 'Go' }, 'nav_button');
    const { value } = withDocs({ 'data:src/config/config.json': { nav_button: { label: 'Draft go' } } }, () => nav.label);
    expect(value).toBe('Draft go');
  });

  it('falls back to the built value when the draft lacks that key or the document is null', () => {
    const nav = proxyData('data:src/config/config.json', { label: 'Go' }, 'nav_button');
    expect(withDocs({ 'data:src/config/config.json': {} }, () => nav.label).value).toBe('Go');
    expect(withDocs({ 'data:src/config/config.json': null }, () => nav.label).value).toBe('Go');
  });

  it('an array document behaves as an array', () => {
    const list = proxyData('data:src/list.json', ['a', 'b']);
    expect(Array.isArray(list)).toBe(true);
    expect(withDocs({ 'data:src/list.json': ['x', 'y', 'z'] }, () => list.map((s) => s.toUpperCase())).value).toEqual(['X', 'Y', 'Z']);
  });

  it('logs every read', () => {
    const data = proxyData(KEY, built);
    expect([...withDocs({}, () => data.main).context.reads]).toEqual([KEY]);
  });

  it('concurrent renders see their own drafts', async () => {
    const data = proxyData(KEY, built);
    const read = (name: string, delay: number) =>
      runWithOverlay(createOverlayContext({ documents: { [KEY]: { main: [{ name }] } } }), async () => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        return data.main[0]!.name;
      });
    expect(await Promise.all([read('A', 5), read('B', 1)])).toEqual(['A', 'B']);
  });
});
