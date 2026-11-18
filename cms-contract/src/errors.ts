// The error codes of the CMS API (PHASE-2-DESIGN 5.9). One table holds each code with its HTTP status and the fields its
// body adds beside `error`. Routes and the save and publish stages build every error answer with `apiError`, which takes
// only a code of this table, so a code that is not in the union does not compile. Plain-text answers (media, the cross-site
// refusal) are not in the table: they carry no code.
import { z } from 'zod';
import {
  conflictingDocumentSchema,
  planRefusalFieldsSchema,
  validationIssueSchema,
} from './shapes.ts';

const messageFields = z.object({ message: z.string() });
const noFields = z.object({});

export const errorTable = {
  misdirected: { status: 421, fields: messageFields },
  // A write whose Origin header is not the CMS's origin (2.14e; http/guard.ts).
  'cross-origin': { status: 403, fields: messageFields },
  not_found: { status: 404, fields: noFields },
  'missing-query': { status: 400, fields: messageFields },
  'unknown-collection': { status: 404, fields: messageFields },
  'unknown-document': { status: 404, fields: messageFields },
  'document-missing': { status: 404, fields: messageFields },
  'invalid-path': { status: 400, fields: messageFields },
  'body-too-large': { status: 413, fields: messageFields },
  'invalid-body': { status: 400, fields: messageFields },
  'no-bundle': { status: 503, fields: noFields },
  'bundle-invalid': { status: 500, fields: messageFields },
  'changes-unavailable': { status: 500, fields: messageFields },
  busy: { status: 503, fields: messageFields },
  'preview-unavailable': { status: 503, fields: messageFields },
  'reference-index-failed': { status: 500, fields: messageFields },
  'save-failed': { status: 500, fields: messageFields },
  'save-committed': { status: 500, fields: messageFields },
  conflict: {
    status: 409,
    fields: z.object({
      documents: z.array(conflictingDocumentSchema).readonly(),
    }),
  },
  'referenced-by': {
    status: 409,
    fields: z.object({
      document: z.string(),
      referrers: z.array(z.string()).readonly(),
      needsDeveloper: z.literal(true).optional(),
    }),
  },
  invalid: {
    status: 422,
    fields: z.object({ errors: z.array(validationIssueSchema).readonly() }),
  },
  // The refusals of one write plan (documents/plan-write.ts), one code each.
  'duplicate-key': { status: 400, fields: planRefusalFieldsSchema },
  'outside-site': { status: 400, fields: planRefusalFieldsSchema },
  'pattern-mismatch': { status: 400, fields: planRefusalFieldsSchema },
  exists: { status: 409, fields: planRefusalFieldsSchema },
  'file-missing': { status: 409, fields: planRefusalFieldsSchema },
  'read-only': { status: 422, fields: planRefusalFieldsSchema },
  unwritable: { status: 422, fields: planRefusalFieldsSchema },
  unreadable: { status: 422, fields: planRefusalFieldsSchema },
  // POST /api/publish (PHASE-2-DESIGN 4.2, 5.9).
  'build-in-progress': { status: 503, fields: messageFields },
  'upstream-changed': { status: 503, fields: messageFields },
  'sync-failed': { status: 502, fields: messageFields },
  'push-failed': { status: 502, fields: messageFields },
  'push-rejected': { status: 502, fields: messageFields },
  'publish-failed': { status: 500, fields: messageFields },
  'publish-in-progress': { status: 409, fields: messageFields },
  'remote-moved': { status: 409, fields: messageFields },
  'build-failed': {
    status: 424,
    fields: z.object({ message: z.string(), firstError: z.string() }),
  },
  // Answered by the server itself, outside the routes (server.ts).
  internal_error: { status: 500, fields: noFields },
} as const;

/** Every error code the API answers. */
export type ErrorCode = keyof typeof errorTable;

/** The HTTP status of an error code. */
export type ErrorStatus<C extends ErrorCode = ErrorCode> =
  (typeof errorTable)[C]['status'];

/** The fields an error code's body adds beside `error`. */
export type ErrorFields<C extends ErrorCode = ErrorCode> = z.infer<
  (typeof errorTable)[C]['fields']
>;

/** The body of an error answer: `error` names the code, and the fields follow. */
export type ErrorBody<C extends ErrorCode = ErrorCode> = {
  readonly error: C;
} & ErrorFields<C>;

/** An error answer: the status and the body of a code. Without an argument, any code of the table. */
export interface ApiError<C extends ErrorCode = ErrorCode> {
  readonly status: ErrorStatus<C>;
  readonly body: ErrorBody<C>;
}

/** The one way a route or a stage builds an error answer. Only a code of the table compiles. */
export function apiError<C extends ErrorCode>(
  code: C,
  fields: ErrorFields<C>,
): ApiError<C> {
  return {
    status: errorTable[code].status,
    body: { error: code, ...fields },
  };
}
