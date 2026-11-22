# Implementation recommendations

Rules for writing production code in this repo. Each one comes from a real bug or weak spot that mutation testing found. The details and the original cases are in `DOCS/Historic/MUTATION-WEAK-SPOTS.md`.

## 1. Treat every key from content or config as hostile

Content keys, JSON keys, specifiers, language codes and media refs all come from user files. A plain object lookup with such a key also finds `Object.prototype` members (`constructor`, `toString`, `__proto__`).

- To look up a key that came from a user, use a `Map`, `Object.hasOwn(table, key)` or a table made with `Object.create(null)`. Never use `table[key] ?? fallback` on a plain object literal.
- To build an object from user keys, use `Object.fromEntries(...)`, not `obj[key] = value`. Assigning to `__proto__` replaces the prototype, and the entry does not appear in the object.
- Cases already fixed: `languages.ts` aliases, `dev/documents.ts` `entryOf` (file removed in 2.12a), `content-api.ts` `resolveImage`, `render/envelope.ts` media map, `render/islands.ts` entry modules.

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

## 6. Identify and treat secrets

A review of the stderr forwarder (2.14a-3) found that the preview node holds `PREVIEW_TOKEN_SECRET` and `PREVIEW_INTERNAL_SECRET` in its environment, and that new code wrote its output to a log file verbatim. The log's own redaction only knows URL credentials (`://user:pass@`, `redact` in `git/exec.ts`), so it would not have caught either value. The rule: any new path that writes text you did not build yourself to a log, an error message, a response or a file is a path a secret can leave through.

**Identify.** A value is a secret if leaking it lets someone act as the CMS or the user. Check three places:
- The settings: every field of `secrets` in the config, and any value read from the environment under a name with `TOKEN`, `SECRET`, `KEY`, `PASSWORD` or `CREDENTIAL`.
- What you pass to a child process: read `childEnvironment` (`preview/supervisor.ts`) for the exact set. Whatever you put in a child's environment, the child can print.
- Text that carries one: a remote URL with credentials, an `Authorization` header, a cookie, a git error that echoes its arguments.

**Treat.**
- Redact by value, not by pattern. For a secret you hold, replace every occurrence of the value (`replaceAll`, skipping an empty value) with `***`. A regex guesses at the shape and misses a value that has none.
- Redact before you cut. If the text is truncated (a line cap, a tail buffer), redact the full text and cut after, or hold back the longest secret length less one character. Cutting first can leave a prefix of the secret in the output.
- Redact at the point where the text leaves your code (the logger call, the error constructor, the response writer), not at the source. A new writer then has to redact too, and a test can show it does.
- Redact text that crosses chunk boundaries after you have joined it: a secret can arrive in two reads.
- Do not log, return or serialize a secret itself. Log that it is set, or its length, never its value. Never put one in a URL, a query string or a file in the repo, and never in the output of a test that CI keeps.
- Pass a secret to a child only if the child needs it, and say in a comment why.

**Test.** For each writer that handles text you did not build: one test where the text contains each secret and the output does not, one where a secret is split across two chunks or sits across the cut, and one for the empty value. The test must use a value that does not occur in its other fixtures (a test string of `'a'` characters matched a token made of `'a'` characters and was redacted by mistake).

## 7. Before you finish a feature

- [ ] Every lookup with a user-supplied key uses `Map`, `Object.hasOwn` or `Object.fromEntries`.
- [ ] Every value from `JSON.parse` or the network has its type checked before use.
- [ ] Hand-kept lists are complete, or are replaced by a check that cannot be incomplete.
- [ ] Text scanners skip string literals.
- [ ] Each guard and branch has an effect a test can see.
- [ ] Injected dependencies keep a real default.
- [ ] Every writer of text you did not build (log, error, response, file) redacts each secret value, after joining chunks and before cutting, and has a test for it.

## 8. How to run a task

Before you start, read [DOCS/README.md](../README.md) section 2 (working rules: one branch and worktree per task, pull request, merge commit, push rarely, watching the pipeline, no local Stryker) and [CI-PIPELINE.md](CI-PIPELINE.md) (the checks and how to read them). They are the source of truth; this file does not repeat them.

**Watch every pull request you open.** After you generate a PR, or review a subagent's result for one, call `link_pull_request` with its full URL, then `watch_pull_request`. Keep it watched until it fails, has a review comment, or is ready to merge, and act on that event. Call `unwatch_pull_request` before you hand back. Subagents do not watch; the agent that owns the PR does.

Open design questions that are not rules yet: cancelling superseded bridge requests with `AbortController`, a timeout on render requests, and the noisy `[preview-bridge] patched` log.
