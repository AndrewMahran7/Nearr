export type LayoutRect = { x: number; y: number; width: number; height: number };

export function rectRight(rect: LayoutRect): number {
  return rect.x + Math.max(0, rect.width);
}

export function rectBottom(rect: LayoutRect): number {
  return rect.y + Math.max(0, rect.height);
}

export function rectsIntersect(left: LayoutRect, right: LayoutRect): boolean {
  return left.x < rectRight(right)
    && rectRight(left) > right.x
    && left.y < rectBottom(right)
    && rectBottom(left) > right.y;
}

export function rectContains(
  outer: LayoutRect,
  inner: LayoutRect,
  minimumInset = 0,
): boolean {
  const inset = Math.max(0, minimumInset);
  return inner.x >= outer.x + inset
    && inner.y >= outer.y + inset
    && rectRight(inner) <= rectRight(outer) - inset
    && rectBottom(inner) <= rectBottom(outer) - inset;
}

export const IOS_SWITCH_VISUAL_WIDTH = 51;
export const IOS_SWITCH_VISUAL_HEIGHT = 31;
export const REMINDER_SWITCH_TRAILING_CLEARANCE = 8;
export const REMINDER_SWITCH_SLOT_WIDTH =
  IOS_SWITCH_VISUAL_WIDTH + REMINDER_SWITCH_TRAILING_CLEARANCE * 2;
