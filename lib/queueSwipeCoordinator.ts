/** Single-open-row coordination for queue swipe actions. */

export type SwipeRowCloser = () => void;

export type QueueSwipeCoordinator = {
  open: (rowId: string, close: SwipeRowCloser) => void;
  closed: (rowId: string) => void;
  unregister: (rowId: string) => void;
  closeActive: () => void;
  activeRowId: () => string | null;
};

export function createQueueSwipeCoordinator(): QueueSwipeCoordinator {
  let active: { rowId: string; close: SwipeRowCloser } | null = null;

  return {
    open: (rowId, close) => {
      if (active && active.rowId !== rowId) active.close();
      active = { rowId, close };
    },
    closed: (rowId) => {
      if (active?.rowId === rowId) active = null;
    },
    unregister: (rowId) => {
      if (active?.rowId === rowId) active = null;
    },
    closeActive: () => {
      const current = active;
      active = null;
      current?.close();
    },
    activeRowId: () => active?.rowId ?? null,
  };
}
