import { describe, expect, it } from 'vitest';
import { isDraftMessage, isPageMessage } from './protocol.ts';

describe('isDraftMessage', () => {
  it('accepts a draft', () => {
    expect(isDraftMessage({ type: 'preview:draft', island: 'blocks', props: { blocks: [] } })).toBe(true);
  });

  it.each([
    ['null', null],
    ['a string', 'preview:draft'],
    ['another type', { type: 'preview:ready', islands: [] }],
    ['a draft without island', { type: 'preview:draft', props: {} }],
    ['a draft with a non-string island', { type: 'preview:draft', island: 3, props: {} }],
  ])('rejects %s', (_, data) => {
    expect(isDraftMessage(data)).toBe(false);
  });
});

describe('isPageMessage', () => {
  it.each([
    { type: 'preview:ready', islands: ['blocks'] },
    { type: 'preview:rendered', island: 'blocks', renderMs: 0.3 },
    { type: 'preview:error', island: 'blocks', status: 500, message: 'x' },
  ])('accepts $type', (message) => {
    expect(isPageMessage(message)).toBe(true);
  });

  it.each([
    ['null', null],
    ['a draft (wrong direction)', { type: 'preview:draft', island: 'blocks', props: {} }],
    ['ready without an islands array', { type: 'preview:ready', islands: 'blocks' }],
    ['rendered without island', { type: 'preview:rendered', renderMs: 1 }],
    ['an unknown type', { type: 'pageNavigation', pathname: '/' }],
  ])('rejects %s', (_, data) => {
    expect(isPageMessage(data)).toBe(false);
  });
});
