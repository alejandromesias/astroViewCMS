import { describe, expect, it } from 'vitest';
import {
  type ApiError,
  apiError,
  type ErrorCode,
  type ErrorFields,
  errorTable,
} from './errors.ts';

// The status of every code, as PHASE-2-DESIGN 5.9 and WORKPLAN 2.10e give it. Typed over every code, so a code added to the
// table without a line here does not compile.
const EXPECTED_STATUS: Record<ErrorCode, number> = {
  misdirected: 421,
  not_found: 404,
  'missing-query': 400,
  'unknown-collection': 404,
  'unknown-document': 404,
  'document-missing': 404,
  'invalid-path': 400,
  'body-too-large': 413,
  'invalid-body': 400,
  'no-bundle': 503,
  'bundle-invalid': 500,
  'changes-unavailable': 500,
  busy: 503,
  'preview-unavailable': 503,
  'reference-index-failed': 500,
  'save-failed': 500,
  'save-committed': 500,
  conflict: 409,
  'referenced-by': 409,
  invalid: 422,
  'duplicate-key': 400,
  'outside-site': 400,
  'pattern-mismatch': 400,
  exists: 409,
  'file-missing': 409,
  'read-only': 422,
  unwritable: 422,
  unreadable: 422,
  'build-in-progress': 503,
  'upstream-changed': 503,
  'sync-failed': 502,
  'push-failed': 502,
  'push-rejected': 502,
  'publish-failed': 500,
  'publish-in-progress': 409,
  'remote-moved': 409,
  'build-failed': 424,
  internal_error: 500,
};

// One valid body per code, typed over every code: the fields a route passes to apiError.
const SAMPLE_FIELDS: { readonly [C in ErrorCode]: ErrorFields<C> } = {
  misdirected: { message: 'Host' },
  not_found: {},
  'missing-query': { message: 'Give a collection or a key.' },
  'unknown-collection': { message: 'no collection' },
  'unknown-document': { message: 'no document' },
  'document-missing': { message: 'missing' },
  'invalid-path': { message: 'not a site path' },
  'body-too-large': { message: 'too large' },
  'invalid-body': { message: 'not JSON' },
  'no-bundle': {},
  'bundle-invalid': { message: 'bad bundle.json' },
  'changes-unavailable': { message: 'git failed' },
  busy: { message: 'busy' },
  'preview-unavailable': { message: 'node down' },
  'reference-index-failed': { message: 'index' },
  'save-failed': { message: 'write' },
  'save-committed': { message: 'committed' },
  conflict: { documents: [{ key: 'a/b', revision: 'r1', value: {} }] },
  'referenced-by': { document: 'a/b', referrers: ['a/c'] },
  invalid: {
    errors: [{ key: 'a/b', path: ['title'], message: 'required' }],
  },
  'duplicate-key': { key: 'a/b', message: 'twice' },
  'outside-site': { key: 'a/b', message: 'outside', file: 'x', line: 1 },
  'pattern-mismatch': { key: 'a/b', message: 'pattern' },
  exists: { key: 'a/b', message: 'exists' },
  'file-missing': { key: 'a/b', message: 'missing' },
  'read-only': { key: 'a/b', message: 'read-only' },
  unwritable: { key: 'a/b', message: 'unwritable' },
  unreadable: { key: 'a/b', message: 'unreadable', column: 2 },
  'build-in-progress': { message: 'building' },
  'upstream-changed': { message: 'code changed' },
  'sync-failed': { message: 'sync' },
  'push-failed': { message: 'push' },
  'push-rejected': { message: 'rejected' },
  'publish-failed': { message: 'publish' },
  'publish-in-progress': { message: 'publishing' },
  'remote-moved': { message: 'moved' },
  'build-failed': { message: 'build', firstError: 'MDX parse' },
  internal_error: {},
};

const CODES = Object.keys(errorTable) as ErrorCode[];

describe('errorTable', () => {
  it('lists exactly the codes of EXPECTED_STATUS', () => {
    expect(CODES.sort()).toEqual(Object.keys(EXPECTED_STATUS).sort());
  });

  it.each(CODES)('answers %s with the status of the design', (code) => {
    expect(errorTable[code].status).toBe(EXPECTED_STATUS[code]);
  });

  it.each(CODES)('%s has a sample body that its schema accepts', (code) => {
    expect(errorTable[code].fields.safeParse(SAMPLE_FIELDS[code]).success).toBe(
      true,
    );
  });
});

describe('apiError', () => {
  it.each(CODES)(
    'builds %s with its status and a body that names the code',
    (code) => {
      const answer: ApiError = apiError(code, SAMPLE_FIELDS[code]);
      expect(answer).toEqual({
        status: EXPECTED_STATUS[code],
        body: { error: code, ...SAMPLE_FIELDS[code] },
      });
    },
  );

  it('keeps the position fields of a write-plan refusal', () => {
    expect(
      apiError('outside-site', {
        key: 'a/b',
        message: 'outside',
        file: 'src/a.json',
        line: 3,
        column: 9,
      }),
    ).toEqual({
      status: 400,
      body: {
        error: 'outside-site',
        key: 'a/b',
        message: 'outside',
        file: 'src/a.json',
        line: 3,
        column: 9,
      },
    });
  });

  it('refuses at compile time a code outside the union, or a body its code does not take', () => {
    // Compile-only: the type check fails on these lines (the `@ts-expect-error` lines), so they are never called.
    const refusedByTypes = [
      // @ts-expect-error a code outside the union does not compile
      () => apiError('not-a-code', { message: 'x' }),
      // @ts-expect-error `busy` takes a message, not documents
      () => apiError('busy', { documents: [] }),
    ];
    expect(refusedByTypes).toHaveLength(2);
  });
});
