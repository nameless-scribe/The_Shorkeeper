const mutationTails = new Map<string, Promise<void>>();

/**
 * Serialize filesystem/database mutations for one managed knowledge document.
 * The queue keeps failures local to their caller and releases keys after the
 * last scheduled mutation settles.
 */
export function runDocumentMutation<T>(
  documentId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = mutationTails.get(documentId) ?? Promise.resolve();
  const run = previous.then(operation, operation);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  mutationTails.set(documentId, tail);
  void tail.then(() => {
    if (mutationTails.get(documentId) === tail) mutationTails.delete(documentId);
  });
  return run;
}
