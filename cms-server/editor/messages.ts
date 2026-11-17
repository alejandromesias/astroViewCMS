// The text the editor shows for each answer of a save, and for each failed request (WORKPLAN 2.11c). A message has a level,
// which the page colors, and a field when it belongs next to one document's form. The module names no DOM type.
import type { SaveBody } from 'cms-contract';
import type { ApiFailure, CodedFailure } from './api.ts';

type MessageLevel = 'ok' | 'warning' | 'error';

export interface Message {
  readonly level: MessageLevel;
  readonly text: string;
  /** The key of the document whose form the message belongs next to. */
  readonly field?: string;
}

function at(level: MessageLevel, text: string, field?: string): Message {
  return field === undefined ? { level, text } : { level, text, field };
}

/** A path into a document, put in front of the text: `links.0.url: Invalid url`. */
function withPath(text: string, path: readonly (string | number)[]): string {
  return path.length === 0 ? text : `${path.join('.')}: ${text}`;
}

// Keys from the server are looked up in a Map, so a code like `constructor` is not found in a plain object (IMPLEMENTATION-RECOMMENDATIONS 1).
const WARNING_TEXT = new Map<string, string>([
  [
    'public-image-missing',
    'An image this document uses is not in the public folder',
  ],
]);

const ISSUE_TEXT = new Map<string, string>([
  [
    'media-collision',
    'Another image already has this name. Pick another image.',
  ],
  ['staged-image-missing', 'The uploaded image is gone. Upload it again.'],
]);

/** The messages of a saved answer: the save itself, then each warning (warnings never block a save), next to its document. */
export function saveMessages(body: SaveBody): Message[] {
  const saved = at(
    'ok',
    body.rebuild ? 'Saved. Applies after rebuild.' : 'Saved.',
  );
  const warnings = body.warnings.map((warning) =>
    at(
      'warning',
      withPath(
        WARNING_TEXT.get(warning.code) ?? `Warning: ${warning.code}`,
        warning.path,
      ),
      warning.key,
    ),
  );
  return [saved, ...warnings];
}

/** The messages of a failed request. A 409 `conflict` names each document, which the page answers with its reload and keep buttons. */
export function failureMessages(failure: ApiFailure): Message[] {
  if (failure.code === undefined) return [at('error', plainText(failure))];
  return codedMessages(failure);
}

function plainText(failure: ApiFailure): string {
  switch (failure.kind) {
    case 'network':
      return `Could not reach the server (${failure.text}). Reload before you save again.`;
    case 'shape':
      return "The server's answer was not understood. Reload before you save again.";
    case 'http':
      return `The save did not happen (${failure.status}): ${failure.text}`;
  }
}

function codedMessages(failure: CodedFailure): Message[] {
  switch (failure.code) {
    case 'conflict':
      return failure.body.documents.map((doc) =>
        at(
          'error',
          'Changed since you opened it. Reload to take the saved version, or keep yours.',
          doc.key,
        ),
      );
    case 'invalid':
      if (failure.body.errors.length === 0)
        return [at('error', 'The save did not happen: a field is invalid.')];
      return failure.body.errors.map((issue) =>
        at(
          'error',
          withPath(
            ISSUE_TEXT.get(issue.code ?? '') ?? issue.message,
            issue.path,
          ),
          issue.key,
        ),
      );
    case 'exists':
    case 'file-missing':
    case 'read-only':
    case 'unwritable':
    case 'unreadable':
    case 'duplicate-key':
    case 'outside-site':
    case 'pattern-mismatch':
      return [at('error', failure.body.message, failure.body.key)];
    case 'referenced-by': {
      const { document, referrers, needsDeveloper } = failure.body;
      const list = referrers.join(', ');
      return [
        at(
          'error',
          needsDeveloper
            ? `${document} is used by ${list}. A developer has to change those first.`
            : `${document} is used by ${list}. Remove those references, then save again.`,
          document,
        ),
      ];
    }
    case 'save-failed':
      return [at('error', 'The save failed, and nothing was kept. Try again.')];
    case 'save-committed':
      return [
        at(
          'error',
          'The save was written, but the new revisions could not be read. Reload before you save again.',
        ),
      ];
    case 'busy':
    case 'preview-unavailable':
      return [at('error', 'The save did not happen. Try again.')];
    case 'no-bundle':
      return [
        at('error', 'The site is not built yet, so the save did not happen.'),
      ];
    default:
      return [
        at(
          'error',
          `The save did not happen (${failure.status}): ${failure.text}`,
        ),
      ];
  }
}

/** The text of a failed request for a page message: `what (status): text` for an answer, `what: text` when no answer came or it was not the contract's. */
export function failureText(what: string, failure: ApiFailure): string {
  return failure.kind === 'http'
    ? `${what} (${failure.status}): ${failure.text}`
    : `${what}: ${failure.text}`;
}
