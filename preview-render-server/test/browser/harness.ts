// The editor side of the browser suite, run in the harness page (the Vitest
// origin, cross-origin to the preview as in the product). It opens a preview in
// an iframe, sends it drafts with the protocol of preview-protocol, and reads
// what it answers. DOM reads of the preview go through the custom commands.
import {
  type DraftMessage,
  isPageMessage,
  type MediaInfo,
  type PageMessage,
  PROTOCOL_VERSION,
} from 'preview-protocol';
import { inject, vi } from 'vitest';
import { commands } from 'vitest/browser';

declare module 'vitest/browser' {
  interface BrowserCommands {
    previewEval: (expression: string) => Promise<unknown>;
    delayRenders: (ms: number) => Promise<void>;
    blockImages: () => Promise<void>;
    openForeignEditor: (previewUrl: string) => Promise<void>;
    foreignPost: (previewOrigin: string, message: unknown) => Promise<void>;
    foreignReceived: () => Promise<Array<{ origin: string; type: string }>>;
    foreignEval: (expression: string) => Promise<unknown>;
    closeForeignEditor: () => Promise<void>;
  }
}

const WAIT = { timeout: 15_000, interval: 50 };

export interface Preview {
  /** Every message the preview sent to this page, in order. */
  readonly messages: PageMessage[];
  /** The preview's origin (the iframe's, not the harness's). */
  readonly origin: string;
  /** Sends the whole overlay; resolves with the answer (rendered or error). */
  draft(
    documents: Record<string, unknown>,
    media?: Record<string, MediaInfo>,
  ): Promise<PageMessage>;
  /** Sends the overlay without waiting for an answer. */
  post(
    documents: Record<string, unknown>,
    media?: Record<string, MediaInfo>,
  ): void;
  /** Runs an expression in the preview frame and returns its value. */
  eval<T>(expression: string): Promise<T>;
  /** Waits until the preview has sent a message of this type after `since` (a count). */
  answer(since: number): Promise<PageMessage>;
  /** Removes the iframe and the listener. */
  close(): void;
}

const count = (messages: PageMessage[], type: PageMessage['type']) =>
  messages.filter((m) => m.type === type).length;

/** Opens `path` of the preview in an iframe and resolves once the first load has announced itself (two `ready`s). */
export async function openPreview(path: string): Promise<Preview> {
  const base = inject('baseUrl');
  const origin = new URL(base).origin;
  const iframe = document.createElement('iframe');
  iframe.name = 'preview';
  // Big enough that client:visible islands can scroll into view.
  iframe.width = '1024';
  iframe.height = '768';
  iframe.src = `${base}${path}`;
  document.body.append(iframe);

  const messages: PageMessage[] = [];
  const onMessage = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow) return;
    if (isPageMessage(event.data)) messages.push(event.data);
  };
  window.addEventListener('message', onMessage);

  const preview: Preview = {
    messages,
    origin,
    async draft(documents, media = {}) {
      const before = messages.length;
      preview.post(documents, media);
      return preview.answer(before);
    },
    post(documents, media = {}) {
      const message: DraftMessage = {
        type: 'preview:draft',
        protocol: PROTOCOL_VERSION,
        documents,
        media,
      };
      iframe.contentWindow?.postMessage(message, origin);
    },
    async eval<T>(expression: string) {
      return (await commands.previewEval(expression)) as T;
    },
    async answer(since) {
      await vi.waitFor(() => {
        if (!messages.slice(since).some((m) => m.type !== 'preview:ready'))
          throw new Error('no answer yet');
      }, WAIT);
      // biome-ignore lint/style/noNonNullAssertion: the wait above found one
      return messages.slice(since).find((m) => m.type !== 'preview:ready')!;
    },
    close() {
      window.removeEventListener('message', onMessage);
      iframe.remove();
    },
  };

  // A first load announces `ready` twice (astro:page-load fires on it too, see
  // priming.browser.test.ts). A draft that lands between the two is dropped by
  // the bridge, so wait for both before the first draft.
  await vi.waitFor(() => {
    if (count(messages, 'preview:ready') < 2)
      throw new Error('not settled yet');
  }, WAIT);
  return preview;
}

/** Waits until `check` (which reads the preview) is true. */
export async function waitUntil(check: () => Promise<boolean>): Promise<void> {
  await vi.waitFor(async () => {
    if (!(await check())) throw new Error('not yet');
  }, WAIT);
}

/** A file of the sample site's content folder, parsed. */
export async function sampleContent<T>(file: string): Promise<T> {
  return JSON.parse(
    await commands.readFile(`../sample-site/src/content/${file}`),
  ) as T;
}
