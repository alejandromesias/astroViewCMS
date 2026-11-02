/** The text for a value that was thrown. Any value can be thrown (`throw null`,
 *  a string, a plain object), so this never assumes an Error and never throws:
 *  an Error gives its `message`, a string is itself, anything else its
 *  `String()` text. A value whose text cannot be made (a `toString` that throws,
 *  or no prototype) gives a fixed text. */
export function errorMessage(error: unknown): string {
  try {
    if (error instanceof Error) return error.message;
    return typeof error === 'string' ? error : String(error);
  } catch {
    return 'unknown error (the thrown value has no text form)';
  }
}
