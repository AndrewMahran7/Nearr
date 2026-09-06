export const PLACE_BROWSE_MAX_RENDER_BATCH = 5;

export function carouselIndexForSelection<T extends { id: string }>(
  items: readonly T[],
  selectedId: string | null | undefined,
): number {
  if (items.length === 0) return -1;
  const index = selectedId ? items.findIndex((item) => item.id === selectedId) : -1;
  return index >= 0 ? index : 0;
}

export function carouselIndexFromOffset(
  offsetX: number,
  snapInterval: number,
  itemCount: number,
): number {
  if (itemCount <= 0 || !Number.isFinite(snapInterval) || snapInterval <= 0) return -1;
  return Math.max(0, Math.min(itemCount - 1, Math.round(Math.max(0, offsetX) / snapInterval)));
}

/** A deterministic proof of the bounded window used by the virtualized carousel. */
export function carouselRenderWindow(
  itemCount: number,
  activeIndex: number,
  maxItems = PLACE_BROWSE_MAX_RENDER_BATCH,
): { first: number; last: number; count: number } {
  const total = Math.max(0, Math.floor(itemCount));
  if (total === 0) return { first: -1, last: -1, count: 0 };
  const count = Math.min(total, Math.max(1, Math.floor(maxItems)));
  const active = Math.max(0, Math.min(total - 1, Math.floor(activeIndex)));
  const first = Math.max(0, Math.min(total - count, active - Math.floor(count / 2)));
  return { first, last: first + count - 1, count };
}
