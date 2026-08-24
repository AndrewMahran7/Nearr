/** A fetch may commit only if no local dataset mutation happened after it began. */
export function shouldCommitSavedPlacesFetch(
  startedMutationRevision: number,
  currentMutationRevision: number,
): boolean {
  return Number.isInteger(startedMutationRevision) &&
    startedMutationRevision === currentMutationRevision;
}
