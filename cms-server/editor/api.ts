// The CMS API as the test editor calls it (PHASE-2-DESIGN 5.9): one function per route the editor uses. Each answer is
// read with its cms-contract schema. A failed answer keeps its error code when the code is in cms-contract's table, and
// otherwise its status and text. `fetch` is passed in, and the module names no DOM type, so the tests call it with fakes.
import {
  type ChangesBody,
  changesAnswerSchema,
  type DocumentBody,
  documentAnswerSchema,
  type ErrorBody,
  type ErrorCode,
  errorTable,
  type MediaBody,
  mediaAnswerSchema,
  type OverlayBody,
  overlayAnswerSchema,
  type PreviewUrlBody,
  type PublishBody,
  previewUrlAnswerSchema,
  publishAnswerSchema,
  type SaveBody,
  type SaveRequest,
  type StatusAnswerBody,
  saveAnswerSchema,
  statusAnswerSchema,
} from 'cms-contract';

/** The part of a `Response` the API reads. */
interface ApiResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

/** The part of a `fetch` request the API makes: a method, its headers and its body. */
interface RequestOptions {
  readonly method: 'POST' | 'PUT';
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | Blob;
}

/** The part of `fetch` the API calls. The page passes the real one; the tests pass a fake. */
export type FetchLike = (
  url: string,
  init?: RequestOptions,
) => Promise<ApiResponse>;

/** A contract schema as the API uses it: `safeParse` checks a value and returns it typed. */
interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

interface FailureBase {
  /** The HTTP status; 0 when no answer came. */
  readonly status: number;
  /** The message of the answer (its `message` field), or the body as text. For a network failure, the error's message. */
  readonly text: string;
}

/** A failed answer whose body names a code of cms-contract's error table, with the fields the code adds. */
export type CodedFailure = {
  readonly [C in ErrorCode]: FailureBase & {
    readonly kind: 'http';
    readonly code: C;
    readonly body: ErrorBody<C>;
  };
}[ErrorCode];

/** A failure without a code: an HTTP answer with another body (`http`), no answer (`network`), or an answer that is not the contract's (`shape`). */
type PlainFailure = FailureBase & {
  readonly kind: 'http' | 'network' | 'shape';
  readonly code?: undefined;
};

export type ApiFailure = CodedFailure | PlainFailure;

export type ApiResult<T> =
  | { readonly ok: true; readonly body: T }
  | { readonly ok: false; readonly failure: ApiFailure };

