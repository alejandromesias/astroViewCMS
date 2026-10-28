import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, isDraftMessage, isPageMessage, protocolMismatch } from './index.ts';

describe('isDraftMessage', () => {
  it('accepts a draft with documents and media', () => {
    expect(isDraftMessage({ type: 'preview:draft', documents: {}, media: {} })).toBe(true);
    expect(isDraftMessage({ type: 'preview:draft', documents: { 'blog/a': null, 'data:x.json': { a: 1 } }, media: { 'a.png': {} } })).toBe(true);
  });

  it.each([
    ['null', null],
    ['a string', 'preview:draft'],
    ['another type', { type: 'preview:ready', path: '/' }],
    ['a v1 draft', { type: 'preview:draft', region: 'blocks', props: {} }],
    ['documents missing', { type: 'preview:draft', media: {} }],
    ['documents as an array', { type: 'preview:draft', documents: [], media: {} }],
    ['documents null', { type: 'preview:draft', documents: null, media: {} }],
    ['media missing', { type: 'preview:draft', documents: {} }],
    ['media as a string', { type: 'preview:draft', documents: {}, media: 'x' }],
  ])('rejects %s', (_, data) => {
    expect(isDraftMessage(data)).toBe(false);
  });
});

describe('isPageMessage', () => {
  it.each([
    { type: 'preview:ready', path: '/blog' },
    { type: 'preview:rendered', path: '/blog', documents: ['blog/a'], limits: ['mdx-body'], renderMs: 0.3 },
    { type: 'preview:error', path: '/blog', status: 500, message: 'x' },
    { type: 'preview:error', path: '/blog', status: 422, message: 'x', errors: [{ key: 'a/b', path: ['t'], message: 'm' }] },
  ])('accepts $type', (message) => {
    expect(isPageMessage(message)).toBe(true);
  });

  it.each([
    ['null', null],
    ['a draft (wrong direction)', { type: 'preview:draft', documents: {}, media: {} }],
    ['ready without a path', { type: 'preview:ready' }],
    ['a v1 ready', { type: 'preview:ready', regions: ['blocks'] }],
    ['rendered without documents', { type: 'preview:rendered', path: '/', limits: [], renderMs: 1 }],
    ['rendered without limits', { type: 'preview:rendered', path: '/', documents: [], renderMs: 1 }],
    ['rendered with a text renderMs', { type: 'preview:rendered', path: '/', documents: [], limits: [], renderMs: 'fast' }],
    ['an error without status', { type: 'preview:error', path: '/', message: 'x' }],
    ['an error with errors that is not a list', { type: 'preview:error', path: '/', status: 422, message: 'x', errors: 'no' }],
    ['an unknown type', { type: 'pageNavigation', path: '/' }],
  ])('rejects %s', (_, data) => {
    expect(isPageMessage(data)).toBe(false);
  });
});

describe('protocol version', () => {
  it('the guards accept a message with or without protocol', () => {
    expect(isDraftMessage({ type: 'preview:draft', protocol: PROTOCOL_VERSION, documents: {}, media: {} })).toBe(true);
    expect(isDraftMessage({ type: 'preview:draft', documents: {}, media: {} })).toBe(true);
    expect(isPageMessage({ type: 'preview:ready', path: '/', protocol: 1 })).toBe(true);
    expect(isPageMessage({ type: 'preview:ready', path: '/' })).toBe(true);
  });

  it('protocolMismatch is null only for the current version', () => {
    expect(protocolMismatch({ protocol: PROTOCOL_VERSION })).toBeNull();
    expect(protocolMismatch({ protocol: 1 })).toContain('sent 1');
    expect(protocolMismatch({})).toContain('sent none');
  });
});
