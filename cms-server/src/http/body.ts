// The only way a route reads a request body (2.7a gaps). The bytes are counted as they
// arrive and the read stops at the cap, so an oversized upload is never held in full.

export class BodyTooLargeError extends Error {
  constructor(limit: number) {
    super(`Body is larger than ${limit} bytes`);
    this.name = 'BodyTooLargeError';
  }
}

/** Reads the whole body, or throws BodyTooLargeError as soon as it passes `maxBytes`. */
export async function readBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > maxBytes) {
    await request.body?.cancel();
    throw new BodyTooLargeError(maxBytes);
  }
  if (request.body === null) return new Uint8Array(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new BodyTooLargeError(maxBytes);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
