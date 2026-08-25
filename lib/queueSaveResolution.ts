/** Pure single-flight orchestration for saving and resolving a queue job. */

export type PersistedQueueCandidate = {
  savedPlaceId: string;
  duplicate: boolean;
};

export async function persistThenResolveQueueJob(args: {
  jobId: string;
  persist: () => Promise<PersistedQueueCandidate>;
  resolve: (jobId: string, savedPlaceId: string) => Promise<void>;
}): Promise<{ savedPlaceId: string; duplicate: boolean }> {
  const persisted = await args.persist();
  await args.resolve(args.jobId, persisted.savedPlaceId);
  return { savedPlaceId: persisted.savedPlaceId, duplicate: persisted.duplicate };
}
