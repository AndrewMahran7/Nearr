/**
 * Durable, account-scoped image storage for saved-place presentation.
 *
 * The database keeps the provider identity. This store keeps only the first
 * successfully acquired presentation image on this device so normal saved
 * opens are both visual and provider-call free.
 */

export type SavedPlaceImageFileInfo = {
  exists: boolean;
  isDirectory?: boolean;
  size?: number;
};

export type SavedPlaceImageStoreDependencies = {
  documentDirectory: string | null;
  cacheDirectory: string | null;
  getInfo(uri: string): Promise<SavedPlaceImageFileInfo>;
  makeDirectory(uri: string): Promise<void>;
  download(remoteUri: string, localUri: string): Promise<{ uri: string; status?: number }>;
  copy(from: string, to: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  remove(uri: string): Promise<void>;
};

function productionDependencies(): SavedPlaceImageStoreDependencies {
  // Lazy resolution keeps the policy and failure behavior executable in Node.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('expo-file-system') as typeof import('expo-file-system');
  return {
    documentDirectory: fs.documentDirectory,
    cacheDirectory: fs.cacheDirectory,
    getInfo: (uri) => fs.getInfoAsync(uri),
    makeDirectory: (uri) => fs.makeDirectoryAsync(uri, { intermediates: true }),
    download: (remoteUri, localUri) => fs.downloadAsync(remoteUri, localUri),
    copy: (from, to) => fs.copyAsync({ from, to }),
    move: (from, to) => fs.moveAsync({ from, to }),
    remove: (uri) => fs.deleteAsync(uri, { idempotent: true }),
  };
}

function segment(value: string): string {
  return encodeURIComponent(value.trim());
}

function rootUri(documentDirectory: string): string {
  return `${documentDirectory}nearr/saved-place-images/`;
}

export function savedPlaceImageDirectory(
  documentDirectory: string,
  userId: string,
  savedPlaceId?: string,
): string {
  const owner = `${rootUri(documentDirectory)}${segment(userId)}/`;
  return savedPlaceId ? `${owner}${segment(savedPlaceId)}/` : owner;
}

export function savedPlaceImageUri(
  documentDirectory: string,
  userId: string,
  savedPlaceId: string,
): string {
  return `${savedPlaceImageDirectory(documentDirectory, userId, savedPlaceId)}hero.jpg`;
}

const inFlight = new Map<string, Promise<string | null>>();
const acquisitionInFlight = new Map<string, Promise<string | null>>();

function stableImageKey(value: string): string {
  // FNV-1a is sufficient for a private cache filename; provider identity and
  // credentials never appear in the path or snapshot.
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Materialize a remote presentation image once in the evictable cache. Active
 * UI and save-time persistence share this promise, preventing duplicate photo
 * downloads when the user saves an image that is currently being displayed.
 */
export async function acquirePlacePresentationImage(
  sourceUri: string | null | undefined,
  dependencies: SavedPlaceImageStoreDependencies = productionDependencies(),
): Promise<string | null> {
  const source = sourceUri?.trim();
  if (!source) return null;
  if (source.startsWith('file://')) {
    return await isUsableSavedPlaceImage(source, dependencies) ? source : null;
  }
  if (!/^https?:\/\//i.test(source) || !dependencies.cacheDirectory) return null;
  const directory = `${dependencies.cacheDirectory}nearr/place-presentation/`;
  const destination = `${directory}${stableImageKey(source)}.jpg`;
  if (await isUsableSavedPlaceImage(destination, dependencies)) return destination;
  const existing = acquisitionInFlight.get(destination);
  if (existing) return existing;
  const request = (async () => {
    const temporary = `${destination}.pending`;
    try {
      await dependencies.makeDirectory(directory);
      await dependencies.remove(temporary).catch(() => undefined);
      const result = await dependencies.download(source, temporary);
      if (result.status != null && (result.status < 200 || result.status >= 300)) {
        throw new Error(`image_download_http_${result.status}`);
      }
      if (!await isUsableSavedPlaceImage(temporary, dependencies)) return null;
      await dependencies.remove(destination).catch(() => undefined);
      await dependencies.move(temporary, destination);
      return await isUsableSavedPlaceImage(destination, dependencies) ? destination : null;
    } catch {
      await dependencies.remove(temporary).catch(() => undefined);
      return null;
    }
  })().finally(() => acquisitionInFlight.delete(destination));
  acquisitionInFlight.set(destination, request);
  return request;
}

export async function isUsableSavedPlaceImage(
  uri: string | null | undefined,
  dependencies: SavedPlaceImageStoreDependencies = productionDependencies(),
): Promise<boolean> {
  if (!uri?.startsWith('file://')) return false;
  try {
    const info = await dependencies.getInfo(uri);
    return info.exists && !info.isDirectory && (info.size == null || info.size > 0);
  } catch {
    return false;
  }
}

/**
 * Persist an image already selected for presentation. Failure is deliberately
 * non-fatal: the durable save has already succeeded and must remain usable.
 */
export async function persistSavedPlaceImage(
  args: { userId: string; savedPlaceId: string; sourceUri: string | null | undefined },
  dependencies: SavedPlaceImageStoreDependencies = productionDependencies(),
): Promise<string | null> {
  const sourceUri = args.sourceUri?.trim();
  const documentDirectory = dependencies.documentDirectory;
  if (!sourceUri || !documentDirectory) return null;

  const destination = savedPlaceImageUri(documentDirectory, args.userId, args.savedPlaceId);
  if (sourceUri === destination && await isUsableSavedPlaceImage(destination, dependencies)) {
    return destination;
  }
  const existing = inFlight.get(destination);
  if (existing) return existing;

  const request = (async () => {
    const directory = savedPlaceImageDirectory(documentDirectory, args.userId, args.savedPlaceId);
    const temporary = `${directory}hero.pending`;
    try {
      await dependencies.makeDirectory(directory);
      await dependencies.remove(temporary).catch(() => undefined);
      if (sourceUri.startsWith('file://')) {
        await dependencies.copy(sourceUri, temporary);
      } else if (/^https?:\/\//i.test(sourceUri)) {
        const acquired = await acquirePlacePresentationImage(sourceUri, dependencies);
        if (acquired) {
          await dependencies.copy(acquired, temporary);
        } else {
          throw new Error('image_acquisition_failed');
        }
      } else {
        return null;
      }
      if (!await isUsableSavedPlaceImage(temporary, dependencies)) {
        throw new Error('image_download_empty');
      }
      await dependencies.remove(destination).catch(() => undefined);
      await dependencies.move(temporary, destination);
      return await isUsableSavedPlaceImage(destination, dependencies) ? destination : null;
    } catch (error) {
      await dependencies.remove(temporary).catch(() => undefined);
      console.warn('[saved-place-image] persistence failed', {
        savedPlaceId: args.savedPlaceId,
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  })().finally(() => {
    inFlight.delete(destination);
  });
  inFlight.set(destination, request);
  return request;
}

export async function removeSavedPlaceImage(
  userId: string,
  savedPlaceId: string,
  dependencies: SavedPlaceImageStoreDependencies = productionDependencies(),
): Promise<void> {
  if (!dependencies.documentDirectory) return;
  await dependencies.remove(savedPlaceImageDirectory(
    dependencies.documentDirectory,
    userId,
    savedPlaceId,
  )).catch(() => undefined);
}

export async function clearSavedPlaceImages(
  userId: string | null | undefined,
  dependencies: SavedPlaceImageStoreDependencies = productionDependencies(),
): Promise<void> {
  if (!userId || !dependencies.documentDirectory) return;
  await dependencies.remove(savedPlaceImageDirectory(
    dependencies.documentDirectory,
    userId,
  )).catch(() => undefined);
}

export function resetSavedPlaceImageStoreForTests(): void {
  inFlight.clear();
  acquisitionInFlight.clear();
}
