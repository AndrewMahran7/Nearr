export type AsyncValueCache<T> = ((key: string) => Promise<T | null>) & {
  /** Drop a cached entry so the next read refetches. Safe for unknown keys. */
  invalidate: (key: string) => void;
};

export function createAsyncValueCache<T>(
  load: (key: string) => Promise<T | null>,
  onError?: (key: string, error: unknown) => void,
): AsyncValueCache<T> {
  const values = new Map<string, T | null>();
  const inFlight = new Map<string, Promise<T | null>>();

  const read = async (key: string): Promise<T | null> => {
    if (values.has(key)) return values.get(key) ?? null;

    const existingRequest = inFlight.get(key);
    if (existingRequest) return existingRequest;

    const request = load(key)
      .catch((error) => {
        onError?.(key, error);
        return null;
      })
      .then((value) => {
        values.set(key, value);
        return value;
      })
      .finally(() => {
        inFlight.delete(key);
      });

    inFlight.set(key, request);
    return request;
  };

  read.invalidate = (key: string) => {
    values.delete(key);
    inFlight.delete(key);
  };

  return read as AsyncValueCache<T>;
}