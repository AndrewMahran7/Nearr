export const RECOGNITION_LONG_RUNNING_MS = 90_000;

export type RecognitionQueueState =
  | 'queued'
  | 'getting_post_info'
  | 'analyzing_video'
  | 'checking_candidates'
  | 'taking_longer'
  | 'needs_review'
  | 'could_not_identify'
  | 'completed';

export function recognitionQueueState(input: {
  status: string | null | undefined;
  progressStage?: string | null;
  ageMs: number;
}): RecognitionQueueState {
  if (input.status === 'completed') return 'completed';
  if (input.status === 'needs_help') return 'needs_review';
  if (input.status === 'failed') return 'could_not_identify';
  if (input.status === 'queued' || input.status === 'processing_metadata') {
    if (input.ageMs >= RECOGNITION_LONG_RUNNING_MS) return 'taking_longer';
    if (input.status === 'queued' || input.progressStage === 'queued') return 'queued';
    if (['queued_media', 'retrieving_media', 'analyzing_media'].includes(input.progressStage ?? '')) return 'analyzing_video';
    if (['checking_video', 'verifying_place', 'cleanup'].includes(input.progressStage ?? '')) return 'checking_candidates';
    return 'getting_post_info';
  }
  return 'could_not_identify';
}

export function recognitionQueueLabel(state: RecognitionQueueState): string {
  switch (state) {
    case 'queued': return 'Queued';
    case 'getting_post_info': return 'Getting post info';
    case 'analyzing_video': return 'Analyzing video';
    case 'checking_candidates': return 'Checking possible places';
    case 'taking_longer': return "Taking longer than usual. You can leave Nearr; we'll let you know.";
    case 'needs_review': return 'Needs your review';
    case 'could_not_identify': return "Couldn't identify this one";
    case 'completed': return 'Ready';
  }
}
