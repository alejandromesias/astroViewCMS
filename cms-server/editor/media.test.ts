import { describe, expect, it } from 'vitest';
import { replaceStagingUrls, stagingPaths } from './media.ts';

const isStaged = (url: string) => url.startsWith('/media/staging/');
const STAGED = '/media/staging/m1.png';

describe('stagingPaths', () => {
  it('pairs a staged image field with the path the save wrote there', () => {
    expect(
      stagingPaths(
        { image: STAGED, title: 'One' },
        { image: '/images/m1.png', title: 'One' },
        isStaged,
      ),
    ).toEqual(new Map([[STAGED, '/images/m1.png']]));
  });

  it('pairs images inside lists and nested objects', () => {
    expect(
      stagingPaths(
        { gallery: [{ src: STAGED }, { src: '/media/staging/m2.png' }] },
        { gallery: [{ src: '/images/m1.png' }, { src: '/images/m2.png' }] },
        isStaged,
      ),
    ).toEqual(
      new Map([
        [STAGED, '/images/m1.png'],
        ['/media/staging/m2.png', '/images/m2.png'],
      ]),
    );
  });

  it('pairs a Markdown value through its frontmatter and its body', () => {
    expect(
      stagingPaths(
        { data: { cover: STAGED }, body: `![cover](${STAGED})` },
        { data: { cover: '/images/m1.png' }, body: '![cover](/images/m1.png)' },
        isStaged,
      ),
    ).toEqual(new Map([[STAGED, '/images/m1.png']]));
  });

  it('pairs nothing for text that is not a staging URL', () => {
    expect(
      stagingPaths({ title: 'Plain' }, { title: '/images/m1.png' }, isStaged),
    ).toEqual(new Map());
  });

  it('pairs nothing when the saved value is not text at that place', () => {
    expect(stagingPaths({ image: STAGED }, { image: null }, isStaged)).toEqual(
      new Map(),
    );
    expect(stagingPaths({ image: STAGED }, {}, isStaged)).toEqual(new Map());
  });

  it('pairs nothing when the saved value does not have the same shape', () => {
    expect(stagingPaths([STAGED], { 0: '/images/m1.png' }, isStaged)).toEqual(
      new Map(),
    );
    expect(
      stagingPaths({ image: STAGED }, ['/images/m1.png'], isStaged),
    ).toEqual(new Map());
  });

  it("keeps a prototype key of the draft from reading the saved object's prototype", () => {
    expect(stagingPaths({ constructor: STAGED }, {}, isStaged)).toEqual(
      new Map(),
    );
  });

  it('pairs a list item the saved list is too short for, and no more', () => {
    expect(
      stagingPaths([STAGED, STAGED], ['/images/m1.png'], isStaged),
    ).toEqual(new Map([[STAGED, '/images/m1.png']]));
  });

  it('pairs nothing for a number, a boolean or null', () => {
    expect(stagingPaths(3, '/images/m1.png', isStaged)).toEqual(new Map());
    expect(stagingPaths(true, true, isStaged)).toEqual(new Map());
    expect(stagingPaths(null, { any: 1 }, isStaged)).toEqual(new Map());
  });

  it('asks the predicate, so a URL it does not know is not paired', () => {
    expect(
      stagingPaths(
        { image: '/elsewhere.png' },
        { image: '/images/x.png' },
        isStaged,
      ),
    ).toEqual(new Map());
  });
});

describe('replaceStagingUrls', () => {
  it('replaces every occurrence of each staging URL in the text', () => {
    expect(
      replaceStagingUrls(
        `{"a":"${STAGED}","b":"${STAGED}"}`,
        new Map([[STAGED, '/images/m1.png']]),
      ),
    ).toBe('{"a":"/images/m1.png","b":"/images/m1.png"}');
  });

  it('leaves the text as it is when no staging URL is in it', () => {
    expect(
      replaceStagingUrls(
        '{"title": "One"}',
        new Map([[STAGED, '/images/m1.png']]),
      ),
    ).toBe('{"title": "One"}');
  });

  it('leaves the text as it is when there is nothing to replace', () => {
    expect(replaceStagingUrls(STAGED, new Map())).toBe(STAGED);
  });
});
