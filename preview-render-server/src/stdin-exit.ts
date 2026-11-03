// Ends the preview node when its stdin closes (WORKPLAN 2.1i). cms-server keeps a pipe open to the node,
// so when cms-server dies the pipe closes and the node exits with it. Windows never delivers SIGTERM to a
// killed process, so this is the only way the node leaves with its parent.
import type { Readable } from 'node:stream';

/** Calls `exit` once when `stdin` ends or fails. The stream is resumed, so that it can end while nothing reads it. */
export function exitWhenStdinCloses(stdin: Readable, exit: () => void): void {
  stdin.once('end', exit);
  stdin.once('error', exit);
  stdin.resume();
}
