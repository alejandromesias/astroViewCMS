// The result of a push (WORKPLAN 2.10d, PHASE-2-DESIGN 4.2). A push is rejected for one reason that a retry can fix: the
// remote branch moved, so the commit is not a fast-forward. Every other failure (sign-in, network, a hook that declines)
// will fail the same way again, so it is not retried.

/** What `tx.push` found: pushed; or not pushed, with `race` true when the remote moved, and a redacted message of what git said. */
export type PushResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly race: boolean; readonly message: string };

// git's refusal of a non-fast-forward push, in the English wording (`runGit` sets LC_ALL=C):
//   ` ! [rejected]        <sha> -> main (fetch first)` or `(non-fast-forward)`.
// `[remote rejected]` is a hook or a protected branch, not a race, so the brackets are part of the pattern.
const RACE = /\[rejected\]|non-fast-forward|fetch first/;

/** True when `stderr` of a failed `git push` says the remote branch moved, so syncing and pushing again can succeed. */
export function isPushRace(stderr: string): boolean {
  return RACE.test(stderr);
}
