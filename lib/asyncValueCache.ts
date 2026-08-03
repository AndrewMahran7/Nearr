export function createAsyncValueCache<T>(
  load: (key: string) => Promise<T | null>,
  onError?: (key: string, error: unknown) => void,
) {
  const values = new Map<string, T | null>();
  const inFlight = new Map<string, Promise<T | null>>();

  return async (key: string): Promise<T | null> => {
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
}