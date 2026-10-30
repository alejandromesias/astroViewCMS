# Implementation recommendations

Rules for writing production code in this repo. Each one comes from a real bug or weak spot that mutation testing found. The details and the original cases are in `DOCS/MUTATION-WEAK-SPOTS.md`.

## 1. Treat every key from content or config as hostile

Content keys, JSON keys, specifiers, language codes and media refs all come from user files. A plain object lookup with such a key also finds `Object.prototype` members (`constructor`, `toString`, `__proto__`).

- To look up a key that came from a user, use a `Map`, `Object.hasOwn(table, key)` or a table made with `Object.create(null)`. Never use `table[key] ?? fallback` on a plain object literal.
- To build an object from user keys, use `Object.fromEntries(...)`, not `obj[key] = value`. Assigning to `__proto__` replaces the prototype, and the entry does not appear in the object.
- Cases already fixed: `languages.ts` aliases, `dev/documents.ts` `entryOf`, `content-api.ts` `resolveImage`, `render/envelope.ts` media map, `render/islands.ts` entry modules.

## 2. Validate the shape of anything you read

`JSON.parse` returns `any`, and a `as T` cast checks nothing. Generated manifests, `tsconfig.json`, content files and server responses can all have a missing key, a `null` or the wrong type.

- Check the type before you use the value, for example `Array.isArray(x) ? new Set(x) : undefined`. `new Set("en")` is a set of characters. `new Set(undefined)` is an empty set, which may mean the opposite of "no setting".
- Keep "missing" separate from "empty" when they mean different things.
- At a trust boundary (the render envelope, a request body, a tenant config), use a Zod schema. For internal build output a narrow type check is enough.
- Do not call `String()` on a value that may be missing before you compare it. `String(undefined) === "undefined"` matches a real key.

## 3. Check hand-kept lists against the full input space

A list such as the `RESERVED` words in `overlay/plugins.ts` was missing 11 JS reserved words. A JSON key named `public` produced `export const public`, which broke the preview.

- When a list must be complete (reserved words, MIME types, tag names), copy it from the spec and link the source in a comment.
- Prefer a check that cannot be incomplete. For example, try the identifier with the parser, or always quote the key.
- Test the list with real data, not only with the cases you thought of.

## 4. Text-processing code must know about strings

Code that strips comments, trailing commas or whitespace from source or JSON also changes the same characters inside string literals. The `stripJsonComments` trailing-comma regex did this.

- For every text-cleaning function, ask: "what if this is inside a string?"
- Scan character by character and skip over string literals, as `dropTrailingCommas` does. A single regex cannot track this state.
- Keep regexes simple and anchored. A short regex is easy to read and leaves fewer surviving mutants.

## 5. Write code whose behaviour can be observed

Mutation testing showed that some code cannot be checked by any test. For example, a guard whose skipped branch gives the same result, or a log line nobody can see.

- A guard should change something visible: the return value, a call that is skipped, or an error thrown.
- Use dependency injection (`readSource`, `fetch`, a clock) for I/O and time, but keep the real default as the default parameter value so that it can be tested too.
- Return values or throw errors with exact messages instead of only writing to the log. If a log line matters, its arguments are part of the contract.
- Values computed once at module load (static constants) are hard to test under the Vitest runner. Keep logic out of module-level code where you can.

## 6. Before you finish a feature

- [ ] Every lookup with a user-supplied key uses `Map`, `Object.hasOwn` or `Object.fromEntries`.
- [ ] Every value from `JSON.parse` or the network has its type checked before use.
- [ ] Hand-kept lists are complete, or are replaced by a check that cannot be incomplete.
- [ ] Text scanners skip string literals.
- [ ] Each guard and branch has an effect a test can see.
- [ ] Injected dependencies keep a real default.

Open design questions that are not rules yet: cancelling superseded bridge requests with `AbortController`, a timeout on render requests, and the noisy `[preview-bridge] patched` log.
