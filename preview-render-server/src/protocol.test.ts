import { describe, expect, it } from 'vitest';
import { isDraftMessage, isPageMessage } from './protocol.ts';

describe('isDraftMessage', () => {
  it('accepts a draft', () => {
    expect(isDraftMessage({ type: 'preview:draft', region: 'blocks', props: { blocks: [] } })).toBe(true);
  });

  it.each([
    ['null', null],
    ['a string', 'preview:draft'],
    ['another type', { type: 'preview:ready', regions: [] }],
    ['a draft without region', { type: 'preview:draft', props: {} }],
    ['a draft with a non-string region', { type: 'preview:draft', region: 3, props: {} }],
  ])('rejects %s', (_, data) => {
    expect(isDraftMessage(data)).toBe(false);
  });
});

describe('isPageMessage', () => {
  it.each([
    { type: 'preview:ready', regions: ['blocks'] },
    { type: 'preview:rendered', region: 'blocks', renderMs: 0.3 },
    { type: 'preview:error', region: 'blocks', status: 500, message: 'x' },
  ])('accepts $type', (message) => {
    expect(isPageMessage(message)).toBe(true);
  });

  it.each([
    ['null', null],
    ['a draft (wrong direction)', { type: 'preview:draft', region: 'blocks', props: {} }],
    ['ready without a regions array', { type: 'preview:ready', regions: 'blocks' }],
    ['rendered without region', { type: 'preview:rendered', renderMs: 1 }],
    ['an unknown type', { type: 'pageNavigation', pathname: '/' }],
  ])('rejects %s', (_, data) => {
    expect(isPageMessage(data)).toBe(false);
  });
});
