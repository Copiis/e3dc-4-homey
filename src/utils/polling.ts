/**
 * Simple polling helper for debounce.
 */
export function withDebounce(fn: () => void, minIntervalMs: number) {
  let last = 0;
  return () => {
    const now = Date.now();
    if (now - last < minIntervalMs) return;
    last = now;
    fn();
  };
}
