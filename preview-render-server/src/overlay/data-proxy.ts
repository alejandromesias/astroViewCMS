// JSON data modules (`src/config/menu.json` and the like) as the preview build
// serves them (WORKPLAN task 1.4): the default export, and each object-valued
// named export, is a Proxy that reads the request's overlay document
// `data:<path>` when there is one, else the built value. Every read goes into
// the read log.
import { currentOverlay, hasDocument } from './context.ts';

/** `built` is the whole file (default export) or one top-level value (a named
 *  export, `pick` being its name). */
export function proxyData<T extends object>(key: string, built: T, pick?: string): T {
  const current = (): object => {
    const context = currentOverlay();
    if (!context) return built;
    context.reads.add(key);
    if (!hasDocument(context, key)) return built;
    const draft = context.documents[key];
    const value = pick === undefined ? draft : (draft as Record<string, unknown> | null | undefined)?.[pick];
    return typeof value === 'object' && value !== null ? value : built;
  };
  return new Proxy(built, {
    get: (_, property) => Reflect.get(current(), property),
    has: (_, property) => Reflect.has(current(), property),
    ownKeys: () => Reflect.ownKeys(current()),
    getOwnPropertyDescriptor: (_, property) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(current(), property);
      // The proxy's target is the built value: report everything as
      // configurable so keys that only the draft has are allowed.
      return descriptor && { ...descriptor, configurable: true };
    },
  });
}
