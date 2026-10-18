/**
 * Building a PDF takes about half a second of processor time, and the work cannot be interrupted, so thirty at once freeze the
 * whole server for ten seconds (including people saving exam answers). This runs them one at a time and gives every other
 * request a turn between two PDFs, so the worst pause is one PDF, not all of them.
 */
let tail: Promise<unknown> = Promise.resolve();

export function renderSerially<T>(work: () => Promise<T>): Promise<T> {
  const run = tail.then(() => new Promise<void>((r) => setImmediate(r))).then(work);
  tail = run.catch(() => undefined);
  return run;
}
