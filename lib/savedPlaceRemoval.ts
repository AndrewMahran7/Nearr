/**
 * lib/savedPlaceRemoval.ts
 *
 * ONE source of truth for the "you are about to remove a saved place" copy,
 * so the map's place detail and the queue's completed rows cannot drift into
 * saying different things about the same destructive action.
 *
 * The copy must describe what actually happens. The queue's completed-row
 * action undoes an automatic save, which DELETES the saved place — it is not a
 * "clear this row from history" action, so it must not be worded like one.
 */

export type RemovalConfirmCopy = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
};

/** Removing a place from the user's saved places (map detail + queue undo). */
export function savedPlaceRemovalCopy(placeName: string | null | undefined): RemovalConfirmCopy {
  const name = (placeName ?? '').trim();
  return {
    title: 'Remove place?',
    message: name
      ? `${name} will be removed from your saved places.`
      : 'This place will be removed from your saved places.',
    confirmLabel: 'Remove',
    cancelLabel: 'Cancel',
  };
}

/** Accessibility label for the removal control on a row. */
export function savedPlaceRemovalA11yLabel(placeName: string | null | undefined): string {
  const name = (placeName ?? '').trim();
  return name ? `Remove ${name} from your saved places` : 'Remove this place from your saved places';
}
