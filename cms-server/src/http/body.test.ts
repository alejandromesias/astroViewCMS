import { describe, expect, it } from 'vitest';
import { BodyTooLargeError, readBody } from './body.ts';

const URL = 'http://cms.localhost:4400/api/media';

// A body of `count` chunks of `size` bytes, pulled only when read (highWaterMark 0),
// so `pulled` shows how much of it readBody actually took.
function countedBody(count: number, size: number) {
  const state = { pulled: 0 };
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (state.pulled === count) {
          controller.close();
          return;
        }
        state.pulled += 1;
        controller.enqueue(new Uint8Array(size));
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, state };
}

const streamRequest = (
  stream: ReadableStream<Uint8Array>,
  headers: Record<string, string> = {},
) =>
  new Request(URL, {
    method: 'POST',
    body: stream,
    duplex: 'half',
    headers,
  } as RequestInit);

describe('readBody', () => {
  it('returns the bytes of a body without a declared length', async () => {
    const request = new Request(URL, { method: 'POST', body: 'hello' });
    expect(Buffer.from(await readBody(request, 10)).toString()).toBe('hello');
  });

  it('returns no bytes when the request has no body', async () => {
    const request = new Request(URL, { method: 'GET' });
    expect((await readBody(request, 10)).byteLength).toBe(0);
  });

  it('accepts a body of exactly the cap', async () => {
    const { stream } = countedBody(2, 5);
    expect((await readBody(streamRequest(stream), 10)).byteLength).toBe(10);
  });

  it('refuses one byte over the cap and stops reading at the chunk that passes it', async () => {
    const { stream, state } = countedBody(5, 4);
    await expect(readBody(streamRequest(stream), 10)).rejects.toMatchObject({
      name: 'BodyTooLargeError',
      message: 'Body is larger than 10 bytes',
    });
    // Chunks of 4: 4 and 8 fit, the third makes 12 and is never followed by a fourth pull.
    expect(state.pulled).toBe(3);
  });

  it('refuses a declared length over the cap without reading the body', async () => {
    const { stream, state } = countedBody(1, 4);
    await expect(
      readBody(streamRequest(stream, { 'content-length': '11' }), 10),
    ).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(state.pulled).toBe(0);
  });

  it('passes a read error through, such as a client that disconnects', async () => {
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          if (pulls === 1) {
            controller.enqueue(new Uint8Array(3));
          } else {
            controller.error(new Error('client went away'));
          }
        },
      },
      { highWaterMark: 0 },
    );
    await expect(readBody(streamRequest(stream), 10)).rejects.toThrow(
      new Error('client went away'),
    );
  });
});