const SHAPE_TEXT = 'the answer has the wrong shape';

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseJson(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return undefined;
  }
}

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.hasOwn(errorTable, value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function failureOf(response: ApiResponse): Promise<ApiFailure> {
  const text = (await response.text()).trim();
  const raw = parseJson(text);
  const message = recordOf(raw)?.message;
  const shown = typeof message === 'string' ? message : text;
  const code = recordOf(raw)?.error;
  const plain: PlainFailure = {
    kind: 'http',
    status: response.status,
    text: shown,
  };
  if (!isErrorCode(code)) return plain;
  const fields = errorTable[code].fields.safeParse(raw);
  if (!fields.success) return plain;
  // The fields were just checked against this code's schema, so the body has the type of the code.
  return {
    ...plain,
    code,
    body: { error: code, ...fields.data },
  } as CodedFailure;
}

async function answerOf<T>(
  response: ApiResponse,
  parser: Parser<T>,
): Promise<ApiResult<T>> {
  const body: unknown = await response.json().catch(() => undefined);
  const parsed = parser.safeParse(body);
  if (parsed.success) return { ok: true, body: parsed.data };
  return {
    ok: false,
    failure: { kind: 'shape', status: response.status, text: SHAPE_TEXT },
  };
}

async function request<T>(
  fetchImpl: FetchLike,
  url: string,
  parser: Parser<T>,
  init?: RequestOptions,
): Promise<ApiResult<T>> {
  let response: ApiResponse;
  try {
    response = init ? await fetchImpl(url, init) : await fetchImpl(url);
  } catch (error) {
    return {
      ok: false,
      failure: { kind: 'network', status: 0, text: messageOf(error) },
    };
  }
  if (!response.ok) return { ok: false, failure: await failureOf(response) };
  return answerOf(response, parser);
}

/** A document is editable only with a value; a Markdown value is an object (`{ data, body }`), as the server sends it. */
function hasEditableValue(doc: DocumentBody): boolean {
  if (!doc.editable) return true;
  if (doc.format === 'md' || doc.format === 'mdx')
    return recordOf(doc.value) !== undefined;
  return doc.value !== undefined;
}

/** The answer of `GET /api/documents?key=`, which the editor can show: an editable document has its value. */
const editorDocumentSchema = documentAnswerSchema.refine(hasEditableValue);

/** `GET /api/overlay`: the working copy against the bundle. */
export function getOverlay(
  fetchImpl: FetchLike,
): Promise<ApiResult<OverlayBody>> {
  return request(fetchImpl, '/api/overlay', overlayAnswerSchema);
}

/** `GET /api/preview-url?path=`: the iframe's URL and the origin of its messages. */
export function getPreviewUrl(
  fetchImpl: FetchLike,
  path: string,
): Promise<ApiResult<PreviewUrlBody>> {
  return request(
    fetchImpl,
    `/api/preview-url?path=${encodeURIComponent(path)}`,
    previewUrlAnswerSchema,
  );
}

/** `GET /api/documents?key=`: one document, with its value when it is editable. */
export function getDocument(
  fetchImpl: FetchLike,
  key: string,
): Promise<ApiResult<DocumentBody>> {
  return request(
    fetchImpl,
    `/api/documents?key=${encodeURIComponent(key)}`,
    editorDocumentSchema,
  );
}

/** `GET /api/changes`: the documents that differ from the merge base, and the broken files. */
export function getChanges(
  fetchImpl: FetchLike,
): Promise<ApiResult<ChangesBody>> {
  return request(fetchImpl, '/api/changes', changesAnswerSchema);
}

/** `GET /api/status`: the bundle, the build and the publish state. */
export function getStatus(
  fetchImpl: FetchLike,
): Promise<ApiResult<StatusAnswerBody>> {
  return request(fetchImpl, '/api/status', statusAnswerSchema);
}

/** `PUT /api/changes`: saves a change list, one entry per document. */
export function saveChanges(
  fetchImpl: FetchLike,
  changes: SaveRequest,
): Promise<ApiResult<SaveBody>> {
  return request(fetchImpl, '/api/changes', saveAnswerSchema, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  });
}

/** `POST /api/publish`: publishes the saved changes as one commit. The route reads no body, but it needs a JSON content type. */
export function publishChanges(
  fetchImpl: FetchLike,
): Promise<ApiResult<PublishBody>> {
  return request(fetchImpl, '/api/publish', publishAnswerSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}

/** `POST /api/media`: stages an image; the answer's `url` is what a document's image field holds. */
export function uploadMedia(
  fetchImpl: FetchLike,
  file: Blob,
): Promise<ApiResult<MediaBody>> {
  return request(fetchImpl, '/api/media', mediaAnswerSchema, {
    method: 'POST',
    headers: { 'Content-Type': file.type },
    body: file,
  });
}

/** Polls `GET /api/status` until the bundle id differs from `from`. Resolves true when it did, and false after `attempts` polls. */
export async function waitForNewBundle(
  fetchImpl: FetchLike,
  from: string | undefined,
  attempts: number,
  pause: (ms: number) => Promise<void> = (ms) =>
    new Promise((done) => setTimeout(done, ms)),
  pauseMs = 1000,
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    await pause(pauseMs);
    const status = await getStatus(fetchImpl);
    const id = status.ok ? status.body.bundle?.bundleId : undefined;
    if (id !== undefined && id !== from) return true;
  }
  return false;
}
