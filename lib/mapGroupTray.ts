export const MAP_GROUP_TRAY_CLOSE_TARGET_SIZE = 44;
export const MAP_GROUP_TRAY_CLOSE_HIT_SLOP = 4;
export const MAP_GROUP_TRAY_OVERLAY_Z_INDEX = 40;
export const MAP_GROUP_TRAY_OVERLAY_ELEVATION = 20;

export function mapGroupTrayUsableWidth(viewportWidth: number): number {
  // The map owns a 12pt outer inset and the tray header owns 12pt per side.
  return Math.max(0, viewportWidth - (12 * 2) - (12 * 2));
}
