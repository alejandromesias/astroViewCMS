import type { FieldErrorKind } from 'preview-protocol';

export interface FieldIssue {
  /** Path of the field inside the document, e.g. `['blocks', 2, 'title']`. */
  path: (string | number)[];
  message: string;
  /** `invalid` for a schema failure, `refinement-threw` for a refinement that threw (D3). */
  kind: FieldErrorKind;
}

/** A draft that the site's schema rejects. The render route answers it with
 *  `422` and the issues, so the editor can mark the fields. */
export class DraftError extends Error {
  readonly key: string;
  readonly issues: FieldIssue[];

  constructor(key: string, issues: FieldIssue[]) {
    super(
      `Draft ${key} does not match its schema: ${issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
    this.name = 'DraftError';
    this.key = key;
    this.issues = issues;
  }
}
