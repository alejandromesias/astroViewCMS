// The text the editor shows for each answer of a save, and for each failed request (WORKPLAN 2.11c). A message has a level,
// which the page colors, and a field when it belongs next to one document's form. The module names no DOM type.
import type { ErrorFields, PublishBody, SaveBody } from 'cms-contract';
import type { ApiFailure, CodedFailure } from './api.ts';
import type { PublishStatus } from './status.ts';

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
    case 'referenced-by':
      return [
        at('error', referrersText(failure.body, 'save'), failure.body.document),
      ];
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
    // A publish is running (2.10e). The same code answers a save made during one.
    case 'publish-in-progress':
      return [at('error', 'A publish is running. Save again when it ends.')];
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

/** The text of a `referenced-by` refusal: the document is used by others, which change first. `again` is the action to repeat. */
function referrersText(
  body: ErrorFields<'referenced-by'>,
  again: 'save' | 'publish',
): string {
  const list = body.referrers.join(', ');
  return body.needsDeveloper
    ? `${body.document} is used by ${list}. A developer has to change those first.`
    : `${body.document} is used by ${list}. Remove those references, then ${again} again.`;
}

/** The messages of a publish that answered 200: the commit (or "nothing to publish"), then each warning. */
export function publishMessages(body: PublishBody): Message[] {
  const published =
    body.commit === null
      ? at('ok', 'Nothing to publish. Nothing differs from upstream.')
      : at('ok', `Published ${body.commit.slice(0, 7)}.`);
  const overwritten = body.overwritten.map((entry) =>
    at(
      'warning',
      `Overwrote the upstream change to ${entry.key} (from ${entry.commit.slice(0, 7)}).`,
    ),
  );
  // A rename duplicate would be pushed by the next publish, so the warning asks for a check first.
  const renamed = body.renamed.map((entry) =>
    at(
      'warning',
      `${entry.key} was renamed from ${entry.from} to ${entry.to}. Check it before you publish again: a rename duplicate would be pushed.`,
    ),
  );
  const skipped =
    body.buildCheckSkipped === undefined
      ? []
      : [
          at(
            'warning',
            'The upstream code does not build, so the build check was skipped.',
          ),
        ];
  return [published, ...overwritten, ...renamed, ...skipped];
}

/** The messages of a failed publish. A code of the publish stage has its own text; an answer with no code gets its status and text. */
export function publishFailureMessages(failure: ApiFailure): Message[] {
  if (failure.code === undefined)
    return [at('error', plainPublishText(failure))];
  return codedPublishMessages(failure);
}

/** The text of a failed publish with no code: no answer, an answer that is not the contract's, or another answer. */
function plainPublishText(failure: ApiFailure): string {
  switch (failure.kind) {
    case 'network':
      return `Could not reach the server (${failure.text}). Reload before you publish again.`;
    case 'shape':
      return "The server's answer was not understood. Reload before you publish again.";
    case 'http':
      return `The publish did not happen (${failure.status}): ${failure.text}`;
  }
}

/** The messages of a publish answer with a code of the table. Each code of the publish stage is listed, then a default. */
function codedPublishMessages(failure: CodedFailure): Message[] {
  switch (failure.code) {
    case 'referenced-by':
      return [at('error', referrersText(failure.body, 'publish'))];
    case 'invalid':
      if (failure.body.errors.length === 0)
        return [
          at('error', 'The publish did not happen: a document is invalid.'),
        ];
      return failure.body.errors.map((issue) =>
        at(
          'error',
          `${issue.key}: ${withPath(ISSUE_TEXT.get(issue.code ?? '') ?? issue.message, issue.path)}`,
        ),
      );
    case 'build-failed': {
      const { message, firstError } = failure.body;
      return [
        at(
          'error',
          firstError ? `${message} First error: ${firstError}` : message,
        ),
      ];
    }
    case 'push-failed':
    case 'push-rejected':
    case 'sync-failed':
    case 'publish-failed':
      return [at('error', failure.body.message)];
    case 'busy':
      return [
        at(
          'error',
          'The repository is busy, so nothing was published. Try again.',
        ),
      ];
    case 'build-in-progress':
      return [
        at(
          'error',
          'The preview is still being rebuilt, so nothing was published. Try again once the build is done.',
        ),
      ];
    case 'upstream-changed':
      return [
        at(
          'error',
          'The upstream code changed while the publish ran, so nothing was published. Your saves are kept. Try again.',
        ),
      ];
    case 'publish-in-progress':
      return [
        at(
          'error',
          'Another publish is running, so nothing was published. Try again when it ends.',
        ),
      ];
    case 'remote-moved':
      return [
        at(
          'error',
          'The remote moved while the publish ran, so nothing was published. Your saves are kept. Publish again.',
        ),
      ];
    case 'no-bundle':
      return [
        at('error', 'The site is not built yet, so nothing was published.'),
      ];
    default:
      return [
        at(
          'error',
          `The publish did not happen (${failure.status}): ${failure.text}`,
        ),
      ];
  }
}

/** The messages of the publish state the status reports: a publish running, the last publish that failed, and an upstream build error. */
export function statusMessages(status: PublishStatus): Message[] {
  const messages: Message[] = [];
  if (status.state === 'publishing')
    messages.push(
      at(
        'warning',
        'A publish is running. Save and Publish are off until it ends.',
      ),
    );
  if (status.state === 'failed')
    messages.push(
      at(
        'error',
        status.error === null
          ? 'The last publish failed.'
          : `The last publish failed: ${status.error}`,
      ),
    );
  if (status.upstreamBuildFailed !== null)
    messages.push(
      at(
        'warning',
        `The upstream code does not build: ${status.upstreamBuildFailed}`,
      ),
    );
  return messages;
}
